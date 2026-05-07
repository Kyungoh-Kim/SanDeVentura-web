# Sprint 4 Route Replay

Use this replay data after a local Supabase reset to create three clean traces
for `beta-mountain` and two branch-ambiguous traces for
`branch-test-mountain`.

```powershell
npm run supabase:reset
npx supabase db query -f supabase/replay/sprint4_route_replay.sql
```

Serve all local functions:

```powershell
npm run supabase:functions
```

Then call the route functions:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:54321/functions/v1/recompute-canonical-trails `
  -ContentType application/json `
  -Body '{"mountainId":"beta-mountain","mode":"single"}'

Invoke-RestMethod `
  -Uri "http://127.0.0.1:54321/functions/v1/get-canonical-trail?mountainId=beta-mountain"

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:54321/functions/v1/snap-position `
  -ContentType application/json `
  -Body '{"mountainId":"beta-mountain","lat":37.5003,"lon":127.0003,"accuracy":12}'

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:54321/functions/v1/snap-position `
  -ContentType application/json `
  -Body '{"mountainId":"beta-mountain","lat":37.5006,"lon":127.0010,"accuracy":12}'

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:54321/functions/v1/snap-position `
  -ContentType application/json `
  -Body '{"mountainId":"beta-mountain","lat":37.5020,"lon":127.0030,"accuracy":12}'

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:54321/functions/v1/recompute-canonical-trails `
  -ContentType application/json `
  -Body '{"mountainId":"branch-test-mountain","mode":"single"}'
```

Expected result: recompute creates a `recommended` route, route retrieval
returns GeoJSON, and snap-position returns `on_route`, `caution`, and
`away_from_route` for the near/mid/far probes. The branch replay should produce
a lower-confidence reference route because ambiguity is higher.
