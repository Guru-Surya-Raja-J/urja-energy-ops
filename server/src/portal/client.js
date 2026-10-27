import { createHmac } from 'node:crypto';
import { RateLimiter, realSleep } from './rateLimiter.js';

/**
 * A failure talking to the portal, already classified for the API layer.
 * `status` is what our API should surface: 404 for unknown meters, 502/503 for upstream trouble.
 * `code` is one of: not_found | auth_failed | bad_response | unavailable.
 */
export class PortalError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
    this.code = code;
  }
}

// better-auth issues a 1h session cookie; refresh a little early instead of waiting for a 401.
const SESSION_MAX_AGE_MS = 50 * 60 * 1000;

/**
 * Thin, defensive client for the portal's undocumented JSON endpoints (see PROTOCOL.md).
 *
 * Handles: form login + cookie session, transparent re-login on 401, HMAC signing for
 * /portal/export, a client-side rate limit, and retry with backoff on 429/5xx/timeouts.
 */
export class PortalClient {
  #session = null; // { cookie, obtainedAt }
  #loginInFlight = null;
  #signingSecret = null;

  /**
   * @param {object} opts
   * @param {string} opts.baseUrl
   * @param {string} opts.email
   * @param {string} opts.password
   * @param {number} opts.requestsPerMinute
   * @param {number} opts.timeoutMs
   * @param {number} [opts.maxAttempts]
   * @param {typeof fetch} [opts.fetch]  injectable for tests
   * @param {(ms: number) => Promise<void>} [opts.sleep]
   * @param {() => number} [opts.now]
   * @param {(msg: string) => void} [opts.log]
   */
  constructor(opts) {
    this.opts = opts;
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.limiter = new RateLimiter(opts.requestsPerMinute, 60_000, this.now, this.sleep);
  }

  /** Every meter with full hierarchy and coordinates, in one signed call. */
  async exportMeters() {
    // The UI always sends page=1; the server ignores it and returns everything.
    const body = await this.#getJson('/portal/export', { page: '1' }, { signed: true });
    if (!Array.isArray(body.data)) throw new PortalError('Export returned no data array', 502, 'bad_response');
    if (body.data.length !== body.total) this.#log(`export returned ${body.data.length} rows but total=${body.total}`);
    return body.data;
  }

  /** The distribution-transformer master list (paged 20 at a time; page size is fixed). */
  async listTransformers() {
    const all = [];
    for (let page = 1; ; page++) {
      const body = await this.#getJson('/portal/dts', { page: String(page) });
      all.push(...body.data);
      if (body.data.length === 0 || all.length >= body.total) return all;
    }
  }

  /**
   * Register readings for one meter. `from`/`to` are inclusive IST dates (YYYY-MM-DD).
   * The portal silently ignores any other date format, so callers must validate first.
   */
  async getReadings(meterId, { from, to } = {}) {
    const query = {};
    if (from) query.from = from;
    if (to) query.to = to;
    const body = await this.#getJson(`/portal/meters/${encodeURIComponent(meterId)}/energy`, query);
    return body.data;
  }

  #log(msg) {
    this.opts.log?.(`[portal] ${msg}`);
  }

  async #getJson(path, query, { signed = false } = {}) {
    const qs = new URLSearchParams(query).toString();
    const url = `${this.opts.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    let lastProblem = 'unknown error';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const headers = { accept: 'application/json', cookie: await this.#getCookie() };
      if (signed) Object.assign(headers, await this.#sign(path, qs));

      await this.limiter.acquire();
      let res;
      try {
        res = await this.fetchFn(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(this.opts.timeoutMs) });
      } catch (err) {
        lastProblem = `network error: ${err.message}`;
        this.#log(`${path} attempt ${attempt}: ${lastProblem}`);
        await this.sleep(this.#backoffMs(attempt));
        continue;
      }

      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new PortalError(`Portal returned non-JSON for ${path}`, 502, 'bad_response');
        }
      }

      const body = await res.text();
      if (res.status === 404) throw new PortalError(`Portal: not found (${path})`, 404, 'not_found');

      if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
        if (body.includes('signature_invalid')) {
          // Secret may have rotated (not observed so far) or our clock is >300s off.
          this.#signingSecret = null;
          lastProblem = 'signature rejected';
        } else {
          this.#session = null;
          lastProblem = 'session rejected';
        }
        this.#log(`${path} attempt ${attempt}: ${lastProblem}, retrying`);
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = retryAfter > 0 ? retryAfter * 1000 : this.#backoffMs(attempt);
        lastProblem = `HTTP ${res.status}`;
        this.#log(`${path} attempt ${attempt}: ${lastProblem}, backing off ${wait}ms`);
        if (res.status === 429) this.limiter.pause(wait);
        else await this.sleep(wait);
        continue;
      }

      throw new PortalError(`Portal returned HTTP ${res.status} for ${path}: ${body.slice(0, 200)}`, 502, 'bad_response');
    }
    throw new PortalError(`Portal unavailable after ${this.maxAttempts} attempts (${lastProblem})`, 503, 'unavailable');
  }

  /** Exponential backoff with jitter: ~2s, 4s, 8s, ... capped at 30s. */
  #backoffMs(attempt) {
    const base = Math.min(30_000, 1000 * 2 ** attempt);
    return Math.round(base / 2 + Math.random() * (base / 2));
  }

  async #getCookie() {
    if (this.#session && this.now() - this.#session.obtainedAt < SESSION_MAX_AGE_MS) return this.#session.cookie;
    // Single-flight: concurrent callers share one login.
    this.#loginInFlight ??= this.#login().finally(() => {
      this.#loginInFlight = null;
    });
    return this.#loginInFlight;
  }

  /** Submits the SvelteKit login form action, exactly as the browser does. */
  async #login() {
    await this.limiter.acquire();
    const res = await this.fetchFn(`${this.opts.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      // SvelteKit rejects form posts whose Origin doesn't match (CSRF protection).
      headers: { origin: this.opts.baseUrl, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ email: this.opts.email, password: this.opts.password }),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    }).catch((err) => {
      throw new PortalError(`Portal login failed: ${err.message}`, 503, 'unavailable');
    });
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    // A bad password is still HTTP 200, with {"type":"failure","status":401} in the body.
    if (!cookie.includes('session_token')) {
      const body = await res.text().catch(() => '');
      throw new PortalError(`Portal login rejected (HTTP ${res.status}): ${body.slice(0, 200)}`, 502, 'auth_failed');
    }
    this.#session = { cookie, obtainedAt: this.now() };
    this.#log('logged in');
    return cookie;
  }

  /** x-timestamp / x-signature headers: HMAC-SHA256 over "GET\n<path>\n<query>\n<unix seconds>". */
  async #sign(path, query) {
    if (!this.#signingSecret) {
      const keys = await this.#getJson('/portal/keys', {});
      this.#signingSecret = keys.data.signingSecret;
    }
    const timestamp = String(Math.floor(this.now() / 1000));
    const signature = createHmac('sha256', this.#signingSecret)
      .update(['GET', path, query, timestamp].join('\n'))
      .digest('hex');
    return { 'x-timestamp': timestamp, 'x-signature': signature };
  }
}
