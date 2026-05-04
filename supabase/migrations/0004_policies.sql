alter table public.hiking_sessions enable row level security;
alter table public.track_points enable row level security;
alter table public.rejected_track_points enable row level security;
alter table public.mvp_events enable row level security;

create policy "Users can read own session summaries"
  on public.hiking_sessions
  for select
  using (auth.uid() = user_id);

create policy "Block direct raw point reads"
  on public.track_points
  for select
  using (false);

create policy "Block direct rejected point reads"
  on public.rejected_track_points
  for select
  using (false);

