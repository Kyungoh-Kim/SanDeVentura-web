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

For Android Emulator mobile testing, run the Flutter app with:

```powershell
cd ..\..\mobile
flutter run --dart-define=SUPABASE_FUNCTIONS_URL=http://10.0.2.2:54321/functions/v1
```

Use `adb reverse` only for a physical device or explicit localhost workflow.

## Sprint 9 Demo Mountain Seed

Use this seed when you want the mobile app's default `beta-mountain` and the
operator web to show a realistic route in the requested Sejong-area bounds:

- start area: `36.4942, 127.3079`
- end area: `36.4864, 127.3192`
- seeded route: `36.4938, 127.3082` to `36.4868, 127.3188`

Apply it after local migrations are up:

```powershell
Get-Content -Raw .\supabase\replay\sprint9_demo_mountain_seed.sql |
  docker exec -i supabase_db_sandeventura-local psql -U postgres -d postgres
```

Expected seeded values:

- mountain: `beta-mountain` / `Sejong Demo Ridge`
- route state: `recommended`
- canonical route version: `100`
- accepted points: `28`
- rejected points: `3`
- operator events: `2 trail_served`, `2 snap_requested`

Operator web live data needs `web/.env.local` with local Supabase values:

```text
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key from npx supabase status -o env>
```

Mobile emulator testing can use:

```powershell
cd ..\..\mobile
flutter run --dart-define-from-file=.env.local.json
```
