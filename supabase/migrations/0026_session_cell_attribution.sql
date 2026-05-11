-- =============================================================================
-- 0026_session_cell_attribution.sql
-- Stores per-session cell attribution for operator diagnostics without exposing
-- raw GPS points or coordinates.
-- =============================================================================

do $$
begin
  create type public.session_attribution_target_kind as enum ('route', 'candidate');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.session_cell_attributions (
  session_id    uuid not null references public.hiking_sessions(id) on delete cascade,
  mountain_id   text not null references public.mountains(id) on delete cascade,
  target_kind   public.session_attribution_target_kind not null,
  route_id      text references public.routes(id) on delete cascade,
  cell_key      text not null,
  point_count   integer not null,
  avg_accuracy  double precision,
  avg_altitude  double precision,
  last_seen_at  timestamptz,
  matched_at    timestamptz not null default now(),
  constraint session_cell_attributions_route_required check (
    (target_kind = 'route' and route_id is not null)
    or (target_kind = 'candidate' and route_id is null)
  )
);

create unique index if not exists session_cell_attributions_route_key
  on public.session_cell_attributions (session_id, route_id, cell_key)
  where target_kind = 'route';

create unique index if not exists session_cell_attributions_candidate_key
  on public.session_cell_attributions (session_id, cell_key)
  where target_kind = 'candidate';

create index if not exists session_cell_attributions_session_idx
  on public.session_cell_attributions (session_id);

create index if not exists session_cell_attributions_mountain_idx
  on public.session_cell_attributions (mountain_id);

alter table public.session_cell_attributions enable row level security;

create or replace function public.replace_session_cell_attributions(
  p_session_id uuid,
  p_rows       jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.session_cell_attributions
   where session_id = p_session_id;

  insert into public.session_cell_attributions (
    session_id,
    mountain_id,
    target_kind,
    route_id,
    cell_key,
    point_count,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    matched_at
  )
  select
    p_session_id,
    row->>'mountainId',
    (row->>'targetKind')::public.session_attribution_target_kind,
    nullif(row->>'routeId', ''),
    row->>'cellKey',
    (row->>'pointCount')::integer,
    (row->>'avgAccuracy')::double precision,
    (row->>'avgAltitude')::double precision,
    (row->>'lastSeenAt')::timestamptz,
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  where row->>'cellKey' is not null
    and row->>'mountainId' is not null
    and row->>'targetKind' in ('route', 'candidate')
    and row->>'pointCount' is not null;
end;
$$;

create or replace view public.operator_session_ingestion as
with exact_by_session as (
  select
    session_id,
    count(distinct route_id) filter (where target_kind = 'route')::integer as matched_route_count,
    count(*) filter (where target_kind = 'route')::integer as matched_route_cell_count,
    coalesce(sum(point_count) filter (where target_kind = 'route'), 0)::integer as matched_route_point_count,
    count(*) filter (where target_kind = 'candidate')::integer as candidate_cell_count,
    coalesce(sum(point_count) filter (where target_kind = 'candidate'), 0)::integer as candidate_point_count,
    count(*)::integer as exact_cell_count
  from public.session_cell_attributions
  group by session_id
),
approx_route_by_session as (
  select
    session_id,
    count(distinct route_id)::integer as matched_route_count,
    coalesce(sum(contributed_cell_count), 0)::integer as matched_route_cell_count
  from public.session_route_assignments
  group by session_id
),
approx_candidate_by_session as (
  select
    session_id,
    count(*)::integer as candidate_cell_count
  from (
    select
      unnest(contributing_sessions) as session_id,
      cell_key
    from public.candidate_cells
  ) candidate_sessions
  group by session_id
)
select
  hs.id as session_id,
  hs.mountain_id,
  m.display_name as mountain_display_name,
  hs.route_id,
  hs.status as pipeline_state,
  hs.status as upload_state,
  hs.upload_consent_version as consent_version,
  hs.accepted_point_count,
  hs.rejected_point_count,
  null::text as last_error,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_count, 0)
    else coalesce(approx_route_by_session.matched_route_count, 0)
  end as matched_route_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_cell_count, 0)
    else coalesce(approx_route_by_session.matched_route_cell_count, 0)
  end as matched_route_cell_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_point_count, 0)
    else null::integer
  end as matched_route_point_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.candidate_cell_count, 0)
    else coalesce(approx_candidate_by_session.candidate_cell_count, 0)
  end as candidate_cell_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.candidate_point_count, 0)
    else null::integer
  end as candidate_point_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0 then 'exact'
    when coalesce(approx_route_by_session.matched_route_cell_count, 0) > 0
      or coalesce(approx_candidate_by_session.candidate_cell_count, 0) > 0
      then 'approximate'
    else 'none'
  end as attribution_precision
from public.hiking_sessions hs
join public.mountains m on m.id = hs.mountain_id
left join exact_by_session on exact_by_session.session_id = hs.id
left join approx_route_by_session on approx_route_by_session.session_id = hs.id
left join approx_candidate_by_session on approx_candidate_by_session.session_id = hs.id;

create or replace view public.operator_session_route_attribution as
select
  sca.session_id,
  sca.route_id,
  r.display_name as route_display_name,
  count(*)::integer as cell_count,
  coalesce(sum(sca.point_count), 0)::integer as point_count,
  coalesce(max(sra.contributed_transition_count), 0)::integer as transition_count,
  'exact'::text as attribution_precision
from public.session_cell_attributions sca
join public.routes r on r.id = sca.route_id
left join public.session_route_assignments sra
  on sra.session_id = sca.session_id
 and sra.route_id = sca.route_id
where sca.target_kind = 'route'
group by sca.session_id, sca.route_id, r.display_name
union all
select
  sra.session_id,
  sra.route_id,
  r.display_name as route_display_name,
  sra.contributed_cell_count as cell_count,
  null::integer as point_count,
  sra.contributed_transition_count as transition_count,
  'approximate'::text as attribution_precision
from public.session_route_assignments sra
join public.routes r on r.id = sra.route_id
where not exists (
  select 1
  from public.session_cell_attributions sca
  where sca.session_id = sra.session_id
    and sca.target_kind = 'route'
    and sca.route_id = sra.route_id
);

create or replace view public.operator_session_cell_attribution as
select
  sca.session_id,
  sca.target_kind::text as target_kind,
  sca.route_id,
  r.display_name as route_display_name,
  sca.cell_key,
  sca.point_count,
  sca.avg_accuracy,
  sca.avg_altitude,
  sca.last_seen_at
from public.session_cell_attributions sca
left join public.routes r on r.id = sca.route_id;

create or replace function public.sync_session_cell_attributions_after_split(
  p_mountain_id              text,
  p_original_route_id        text,
  p_branch_point_cell_key    text,
  p_segment_b_route_id       text,
  p_segment_b_cell_keys      text[],
  p_branch_route_id          text,
  p_branch_cell_keys         text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.session_cell_attributions
     set route_id = p_segment_b_route_id,
         matched_at = now()
   where target_kind = 'route'
     and route_id = p_original_route_id
     and cell_key = any(p_segment_b_cell_keys)
     and cell_key <> p_branch_point_cell_key;

  insert into public.session_cell_attributions (
    session_id,
    mountain_id,
    target_kind,
    route_id,
    cell_key,
    point_count,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    matched_at
  )
  select
    session_id,
    mountain_id,
    'route'::public.session_attribution_target_kind,
    p_segment_b_route_id,
    cell_key,
    point_count,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    now()
  from public.session_cell_attributions
  where target_kind = 'route'
    and route_id = p_original_route_id
    and cell_key = p_branch_point_cell_key
  on conflict do nothing;

  update public.session_cell_attributions
     set target_kind = 'route',
         route_id = p_branch_route_id,
         matched_at = now()
   where target_kind = 'candidate'
     and mountain_id = p_mountain_id
     and cell_key = any(p_branch_cell_keys);
end;
$$;
