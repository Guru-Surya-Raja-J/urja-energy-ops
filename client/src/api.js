// Client for our own API (see /openapi.json for every response shape).
// The browser never talks to the portal.

export const LEVELS = ['zone', 'circle', 'division', 'subdivision', 'substation', 'feeder', 'transformer'];

async function request(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const problem = await res.json().catch(() => null);
    throw new Error(problem?.detail ?? problem?.title ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return request(`/api/v1${path}${qs ? `?${qs}` : ''}`);
}

const id = encodeURIComponent;

export const api = {
  health: () => request('/api/health'),
  stats: () => get('/stats'),
  meters: (params) => get('/meters', params),
  meter: (meterId) => get(`/meters/${id(meterId)}`),
  readings: (meterId, range) => get(`/meters/${id(meterId)}/readings`, range),
  consumption: (meterId, range) => get(`/meters/${id(meterId)}/consumption`, range),
  transformers: () => get('/transformers'),
  transformer: (code) => get(`/transformers/${id(code)}`),
  transformerLoad: (code, range) => get(`/transformers/${id(code)}/load`, range),
  hierarchy: () => get('/hierarchy'),
  issues: () => get('/data-issues'),
};

/** Fetch a meter's readings for the window and save them as a CSV file. */
export async function downloadReadingsCsv(meterId, range) {
  const { readings, interval } = await api.readings(meterId, range);
  const lines = ['timestamp,kwh,kvah,voltage_r', ...readings.map((r) => [r.timestamp, r.kwh ?? '', r.kvah ?? '', r.voltageR ?? ''].join(','))];
  const url = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${meterId}_${range.from ?? 'latest'}_${range.to ?? '7d'}_${interval}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
