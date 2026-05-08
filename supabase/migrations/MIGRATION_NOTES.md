# Migration Notes

## Prefix convention

Migration files use a 4-digit zero-padded numeric prefix (e.g. `0012_...`).
Each prefix must be unique. Supabase applies migrations in alphabetical order.

## Known prefix collision: 0009

Two files share the `0009` prefix:

- `0009_mountains_bbox.sql` — adds `bbox` column to `mountains` (simple `ALTER TABLE ADD COLUMN`)
- `0009_schema_routes.sql` — creates the `routes` table and migrates `canonical_trails`, `trail_cells`, `trail_cell_transitions` from `mountain_id` to `route_id`

**Why this is safe**: alphabetical ordering means `0009_mountains_bbox.sql` runs first. It only adds a nullable column and does not conflict with anything in `0009_schema_routes.sql`. Both files have already been applied to production; renaming either would cause Supabase to treat it as a new migration and attempt re-application.

**Decision**: leave both filenames as-is. Document here. Never reuse prefix `0009`.

## Next available prefix

`0014` — prefixes `0012` and `0013` are used by the session-route attribution work (Sprint 9).
