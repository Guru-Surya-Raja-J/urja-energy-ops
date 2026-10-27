import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PortalClient, PortalError } from '../src/portal/client.js';

const BASE = 'https://portal.test';
const SECRET = 'test-secret';

/** A scripted stand-in for the portal. `routes` maps a path to a queue of response factories. */
function fakePortal(routes, { password = 'pw' } = {}) {
  const calls = [];
  let sessions = 0;
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (path === '/login') {
      const body = new URLSearchParams(String(init.body));
      if (body.get('password') !== password) {
        return new Response(JSON.stringify({ type: 'failure', status: 401 }), { status: 200 });
      }
      sessions++;
      return new Response('{"type":"redirect"}', {
        status: 200,
        headers: { 'set-cookie': `__Secure-better-auth.session_token=s${sessions}; Path=/; HttpOnly` },
      });
    }
    if (path === '/portal/keys') return Response.json({ data: { signingSecret: SECRET } });
    const queue = routes[path];
    const next = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    return next ? next() : new Response('not found', { status: 404 });
  };
  return { fetchFn, calls };
}

function client(fetchFn, password = 'pw') {
  // Fake clock: sleeping just moves time forward, so backoff costs nothing in tests.
  let clock = 1_800_000_000_000;
  return new PortalClient({
    baseUrl: BASE,
    email: 'op@test',
    password,
    requestsPerMinute: 1000,
    timeoutMs: 1000,
    fetch: fetchFn,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
}

const page = (data, total = data.length) => () => Response.json({ data, total, page: 1, pageSize: 20 });
const logins = (calls) => calls.filter((c) => c.url.endsWith('/login')).length;

describe('PortalClient', () => {
  it('logs in once and sends the session cookie', async () => {
    const { fetchFn, calls } = fakePortal({ '/portal/meters/J1/energy': [page([])] });
    const c = client(fetchFn);
    await c.getReadings('J1');
    await c.getReadings('J1');
    expect(logins(calls)).toBe(1);
    const energyCall = calls.find((x) => x.url.includes('/energy'));
    expect(energyCall.init.headers.cookie).toBe('__Secure-better-auth.session_token=s1');
  });

  it('logs in again when the session is rejected', async () => {
    const { fetchFn, calls } = fakePortal({
      '/portal/meters/J1/energy': [() => Response.json({ error: 'unauthorized' }, { status: 401 }), page([{ timestamp: 'x' }])],
    });
    expect(await client(fetchFn).getReadings('J1')).toHaveLength(1);
    expect(logins(calls)).toBe(2);
  });

  it('backs off and retries on 429', async () => {
    const limited = () => Response.json({ error: 'rate_limited' }, { status: 429 });
    const { fetchFn, calls } = fakePortal({ '/portal/dts': [limited, limited, page([{ code: 'DT-001' }])] });
    expect(await client(fetchFn).listTransformers()).toEqual([{ code: 'DT-001' }]);
    expect(calls.filter((x) => x.url.includes('/portal/dts'))).toHaveLength(3);
  });

  it('gives up with a 503 PortalError after repeated failures', async () => {
    const { fetchFn } = fakePortal({ '/portal/dts': [() => new Response('boom', { status: 500 })] });
    await expect(client(fetchFn).listTransformers()).rejects.toMatchObject({ status: 503, code: 'unavailable' });
  });

  it('maps an unknown meter to a 404 PortalError', async () => {
    const { fetchFn } = fakePortal({});
    await expect(client(fetchFn).getReadings('NOPE')).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('reports a wrong password as auth_failed (the portal answers 200)', async () => {
    const { fetchFn } = fakePortal({}, { password: 'right' });
    const err = await client(fetchFn, 'wrong').getReadings('J1').catch((e) => e);
    expect(err).toBeInstanceOf(PortalError);
    expect(err.code).toBe('auth_failed');
  });

  it('signs export requests with HMAC-SHA256 over method, path, query and timestamp', async () => {
    const { fetchFn, calls } = fakePortal({ '/portal/export': [page([{ meterId: 'J1' }])] });
    await client(fetchFn).exportMeters();
    const h = calls.find((x) => x.url.includes('/portal/export')).init.headers;
    const expected = createHmac('sha256', SECRET).update(`GET\n/portal/export\npage=1\n${h['x-timestamp']}`).digest('hex');
    expect(h['x-signature']).toBe(expected);
  });

  it('pages through the transformer list', async () => {
    const { fetchFn } = fakePortal({ '/portal/dts': [page([{ code: 'A' }, { code: 'B' }], 3), page([{ code: 'C' }], 3)] });
    expect((await client(fetchFn).listTransformers()).map((t) => t.code)).toEqual(['A', 'B', 'C']);
  });
});
