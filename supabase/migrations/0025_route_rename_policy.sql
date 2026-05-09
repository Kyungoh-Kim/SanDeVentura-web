-- =============================================================================
-- 0025_route_rename_policy.sql
-- Allows the operator dashboard (anon key) to update route display names.
-- Only display_name changes are intended; the WITH CHECK guards against blanks.
-- INSERT / DELETE remain blocked for non-service-role callers.
-- =============================================================================

create policy "Operator can rename routes"
  on public.routes
  for update
  using (true)
  with check (length(trim(display_name)) > 0);
