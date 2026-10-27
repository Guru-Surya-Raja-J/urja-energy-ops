/** Runtime configuration, read once from environment variables (see .env.example). */

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env = process.env) {
  const email = env.PORTAL_EMAIL;
  const password = env.PORTAL_PASSWORD;
  if (!email || !password) {
    throw new Error('PORTAL_EMAIL and PORTAL_PASSWORD must be set (copy .env.example to .env).');
  }
  return {
    port: int(env.PORT, 4000),
    mongoUri: env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/urja_meter_api',
    portal: {
      baseUrl: (env.PORTAL_URL ?? 'https://urja-ops.flockenergy.tech').replace(/\/$/, ''),
      email,
      password,
      // Client-side cap; the portal starts returning 429 at roughly 120 requests/minute.
      requestsPerMinute: int(env.PORTAL_REQUESTS_PER_MINUTE, 100),
      timeoutMs: int(env.PORTAL_TIMEOUT_MS, 15_000),
    },
    // How long the meter/transformer catalogue is fresh before a background re-sync.
    catalogTtlSeconds: int(env.CATALOG_TTL_SECONDS, 600),
    // How long a cached reading window is served before going back to the portal.
    readingsTtlSeconds: int(env.READINGS_TTL_SECONDS, 300),
  };
}
