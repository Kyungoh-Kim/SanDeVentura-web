import { useEffect, useMemo, useState } from 'react';

import { type OperatorOverviewMetrics, type OperatorRouteCoverage } from '../data/readModels';
import { fetchOperatorSummary, fetchRouteCoverage } from '../data/routesRepository';

export function OverviewPage() {
  const [metrics, setMetrics] = useState<OperatorOverviewMetrics | null>(null);
  const [coverage, setCoverage] = useState<OperatorRouteCoverage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedMountain, setSelectedMountain] = useState<string>('all');

  const mountains = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of coverage) seen.set(row.mountainId, row.mountainDisplayName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [coverage]);

  const filteredCoverage = useMemo(
    () => coverage.filter((r) => r.routeId !== null && (selectedMountain === 'all' || r.mountainId === selectedMountain)),
    [coverage, selectedMountain],
  );

  useEffect(() => {
    let cancelled = false;
    fetchOperatorSummary()
      .then((nextMetrics) => { if (!cancelled) setMetrics(nextMetrics); })
      .catch((nextError: Error) => { if (!cancelled) setError(nextError.message); });
    fetchRouteCoverage()
      .then((rows) => { if (!cancelled) setCoverage(rows); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="page-header">
        <h2>Overview</h2>
        <span className="page-badge">Operator only</span>
      </div>

      {error && (
        <div className="notice error">
          <strong>Summary metrics unavailable</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="stat-row">
        <StatCard
          label="Upload success"
          value={formatPercent(metrics?.uploadSuccessRate ?? null)}
          valueClass={metrics ? 'good' : undefined}
        />
        <StatCard
          label="Queued uploads"
          value={metrics ? metrics.queuedUploads.toString() : '–'}
          valueClass={metrics && metrics.queuedUploads > 10 ? 'warn' : undefined}
        />
        <StatCard
          label="Route confidence"
          value={formatPercent(metrics?.routeCoverage ?? null)}
          sub="avg across routes"
        />
        <StatCard
          label="Snap requests"
          value={metrics ? metrics.snapRequests.toLocaleString() : '–'}
        />
        <StatCard
          label="Trail served"
          value={metrics ? metrics.trailServed.toLocaleString() : '–'}
        />
      </div>

      <div style={{ display: 'grid', gap: 24 }}>
        <section>
          <div className="section-label">Route confidence</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 12px' }}>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, flex: 1 }}>
              각 루트의 canonical trail에 대한 신뢰도 점수입니다. GPS 세션 수·품질·경로 일관성·최신성을 종합합니다.
            </p>
            <select
              value={selectedMountain}
              onChange={(e) => setSelectedMountain(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-1)', color: 'var(--text-1)', cursor: 'pointer', flexShrink: 0 }}
            >
              <option value="all">전체 산</option>
              {mountains.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>

          {filteredCoverage.length > 0 ? (
            <div className="mountain-cards">
              {filteredCoverage.map((row) => (
                <ConfidenceCard key={row.routeId ?? row.mountainId} row={row} />
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No routes loaded.</div>
          )}

          <details style={{ marginTop: 14 }}>
            <summary style={{ fontSize: 12, color: 'var(--text-3)', cursor: 'pointer', userSelect: 'none' }}>
              Confidence 계산 수식 보기
            </summary>
            <div className="card" style={{ marginTop: 8, fontSize: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', lineHeight: 1.8 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', fontWeight: 600, paddingBottom: 4 }}>구성 요소</th>
                    <th style={{ textAlign: 'right', fontWeight: 600, paddingBottom: 4 }}>가중치</th>
                    <th style={{ textAlign: 'left', fontWeight: 400, color: 'var(--text-3)', paddingLeft: 16, paddingBottom: 4 }}>기준</th>
                  </tr>
                </thead>
                <tbody>
                  <FormulaRow factor="세션 기여도" weight="35%" note="min(sessionCount / 5, 1)" />
                  <FormulaRow factor="GPS 품질" weight="20%" note="평균 accuracy → quality score" />
                  <FormulaRow factor="전환 일관성" weight="15%" note="셀 간 이동 패턴 재현성" />
                  <FormulaRow factor="분기 명확성" weight="15%" note="경로가 단일 선형에 가까울수록 ↑" />
                  <FormulaRow factor="거절 포인트 비율" weight="10%" note="speed filter 통과율 (1 − rejectedRate)" />
                  <FormulaRow factor="최신성" weight="5%" note="마지막 세션 날짜 기반" />
                </tbody>
              </table>
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 6, color: 'var(--text-2)' }}>
                <strong>Recommended 조건</strong>: confidence ≥ 70% <em>AND</em> sessionCount ≥ 5 <em>AND</em> branchAmbiguity ≤ 30% <em>AND</em> gpsQuality ≥ 70% <em>AND</em> rejectedRate ≤ 30% <em>AND</em> recency ≥ 50%
              </div>
            </div>
          </details>
        </section>

        <section>
          <div className="section-label">구현 예정 기능</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <RoadmapCard
              title="실시간 활성 세션"
              badge="Active sessions"
              items={[
                'hiking_sessions WHERE status = \'active\' 폴링 또는 Supabase Realtime 구독',
                '세션 시작/종료 시 status 컬럼 업데이트 필요',
                '30초 간격 폴링 또는 WebSocket 채널로 라이브 카운트 표시',
              ]}
            />
            <RoadmapCard
              title="Field map 파이프라인 현황"
              badge="Field map status"
              items={[
                '최근 N일 내 업로드된 세션 수 → hiking_sessions.created_at 집계',
                '처리된 track_points 수 → track_points 테이블 집계 뷰',
                'Snap/Guide 요청 수 → mvp_events WHERE event_name IN (\'snap_requested\', \'trail_served\') 일별 집계',
              ]}
            />
            <RoadmapCard
              title="최근 이벤트 피드"
              badge="Recent events"
              items={[
                'mvp_events 테이블 폴링 (30s) 또는 Realtime 구독',
                'event_name + mountain_id + created_at 표시',
                '이벤트 타입별 아이콘/색상 구분 (trail_served, snap_requested 등)',
              ]}
            />
          </div>
        </section>
      </div>
    </>
  );
}

function ConfidenceCard({ row }: { row: OperatorRouteCoverage }) {
  const pct = row.confidence !== null ? Math.round(row.confidence * 100) : 0;
  const fillClass = pct === 0 ? 'low' : pct < 60 ? 'mid' : '';
  const gpsQualityPct = row.gpsQualityScore !== null ? Math.round(row.gpsQualityScore * 100) : null;
  const branchPct = row.branchAmbiguityScore !== null ? Math.round(row.branchAmbiguityScore * 100) : null;
  const sessionTarget = 5;

  return (
    <div className="mountain-card" key={row.routeId ?? row.mountainId}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{row.mountainDisplayName}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{row.routeDisplayName ?? row.mountainId}</div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '10px 0 4px' }}>
        <div className="mountain-pct">{pct}%</div>
        <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>confidence</span>
      </div>
      <div className="progress-track">
        <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
        <span title="세션 수">
          Sessions{' '}
          <strong style={{ color: row.sessionCount >= sessionTarget ? 'var(--success)' : 'var(--text-2)' }}>
            {row.sessionCount}/{sessionTarget}
          </strong>
        </span>
        {gpsQualityPct !== null && (
          <span title="GPS 품질 점수">GPS <strong style={{ color: 'var(--text-2)' }}>{gpsQualityPct}%</strong></span>
        )}
        {branchPct !== null && (
          <span title="분기 모호도 (낮을수록 좋음)">Branch <strong style={{ color: branchPct > 30 ? 'var(--warn)' : 'var(--text-2)' }}>{branchPct}%</strong></span>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <span className={`status-badge ${row.routeState}`}>{row.routeState}</span>
      </div>
    </div>
  );
}

function FormulaRow({ factor, weight, note }: { factor: string; weight: string; note: string }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '4px 0' }}>{factor}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{weight}</td>
      <td style={{ paddingLeft: 16, color: 'var(--text-3)' }}>{note}</td>
    </tr>
  );
}

function RoadmapCard({ title, badge, items }: { title: string; badge: string; items: string[] }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>{title}</div>
        <span style={{ fontSize: 10, padding: '2px 6px', background: 'var(--bg-2)', borderRadius: 4, color: 'var(--text-3)', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{badge}</span>
      </div>
      <ul className="bullet-list">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${valueClass ? ` ${valueClass}` : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function formatPercent(value: number | null) {
  if (value === null) return '–';
  return `${Math.round(value * 100)}%`;
}
