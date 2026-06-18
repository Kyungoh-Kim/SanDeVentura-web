Supabase deployment and GitHub Actions

This folder contains Supabase project artifacts (migrations, Edge Functions).

Auto-deploy workflow
- A GitHub Actions workflow is included at `.github/workflows/supabase-deploy.yml`.
- It triggers on pushes that touch files under `web/supabase/**` and can be run manually.

Required repository Secrets (GitHub):
- SUPABASE_ACCESS_TOKEN: personal access token / CLI token used to authenticate `supabase login`.
- SUPABASE_PROJECT_REF: project ref (e.g., gpckbexzeacqminhlbsg).

Optional:
- SUPABASE_SERVICE_ROLE_KEY: service role key — store as a secret and use only for server-side tasks (do not put in client apps).

How to enable
1. In your GitHub repo: Settings → Secrets and variables → Actions → New repository secret.
   - Add SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (and SUPABASE_SERVICE_ROLE_KEY if needed).
2. Push changes to `web/supabase/*` or run the workflow manually from the Actions tab.

Notes
- The workflow installs the Supabase CLI and Deno, links the project with the provided PROJECT_REF, applies migrations (if any) and deploys Edge Functions.
- If `supabase db push` is not suitable for your workflow, replace it with your preferred migration command (pg_restore/psql, supabase migrations, etc.).
- Do NOT commit sensitive keys to the repo.
