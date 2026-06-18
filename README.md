# SanDeVentura Web

Web/operator repository for the SanDeVentura MVP.

Scope:

- Operator-only dashboard surfaces.
- Overview, Routes, Sessions, and Quality views.
- Supabase-backed metrics and route-quality read models.
- Privacy-aware operational visibility without raw trace exposure.

The hiker-facing mobile app lives in the separate `SanDeVentura-mobile` repository.

## Local Supabase (recommended workflow)

This repository includes local Supabase artifacts used for development (migrations, Edge Functions). For a reliable and consistent local development experience we recommend using the official `supabase` CLI which manages a local Docker-based stack. A legacy custom compose helper is provided at the repository root (`supabase-docker/`) for reference only — prefer the CLI unless you need the custom compose.

Important components (images and common host ports used by local setups):

- kong (API gateway)
  - Image (typical): `public.ecr.aws/supabase/kong:2.8.1` (tag may vary)
  - Host port mapping used here: `54321 -> container 8000` (functions/API gateway)
- postgres (database)
  - Image (typical): `postgres:15.8`
  - Host port mapping: `54322 -> container 5432`
- studio (Supabase Studio)
  - Image (typical): `public.ecr.aws/supabase/studio:2026.04.28`
  - Host port mapping: `54323 -> container 3000`
- edge runtime (Edge Functions)
  - Image (typical): `public.ecr.aws/supabase/edge-runtime:v1.73.13`
  - Functions are usually routed through Kong under `/functions/v1/*` on Kong host port (54321).
- vector (logs / observability)
  - Image: `public.ecr.aws/supabase/vector:0.53.0-alpine`

Where to find local Supabase configuration:
- `web/supabase/config.toml` — local project ports and function settings.
- `web/supabase/.env.local` — local environment used for functions / server-side testing (DO NOT commit secrets).
- Legacy compose helper: `supabase-docker/docker-compose.yml` (repository root) — for historical/advanced use only.

Common troubleshooting and commands (PowerShell)

- Show Supabase-related containers and status (uses the container names defined in `supabase-docker/docker-compose.yml`):
```powershell
docker ps -a --filter "name=sandeventura_supabase" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

- View Kong/gateway logs (compose container name):
```powershell
docker logs -f sandeventura_supabase_kong
```

- View Edge runtime logs (compose container name):
```powershell
docker logs -f sandeventura_supabase_edge_runtime
```

- If the edge runtime container has exited or there are container name conflicts, inspect and restart/clean up:
```powershell
# list related containers
docker ps -a --filter "name=sandeventura_supabase"
# remove an exited/old container
docker rm -f <container-id-or-name>
# Or use the supabase CLI to stop the stack
supabase stop
```

Notes
- The recommended local workflow uses the Supabase CLI (`supabase start` / `supabase stop`). See `web/supabase/README.md` for project-level guidance on deployment and CI.
- Do NOT commit service role keys or other secrets into the repo; use CI secrets or local-only `.env` files.

## Run local Supabase and create `web/.env.local`

This section explains how to run the local Supabase stack (via the CLI), confirm it's healthy, and create or update `web/.env.local` so the web app points to the local Supabase instance.

1) Start the local Supabase stack (recommended)

- Install the Supabase CLI (see below) and run from the `web/supabase` folder or repo root:
```powershell
cd C:\dev\projects\SanDeVentura\web\supabase
supabase start
# or from repo root
cd C:\dev\projects\SanDeVentura\web
supabase start
```

- The CLI will bring up Docker containers for Postgres, Kong, Studio, and the Edge runtime. If you prefer the legacy compose, the file lives at the repo root `supabase-docker/docker-compose.yml` and can be run from that folder:
```powershell
cd C:\dev\projects\SanDeVentura\supabase-docker
docker compose up -d
```

2) Confirm containers and ports

- Verify the Supabase-related containers are Up/healthy:
```powershell
docker ps --filter "name=sandeventura_supabase" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

- Typical ports (repo defaults):
  - Kong (gateway / functions): host `54321` -> container `8000`
  - Postgres: host `54322` -> container `5432`
  - Studio: host `54323` -> container `3000`

3) Create `web/.env.local` (safe local-only file)

- Create or open `web/.env.local` and set at minimum these two values (example):
```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<copy-from-studio-or-supabase-cli>
```

- How to obtain the anon key:
  - Open Supabase Studio in your browser: http://127.0.0.1:54323
  - Project → Settings → API → find the `anon` (public) key and copy it.
  - Paste the value into `VITE_SUPABASE_ANON_KEY` in `web/.env.local`.

Note on host addressing (`localhost` vs `host.docker.internal`)

- When calling services from your host machine (browser / local dev server), prefer `http://127.0.0.1:54321` or `http://localhost:54321`.
- If a container needs to refer back to the host (container → host), use `host.docker.internal` (Windows/macOS Docker Desktop). Some functions or containerized tooling may require `host.docker.internal`.
- `web/supabase/.env.local` is used for functions/server-side env values — set `SUPABASE_URL` to `http://localhost:54321` when serving functions from the host; if the edge runtime runs inside a container and must reach host services, `host.docker.internal` may be needed.

4) Verify the configuration (quick checks)

- Functions endpoint (public/no auth for some dev endpoints):
```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:54321/functions/v1/get-mountains' -Method GET
```

- REST endpoint with anon key (example: `mountains` table):
```powershell
$anon = (Get-Content web/.env.local | Where-Object { $_ -match '^VITE_SUPABASE_ANON_KEY=' }) -replace '^VITE_SUPABASE_ANON_KEY='
Invoke-RestMethod -Uri 'http://127.0.0.1:54321/rest/v1/mountains?select=*' -Headers @{ 'apikey' = $anon; 'Authorization' = "Bearer $anon" }
```

If the REST request returns 200 and data, the anon key is valid for local Supabase. If you get 401/403, check RLS or key mismatch.

5) Safety and notes

- Keep `web/.env.local` in `.gitignore` (this repo already ignores `.env.*`). Do NOT commit sensitive keys.
- If Kong returns 503 for functions endpoints, check the edge runtime container logs:
```powershell
docker ps --filter "name=sandeventura_supabase_edge_runtime" --format "table {{.Names}}\t{{.Status}}"
docker logs -f sandeventura_supabase_edge_runtime
```
- If you need to regenerate local project keys, use the Supabase CLI or create a staging project — avoid using production keys on a developer workstation.

## Supabase CLI: installation and quick commands

- Windows (PowerShell) — npm:
```powershell
npm install -g supabase
supabase --version
```

- macOS (Homebrew):
```bash
brew install supabase/tap/supabase
```

- Start/stop local stack:
```powershell
# start from web/supabase or repo root
supabase start
supabase stop
```

- Reset local DB and apply migrations (WARNING: this wipes local data):
```powershell
supabase db reset
```

- Serve functions locally (development):
```powershell
cd C:\dev\projects\SanDeVentura\web
npx supabase functions serve --no-verify-jwt --env-file supabase/.env.local
```

- Deploy a function to a linked project:
```powershell
supabase functions deploy <function-name> --project-ref <PROJECT_REF>
```

## Legacy `supabase-docker` helper

- A legacy compose helper exists at the repository root `supabase-docker/` and may be present in the repo for historical reasons. We recommend migrating local workflows to the official `supabase` CLI. If you are removing `supabase-docker`, use the repository helper script at the repo root `remove-supabase-docker.ps1` to cleanly remove it from the working tree and stage the deletion for commit.
