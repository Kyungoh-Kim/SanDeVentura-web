# Supabase: local development and deployment

This folder contains the Supabase project artifacts used by the web app:
- Database migrations (`migrations/`)
- Edge Functions (`functions/`)
- Local config used for the Supabase CLI (`config.toml`, `.env.local`)

Overview
- We standardize on the official `supabase` CLI for local development and deployment tasks. The CLI manages Docker services for local emulation, applies migrations, and can serve or deploy Edge Functions.
- A legacy helper compose is present at the repository root (`supabase-docker/`) for reference; teams should prefer `supabase start` and the CLI-managed workflow unless there is a specific need for the custom compose.

GitHub Actions (auto-deploy)
- A workflow is included at `.github/workflows/supabase-deploy.yml` that can deploy functions and apply migrations when `web/supabase/**` changes.
- Required repository secrets for CI:
  - `SUPABASE_ACCESS_TOKEN` — personal CLI token used by the workflow to authenticate `supabase` commands.
  - `SUPABASE_PROJECT_REF` — project reference (e.g., `gpckbexzeacqminhlbsg`).
- Optional (server-only): `SUPABASE_SERVICE_ROLE_KEY` — a service role key for server-side operations; store as a secret and never expose to clients.

How the workflow operates
- The Actions job installs the Supabase CLI, links the project using `SUPABASE_PROJECT_REF`, applies migrations from `web/supabase/migrations`, and deploys Edge Functions from `web/supabase/functions`.
- If your team prefers a different migration strategy (e.g., `pg_restore`, `psql`, or a different migration tool), update the workflow accordingly.

Security
- Do NOT commit service role keys or other secret values. Use GitHub Actions secrets for CI and local-only `.env` files for developer workstations.
