-- =============================================================================
-- 0031_route_correction_diagnostics.sql
-- Diagnostics for path-level H3 route matching and split decisions.
-- =============================================================================

alter table public.session_route_assignments
  add column if not exists match_method text not null default 'exact_overlap',
  add column if not exists frechet_distance double precision,
  add column if not exists overlap_ratio double precision,
  add column if not exists score_margin double precision;

alter table public.session_route_assignments
  drop constraint if exists session_route_assignments_match_method_check;

alter table public.session_route_assignments
  add constraint session_route_assignments_match_method_check
  check (match_method in ('exact_overlap', 'frechet_match', 'candidate_residual'));

alter table public.route_split_audit
  add column if not exists invalid_reason text,
  add column if not exists match_score double precision,
  add column if not exists frechet_distance double precision,
  add column if not exists cluster_weight double precision,
  add column if not exists auto_decision text not null default 'review_required';

alter table public.route_split_audit
  drop constraint if exists route_split_audit_auto_decision_check;

alter table public.route_split_audit
  add constraint route_split_audit_auto_decision_check
  check (auto_decision in ('auto_split', 'review_required'));

drop view if exists public.operator_session_route_attribution;

create or replace view public.operator_session_route_attribution as
select
  sca.session_id,
  sca.route_id,
  r.display_name as route_display_name,
  count(*)::integer as cell_count,
  coalesce(sum(sca.point_count), 0)::integer as point_count,
  coalesce(max(sra.contributed_transition_count), 0)::integer as transition_count,
  coalesce(max(sra.match_method), 'exact_overlap') as match_method,
  max(sra.frechet_distance) as frechet_distance,
  max(sra.overlap_ratio) as overlap_ratio,
  max(sra.score_margin) as score_margin,
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
  sra.match_method,
  sra.frechet_distance,
  sra.overlap_ratio,
  sra.score_margin,
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
