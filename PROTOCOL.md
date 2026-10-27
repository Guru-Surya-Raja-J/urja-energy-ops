# How the Urja Meter Ops portal works

These are notes from exploring `https://urja-ops.flockenergy.tech` as the `operator@urja.local` user. Everything here came from watching what the browser does and then calling the same endpoints directly. I only made read-only `GET`s plus the login form post. All numbers are as observed on 2026-10-25.

## TL;DR

| What | How |
|---|---|
| Stack | SvelteKit app; auth via [better-auth](https://www.better-auth.com/) |
| Auth | `POST /login` form → `__Secure-better-auth.session_token` cookie (1 h) |
| Data | Undocumented JSON endpoints under `/portal/*`, called by the browser after the page loads |
| Bulk path | `GET /portal/export` returns **all 403 meters with hierarchy + coordinates in one call**, but needs an HMAC signature |
| Readings | `GET /portal/meters/{id}/energy?from=YYYY-MM-DD&to=YYYY-MM-DD`, one meter per call |
| Rate limit | ~120 requests per 60 s per session → `429`, no `Retry-After` |
| Data quality | Blank codes/names, codes reused across parents, an aliased transformer name, duplicate reading rows, decommissioned meters still consuming |

## How I found it

1. `GET /` → `302 /login`. The login page HTML has `X-Sveltekit-Page: true` and `_app/immutable/...` bundles, so it's SvelteKit.
2. After logging in, `/meters` server-renders **"0 total" and an empty table**. The data is fetched client-side, so the HTML isn't worth scraping.
3. The SvelteKit route manifest is in `_app/immutable/entry/app.*.js`. It lists `/(portal)/meters`, `/(portal)/meters/[id]`, `/(portal)/transformers` and `/login`. Each page's compiled component (`_app/immutable/nodes/*.js`) is small and readable, and its `fetch(...)` calls are the API:
   - meters list → `/portal/meters/search?q=&page=`
   - transformers → `/portal/dts?page=`, plus an **"Export all meters"** button that calls `/portal/keys` and then a signed `/portal/export`
   - meter detail → `/portal/meters/{id}/geo` and `/portal/meters/{id}/energy`, with nameplate/hierarchy from the page's server `load`
4. I then called each endpoint directly from a Node script, varied the parameters, and diffed the sources against each other (search vs export vs detail page).

## Authentication

```
POST /login
Origin: https://urja-ops.flockenergy.tech        ← required (SvelteKit CSRF check)
Content-Type: application/x-www-form-urlencoded
email=operator@urja.local&password=urja-ops-2026
```

- Success: `200` with body `{"type":"redirect","status":303,"location":"/meters"}`. Also sets `__Secure-better-auth.session_token=…; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`.
- **Wrong password is also HTTP 200**, with body `{"type":"failure","status":401,"data":"…Invalid email or password…"}` and no cookie. That's the SvelteKit form-action protocol. Check for the cookie, not the status code.
- Without a valid cookie, `/portal/*` returns `401 {"error":"unauthorized","message":"A valid session is required."}` and HTML pages return `302 /login`.
- `GET /api/auth/get-session` (better-auth) shows the session and its `expiresAt`. `POST /api/auth/sign-out` invalidates it, and later calls get 401.
- Sessions last 1 hour. There's no refresh token, so you log in again.

## Endpoints

All JSON. Lists use `{ data, total, page, pageSize }`.

### `GET /portal/meters/search?q=&page=`
Paged meter list, as used by the Meters page.
- Fixed 20 per page. `pageSize` is ignored. `page=0` is treated as 1, and a page past the end returns `data: []`.
- `q` is a **case-insensitive prefix** match on meter ID or serial number: `j1000` → 100 hits, `SE33962` → 1. It does **not** match make or transformer (`Genus` → 0).
- Row: `{ meterId, serialNo, make, phaseType, installStatus, dtCode }`.
- Paging through everything takes 21 calls. Every row matched the export exactly.

### `GET /portal/dts?page=`
Distribution transformers (DTs): `{ code, name, feederCode, capacityKva }`, 20 per page, 40 total. This is the only place transformer **capacity** appears, and the only "master list" in the portal.

### `GET /portal/keys` → `{ "data": { "signingSecret": "…" } }`
Gives any logged-in user the HMAC secret for the export. The secret was **the same across separate sessions**, so it's static rather than per-session.

### `GET /portal/export?page=1` (signed): the bulk path
Headers:
```
x-timestamp: <unix seconds>
x-signature: hex( HMAC-SHA256( secret, "GET\n/portal/export\npage=1\n" + timestamp ) )
```
i.e. `[method, path, query-string-without-?, timestamp].join("\n")`, as in the transformers page bundle.

- Returns **all 403 meters in one ~230 KB response**, with fields the list doesn't have: `installType`, `build`, the full `hierarchy` (`zone/circle/division/subdivision/substation/feeder/dt`, each `{name, code}`) and `geo {lat, lng}` (numbers).
- **`page` is ignored**: page 2 returns the same 403 rows. The UI always sends `page=1`. An empty query works too, as long as you sign the empty string.
- Timestamp tolerance is **±300 s** (−299 s ok, −301 s rejected, +400 s rejected). Millisecond timestamps are rejected.
- Missing or bad signature → `401 {"error":"signature_invalid"}`.

The export makes the 21 search pages and 403 per-meter detail/geo calls unnecessary. A full catalogue sync costs **3 requests** (export + 2 DT pages).

### `GET /portal/meters/{id}/geo` → `{ "data": { "latitude": "26.93…", "longitude": "75.83…" } }`
Coordinates as **strings**. Same values as the export's numbers.

### `GET /portal/meters/{id}/energy[?from=YYYY-MM-DD&to=YYYY-MM-DD]`
Rows: `{ "timestamp": "23/06/2026 23:30", "kwh": "48438.74", "kvah": "52313.84", "voltR": "226" }`.

- **Every value is a string**, and blanks are `""`.
- `timestamp` is `DD/MM/YYYY HH:mm` with **no timezone**.
- `kwh`/`kvah` are **cumulative registers**, not per-interval consumption.
- `voltR` is R-phase voltage only, **even for three-phase meters**.
- Unknown meter → `404 {"error":"not_found"}`. IDs are **case-sensitive**: `j100000` → 404.

Window behaviour (found by trial):

| Query | Result |
|---|---|
| none | last 7 days ending at the newest reading: 23/06 23:30 → 30/06 23:30 (337 rows, both ends inclusive) |
| `from` only | 7 days *from* that date: `from=2026-06-20` → 20/06 00:00 → 27/06 00:00 (337 rows) |
| `to` only | 7 days *ending* that date: `to=2026-06-20` → 14/06 00:00 → 20/06 23:30 (336 rows, so one fewer than above) |
| both | whole days, inclusive: `2026-06-01..2026-06-30` → 1440 rows |
| `from > to`, or outside the data | `200` with `data: []`, not an error |
| any other format (`01/06/2026`, ISO datetimes, `start`/`end`, `days`, `limit`…) | **silently ignored** and treated as absent |

- There's no window cap: a 60-day request just returns the 30 days that exist. **Data only exists for 2026-06-01 → 2026-06-30.**
- Two reporting cadences:
  - **40 meters (J100000–J100039) report half-hourly**, 1440 rows/month.
  - **The other 363 report once a day at 00:00**, 30 rows/month.

### Meter detail page data: `GET /meters/{id}/__data.json`
The SvelteKit server `load` output, in SvelteKit's [devalue](https://github.com/Rich-Harris/devalue) flattened format: an array where objects refer to other entries by index. The nameplate comes in **two different shapes depending on the meter's `build`**:

- `legacy` (238 meters): `detail.data = [{ parameterName: "Meter ID", parameterValue: "J100000" }, …]`
- `v2` (165 meters): `detail.classData = "{\"installed_meter\":{\"MeterId\":\"J100004\",\"SerialNo\":…}}"`, a **JSON string inside JSON** with PascalCase keys

The hierarchy is a flat map of display strings, e.g. `"Feeder": "Feeder 5 (F-005)"`. When a code is blank you get `"Circle 6"`, and when a name is blank you get `""`, **which loses the code**. So the detail page is strictly lossier than the export, and I don't use it. An unknown ID returns HTTP 200 with the 404 inside the payload.

### Rate limiting
- After **120 requests** in quick succession, every call returns `429 {"error":"rate_limited","message":"Rate limit exceeded; slow down."}`.
- Service came back **~60 s after the burst started**, which looks like a fixed one-minute window.
- No `Retry-After` and no `X-RateLimit-*` headers.
- Normal latency: p50 ~120 ms, p95 ~330 ms, occasional 1–5 s outliers (the first request after idle, and some detail pages).

## The data

- **403 meters, 40 transformers, 3 zones, 6 circles, 10 divisions, 14 subdivisions, 18 substations, 28 feeders.** All in and around Jaipur (lat 26.79–27.04, lng 75.66–75.91).
- Status: 238 Installed, 90 Faulty, 75 Decommissioned.
- Make: HPL 90, Genus 88, Secure 85, Allied 76, L&T 64.
- Phase: 277 single, 126 three. Installation type: 205 Whole Current, 198 CT Operated.

### Quirks and surprises

1. **The hierarchy isn't a tree by code.**
   - Zone → circle is consistent: C-01/C-04 are in Z-01, C-02/C-05 in Z-02, C-03/C-06 in Z-03.
   - Below that, the same code shows up under several parents: D-01 is under C-01, C-03 and C-05; SD-01 under D-01, D-05 and D-09; SS-01 under three subdivisions; F-001 under SS-01 and SS-11.
   - Either codes are only unique within their parent, or the data was generated with modular arithmetic. Either way, **a code alone doesn't identify a node.** My API scopes hierarchy node IDs to the full path (`Z-01/C-04/D-10`) and reports each reuse as a data issue.
2. **The transformer is the reliable anchor.** All meters on a DT share one path, apart from the dropouts below. The DT → feeder link from `/portal/dts` agrees with every meter that has a feeder code.
3. **22 meters have one blank field in their path.** Either the code is blank (`{"name":"Circle 6","code":""}`) or the name is (`{"name":"","code":"F-003"}`). That's 12 of the 40 DTs with more than one path variant, every variant caused by a dropout. These repair cleanly from the meter's DT peers.
4. **DT-007 has an alias.** The master list says "Sanganer DT 7", but meters J100400–J100402 call it **"Old Malviya Nagar Xfmr"**. Those three are the last meters, all Genus, three-phase and CT-operated, and they have the only `GN…` serials. They look like a later batch entered differently.
5. **Serial prefixes don't match the make.** An HPL meter can have an `SE…` serial (presumably Secure) and a Genus one an `L&…` serial (presumably L&T). Serials are unique, but don't infer anything from the prefix.
6. **Duplicate reading rows.** Five daily meters (J100089, J100134, J100195, J100211, J100330) repeat their last timestamp. The extra row has `kwh` and `voltR` blank and `kvah` intact.
7. **Decommissioned meters are still consuming.** All 75 decommissioned meters (and all faulty ones) show registers advancing at the same rate as installed meters (6–26 kWh/day). Either the status is stale or the readings are synthetic. The API surfaces this as a warning rather than hiding it.
8. **Suspiciously clean numbers otherwise.** No negative deltas, no gaps. Voltage is always 220–240 V. kVAh ≈ 1.08 × kWh for every meter (power factor ≈ 0.926 everywhere). Fine for building against; worth knowing before drawing conclusions from it.
9. **Formats differ by endpoint.** Geo is numbers in the export and strings in `/geo`. Status is `Installed` on the wire and `InstallationStatus` in v2 detail JSON. Timestamps have no zone. I assume IST (UTC+05:30) because the utility is in Jaipur and the default window ends at 23:30 local.
