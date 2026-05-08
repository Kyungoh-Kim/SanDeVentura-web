alter table public.mountains enable row level security;
alter table public.trail_cells enable row level security;
alter table public.trail_cell_transitions enable row level security;
alter table public.canonical_trails enable row level security;

create policy "Users can read mountain catalog"
  on public.mountains
  for select
  using (true);

create policy "Users can read canonical trail summaries"
  on public.canonical_trails
  for select
  using (true);

create policy "Block direct trail cell reads"
  on public.trail_cells
  for select
  using (false);

create policy "Block direct trail transition reads"
  on public.trail_cell_transitions
  for select
  using (false);

