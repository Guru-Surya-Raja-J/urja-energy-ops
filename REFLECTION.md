# Reflection

### What assumptions did you make?

- **Timestamps are IST.** The portal never states a timezone. Jaipur and a default window ending at 23:30 local make IST the obvious reading, but it's unverified, and it affects every daily total.
- **Registers are cumulative.** That's why consumption is computed as a difference between readings rather than read directly.
- **The transformer master list beats the meter records** when they disagree on a name.
- **Hierarchy codes are scoped to their parent.** I could have read the reused codes as one asset under several parents, but physically that makes no sense (one feeder fed from two substations), so I kept them apart and flagged every case.
- **The data will change.** It's frozen at June 2026, but I built freshness and staleness handling as if it weren't, because a real portal behind this API wouldn't be frozen.
- **One shared service account is acceptable** for all API consumers.

### Which part was the most difficult, and how did you get unstuck?

Two places.

**Finding the data.** The meters page server-renders "0 total", so scraping HTML was a dead end. I got unstuck by reading SvelteKit's route manifest and each page's compiled component, where the `fetch` calls are in plain sight. That's also where the "Export all meters" button's HMAC signing lives. Reproducing it turned 400+ requests into one.

**The hierarchy.** At first it looked hopelessly inconsistent: codes with several parents, blanks everywhere. What untangled it was grouping meters by transformer and noticing each transformer has exactly one path apart from single-field dropouts. Once the transformer was the anchor, repair became a majority vote. What was left (codes reused under different parents) turned out to be structural, not noise.

### If you had another day, what would you improve?

- A background, rate-limit-aware sweep of everyone's readings into Mongo, so fleet-wide questions become a query instead of 400 portal calls: top consumers, transformers near capacity, and the decommissioned-but-consuming list.
- Incremental reading fetches instead of whole-window re-fetches.
- A fallback catalogue sync via the paged search endpoint, in case the export's signing scheme changes.
- Real frontend tests (Playwright) for the map and the network explorer.

### What mistake did you make while solving this?

**I hit the rate limit by being impatient.** To survey reading quality I fired four concurrent workers at the energy endpoint before I knew a limit existed. About 120 requests in, everything started returning 429, and I produced roughly 385 failed requests against someone else's system. The right move was to probe slowly first. I then measured the limit properly (120 per ~60 s window, no `Retry-After`), and that's why the client has a shared limiter set below it that pauses everyone on a 429.

**I briefly misread the data.** Halfway through that sweep, responses dropped from 1440 rows to 30, and I first assumed the server was throttling by downsampling. Re-requesting a "1440" meter and a "30" meter side by side showed it was a per-meter property: 40 half-hourly meters and 363 daily ones. That's why the API normalises both to daily consumption.

### If you were reviewing your own submission, what would you criticise?

- **The transformer load endpoint is expensive on a cold cache:** one portal call per meter. It's fine for 13 meters; it'd be a problem for a dashboard that loads all 40 transformers at once.
- **The hierarchy tree is stored as one Mongo document** and rebuilt on every sync. That's simple now, but it won't scale (see "Where this would struggle" in the README).
- **Response schemas are checked in tests but not at runtime**, so a code path the tests miss could still drift from `openapi.json`.
- **The export dependency is a single point of failure.** If the portal changes its signing scheme, catalogue sync stops. It degrades gracefully (stale data, `degraded` health), but there's no automatic fallback yet.
- **Mongo is arguably more than 403 meters need.** It earns its keep through geo queries, TTL caching and aggregations, but an in-memory index would have been a defensible, smaller choice.
