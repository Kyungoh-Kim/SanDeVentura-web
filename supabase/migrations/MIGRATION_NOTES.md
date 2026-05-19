# Migration Notes

The local database history was squashed after the trail graph inference model
replaced the earlier H3 cell, split-audit, and trajectory comparison pipelines.
Historical local sample data is not preserved on this branch.

Current migration layout:

- `0001_enable_extensions.sql` installs required extensions in the `extensions`
  schema and configures the database search path.
- `0002_current_schema.sql` is the current baseline schema for sessions,
  graph edges, candidate edges, attribution, metrics, operator views, RPCs, RLS,
  and runtime grants.
- `0003_sample_data.sql` seeds only catalog rows and dense raw upload-stage
  sample sessions. It uses roughly 5m GPS spacing across multiple trails per
  mountain, while the matcher is still responsible for producing graph edges,
  candidates, canonical trails, attribution, metrics, and raw purge state.

Removed migration groups:

- H3 cell support and candidate cell accumulation.
- Legacy split/split-audit RPCs.
- Comparison-era trajectory tables and aggregate trajectory metrics.
- No-op sample migrations that existed only to preserve historical ordering.
