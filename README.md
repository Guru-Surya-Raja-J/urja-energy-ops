# Urja Meter API

A clean, documented REST API over the **Urja Meter Ops** portal: a legacy SvelteKit web app with no API. Consumers get meters, their place in the distribution network, and their consumption as tidy JSON, without ever touching the portal.

A small React client ships with it: a meter map, a network explorer with transformer loading, and a data-quality view.

**Where things are**

| | |
|---|---|
| How the portal works underneath | [PROTOCOL.md](PROTOCOL.md): read this first, it explains most of the design |
| The API contract | [openapi.json](openapi.json) (OpenAPI 3.0), also browsable at `http://localhost:4000/api/docs` |
| Reflection questions | [REFLECTION.md](REFLECTION.md) |

---

## Quick start

Stack: **MERN in plain JavaScript**: MongoDB, Express 5, React 19 (Vite), Node.

Requirements: **Node ≥ 22** and **MongoDB** (a local install, or `docker compose up -d mongo`).

```bash
cp .env.example .env        # portal credentials + Mongo URI; defaults work as-is
npm install
npm run build               # builds the React client
npm start                   # API + client on http://localhost:4000
```

- Client: http://localhost:4000
- API docs (Swagger UI): http://localhost:4000/api/docs
- For development with hot reload: `npm run dev` (API on :4000, Vite on :5173 proxying `/api`).

On startup the service logs into the portal and syncs the catalogue. That's 3 portal calls and takes about 2 s. Readings are fetched on demand.

```bash
npm test            # unit + HTTP tests (no portal needed; uses an in-memory MongoDB)
npm run openapi     # regenerate openapi.json from the code
```

> The first `npm test` downloads a MongoDB test binary (~100 MB). To use a running Mongo instead: `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test`.

### Sample requests

```bash
# Faulty Genus meters on feeder F-007
curl "http://localhost:4000/api/v1/meters?status=faulty&make=genus&feeder=F-007"

# The 3 meters nearest a point, with distance
curl "http://localhost:4000/api/v1/meters?near=26.9124,75.7873&pageSize=3"

# Daily consumption for June
curl "http://localhost:4000/api/v1/meters/J100004/consumption?from=2026-06-01&to=2026-06-30"

# How loaded is transformer DT-007?
curl "http://localhost:4000/api/v1/transformers/DT-007/load?from=2026-06-01&to=2026-06-30"
```

Example response (`GET /api/v1/meters/J100044`, a meter whose feeder code was blank in the portal):

```json
{
  "meterId": "J100044",
  "serialNo": "HP44211",
  "make": "Secure",
  "phase": "single",
  "status": "installed",
  "installationType": "ct_operated",
  "recordFormat": "legacy",
  "transformerCode": "DT-005",
  "network": {
    "zone":        { "code": "Z-02",   "name": "Jaipur Zone 2" },
    "circle":      { "code": "C-05",   "name": "Circle 5" },
    "division":    { "code": "D-05",   "name": "Division 5" },
    "subdivision": { "code": "SD-05",  "name": "Subdivision 5" },
    "substation":  { "code": "SS-05",  "name": "Substation 5" },
    "feeder":      { "code": "F-005",  "name": "Feeder 5" },
    "transformer": { "code": "DT-005", "name": "Bani Park DT 5" }
  },
  "location": { "lat": 26.85587993237898, "lng": 75.8167241689262 }
}
```

And `GET /api/v1/meters/J100089/consumption?from=2026-06-01&to=2026-06-30` (trimmed):

```json
{
  "meterId": "J100089",
  "status": "installed",
  "interval": "P1D",
  "fetchedAt": "2026-10-25T06:44:25.824Z",
  "stale": false,
  "days": [
    { "date": "2026-06-01", "kwh": 7.65, "kvah": 8.25, "intervals": 1, "complete": true }
  ],
  "summary": {
    "readingCount": 30, "totalKwh": 221.7, "totalKvah": 239.43, "avgDailyKwh": 7.645,
    "powerFactor": 0.926, "voltageR": { "min": 221, "max": 239, "avg": 231.033 }
  },
  "warnings": ["1 portal row(s) discarded: duplicate timestamp; kept the more complete row."]
}
```

---

## What I built

### Endpoints

| Endpoint | What it gives you |
|---|---|
| `GET /api/v1/meters` | Search + filter, all combinable: `q` (substring of ID/serial), `status`, `make`, `phase`, `installationType`, any network level (`zone` … `feeder`, `transformer`), geo search (`near=lat,lng`, `radiusKm`), and paging |
| `GET /api/v1/meters/{id}` | Nameplate, repaired network path, location |
| `GET /api/v1/meters/{id}/readings` | Register readings as numbers, ISO timestamps (IST), duplicates removed and listed in `dropped` |
| `GET /api/v1/meters/{id}/consumption` | Per-day kWh/kVAh worked out from the registers (same output for half-hourly and daily meters), plus a summary (total, average/day, power factor, voltage range) and data-quality warnings |
| `GET /api/v1/transformers[/{code}]` | Transformers with capacity, meter counts by status, and their network path; detail includes the meters |
| `GET /api/v1/transformers/{code}/load` | Daily energy on a transformer, average kVA, and **% of nameplate capacity**. The portal has no such view |
| `GET /api/v1/hierarchy` | The reconstructed zone → … → transformer tree with meter and status counts per node |
| `GET /api/v1/data-issues` | Every inconsistency found in the portal data and what the API did about it |
| `GET /api/v1/stats` | Fleet breakdowns (status, make, phase, zone…) |
| `GET /api/health` | Up/degraded, plus catalogue age and last sync error |

Errors are always `application/problem+json` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)) with a human-readable `detail`. Reading windows use `from`/`to` as inclusive `YYYY-MM-DD` dates. If you give only one, you get a 7-day window anchored on it; with neither, you get the latest 7 days.

### Architecture

```
            ┌──────────────── server (Express, plain JS ESM) ────────────────┐
React  ───► │ api/routes ─► services ─────────► portal/client ───────────────┼──► Urja portal
client      │  (zod-validated)  │ catalog: sync + TTL   login, re-login,      │    (SvelteKit)
            │                   │ readings: cache       HMAC signing,         │
            │                   ▼                       rate limit, retries   │
            │               MongoDB  ◄── domain/ (pure: repair hierarchy,     │
            │  meters (2dsphere), transformers, catalog_state, readings_cache)│
            └────────────────────────────────────────────────────────────────┘
```

```
server/src/
  portal/       Everything that knows the portal's wire format: client.js, rateLimiter.js
  domain/       Pure functions: network repair + tree, reading normalisation, daily consumption
  services/     catalog.js (sync + freshness), readings.js (cache + single-flight)
  api/          Express routers, zod schemas (validation and OpenAPI), problem+json errors
  db.js         Mongo collections and indexes
  app.js        Wiring; server.js is the entry point
server/test/    Unit tests for domain + portal client, HTTP tests against in-memory Mongo
client/src/     React + Vite (JSX): views/MapView, views/NetworkView, views/IssuesView
```

Two data paths, because the portal has two kinds of data:

- **Catalogue (meters, transformers, hierarchy):** small, slow-changing, and available in bulk. The service pulls everything with **3 portal calls** (the signed `/portal/export` plus 2 pages of `/portal/dts`). It repairs the hierarchy, writes to MongoDB, and answers every list/filter/geo/stats query locally.
- **Readings:** no bulk path, so one portal call per meter per window. Fetched on demand, normalised, and cached in Mongo.

### The React client (`client/`)

- **Navbar:**
  - a live health pill that polls `/api/health` ("Live · synced 2 min ago", or amber "Degraded" with the reason)
  - a light/system/dark theme switch, remembered per browser
  - a **⌘K / Ctrl+K command palette** to jump to any meter, serial, transformer or view
- **Fleet overview:** stat tiles and a status bar for the whole fleet. The status tiles are clickable and filter the map.
- **Meters:**
  - Every meter on a map, coloured by status, with search and status/make/phase filters.
  - A "Fit to results" button zooms the map to the current filter.
  - Clicking a meter opens a drawer with its details, a daily-consumption chart (partial days shown lighter), data-quality warnings, and its network path.
  - The drawer can copy the meter ID, **download the window's readings as CSV**, or open the meter's transformer. Esc closes it.
- **Network & load:**
  - The hierarchy tree, with meter counts and a status bar at every level. A filter box prunes it to matching branches.
  - Picking a transformer shows a capacity gauge, a daily-energy chart, and its meters.
- **Data quality:** what the API repaired or flagged in the portal's data, grouped and explained.

Every view is linkable: `/#map/J100003`, `/#network/DT-007`, `/#issues`. It follows the OS light/dark setting. The map uses free OpenStreetMap tiles, muted (and inverted in dark mode) so the status colours carry it.

Charts follow a few deliberate rules: one y-axis per chart (load % is a separate gauge, not a second axis), status colours always paired with a text label, and thin bars on a hairline grid.

The client only talks to our API, never the portal.

---

## Assumptions

- **Timestamps are IST (UTC+05:30).** The portal prints wall-clock times with no zone. The utility is in Jaipur, and the default window ends at 23:30 local. Every timestamp we return carries an explicit `+05:30`.
- **kWh/kVAh are cumulative registers.** They only ever increase, and a meter's values sit in the tens of thousands. Daily consumption is the delta between consecutive readings, credited to the day the interval started on.
- **The transformer master list (`/portal/dts`) is the source of truth for transformer names** (it beat the "Old Malviya Nagar Xfmr" alias), and **a meter's transformer anchors its network path.**
- **Codes are not globally unique below circle level.** I treat them as scoped to their parent rather than merging, e.g., every "D-01" into one division. The tree keys nodes by full path. Filtering by `division=D-01` still matches all of them; add `circle=` to narrow it.
- **The portal is read-only to us, and its rate limit is shared.** The client stays at 100 req/min (configurable) under the observed ~120.
- **The data is effectively static** (June 2026 only). I still built freshness handling as if it weren't, because the real portal wouldn't be.
- **One service account is fine.** Every API consumer goes through the same portal login. There's no per-user auth on our API (see "Left out").

## Design decisions & trade-offs

- **Use the bulk export, not page scraping.** Reproducing the HMAC signature (from the transformers page's JS) turns 400+ calls into one. The risk: if the signing scheme changes, the sync breaks. It fails loudly and `/api/health` shows `degraded`, with the last good copy still served. The fallback I'd add is paging `/portal/meters/search` (21 calls, but that loses hierarchy and geo).
- **Repair data, but say so.** The API serves repaired values, so consumers get a consistent tree, and records every repair in `/api/v1/data-issues` with `repaired: true/false`. Silent fixing would hide the portal's problems; refusing to fix would push them onto every consumer.
- **Our own window semantics.** The portal's defaults are asymmetric (337 vs 336 rows depending on which bound you omit) and it silently ignores bad dates. We validate strictly (400 on bad input) and always send both bounds when the caller gives either.
- **MongoDB as the local index** (a MERN stack was my preference). It gives a real query layer for free: combinable filters, a `2dsphere` index for "what's near here", aggregation for stats and roll-ups, and a TTL index to expire cached readings. For 403 meters an in-memory map would also work. Mongo earns its place once the catalogue no longer fits comfortably in one process, or several API instances need to share a cache.
- **Freshness:**
  - The catalogue is fresh for 10 min (`CATALOG_TTL_SECONDS`). After that, requests still get the current copy immediately while a background re-sync runs (stale-while-revalidate). A failed sync never empties the store.
  - Readings are fresh for 5 min (`READINGS_TTL_SECONDS`), close to the 30-min reporting interval. If the portal is down, an expired copy (kept up to 24 h) is served with `stale: true`.
- **Robustness in the portal client:**
  - single-flight login
  - proactive re-login before the 1 h session expires, plus automatic re-login on 401
  - re-fetch of the signing secret on `signature_invalid`
  - a shared sliding-window rate limiter that pauses *all* callers after a 429 (since there's no `Retry-After`)
  - exponential backoff with jitter on 429/5xx/network errors
  - a per-request timeout
  - classified errors: 404 passes through as 404; upstream trouble becomes 502/503 problem+json
- **Zod schemas are the single source** for request validation, `openapi.json`, and the HTTP tests, which parse every response against the published schema. That keeps the docs from drifting from the code.
- **Average load, not peak.** Transformer `utilizationPct` is daily kVAh ÷ 24 ÷ capacity. That's the best the data supports (there's no demand register) and it's labelled as such, because averages hide peaks.

## What I intentionally left out

- **Auth on our own API.** Behind a gateway or on an internal network I'd add API keys or OIDC. Bolting on a toy version would add code without adding safety.
- **The meter detail page (`__data.json`) and `/geo`.** The export already carries everything they do, and more: the detail page actually *loses* codes.
- **Pre-fetching every meter's readings.** A full sweep is 403 calls, about 4 min under the rate limit. That's fine as a nightly job but the wrong default at startup. So fleet-wide consumption analytics (e.g. "all decommissioned meters still consuming") are documented in PROTOCOL.md rather than served live.
- **Writes.** The portal has none and the brief says read-only.
- **A production deploy setup** (Dockerfile for the app, CI) beyond a compose file for Mongo.

## What I'd improve with more time

- A **background readings sweep** (rate-limit-aware, resumable) so fleet-wide questions (top consumers, anomalies, decommissioned-but-consuming) can be answered from Mongo.
- **Incremental reading fetches.** Only ask the portal for days after the last cached reading instead of re-fetching whole windows.
- **Fallback catalogue sync via `/portal/meters/search`** if the export signature scheme changes.
- **Metrics** (portal latency, 429 count, cache hit rate) and structured logs.
- **Contract tests against the live portal**, run on a schedule, to catch upstream format changes early.
- **Client:**
  - marker clustering for larger fleets
  - a table view behind each chart
  - frontend tests (Playwright)

### Where this would struggle at scale

- Up to roughly a million meters, the Mongo catalogue and its indexes are fine.
- The bulk export is the first thing to break. A single ~230 KB response for 403 meters is ~570 MB at a million meters, so it would need real paging or a change feed from the source. Sync would also need to move from replace-everything to diffing.
- Readings are the real bottleneck. At ~100 req/min, refreshing a million meters once takes about a week. That needs either a bulk readings source from the utility or a time-series store fed incrementally, not on-demand fetching.
- The hierarchy tree is rebuilt in memory on each sync and stored as one document. That stops fitting Mongo's 16 MB document limit somewhere in the tens of thousands of transformers. Past that, store nodes as documents with parent references.

---

## Reflection

See [REFLECTION.md](REFLECTION.md).
