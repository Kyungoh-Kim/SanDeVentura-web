# Route Replay

Use this replay data after a local Supabase reset to create clean raw GPS
sessions for `beta-mountain` and branch-ambiguous sessions for
`branch-test-mountain`.

```powershell
npm run supabase:reset
npx supabase db query -f supabase/replay/sprint4_route_replay.sql
```

Serve local functions:

```powershell
npm run supabase:functions
```

Run trajectory aggregation:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:54321/functions/v1/match-and-aggregate-sessions `
  -ContentType application/json `
  -Body '{}'
```

Expected result: aggregation consumes the raw uploaded points, writes
trajectory attribution, updates canonical route geometry when support matches
an existing route, and leaves unmatched support as candidate trajectories.
