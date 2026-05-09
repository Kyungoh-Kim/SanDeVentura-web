import { useEffect, useMemo, useState } from 'react';

import { type OperatorRouteQualityDetail } from '../data/readModels';
import {
  type EvaluateRouteSplitsResult,
  type MatchAndAggregateResult,
  type RouteSplitAuditEntry,
  fetchRouteSplitAudit,
  triggerEvaluateRouteSplits,
  triggerMatchAndAggregate,
} from '../data/operationsRepository';
import { fetchRouteQualityDetails } from '../data/routesRepository';

type QualityPageProps = {
  selectedRouteId: string | null;
  onSelectRoute: (id: string | null) => void;
};

export function QualityPage({ selectedRouteId, onSelectRoute }: QualityPageProps) {
  const [rows, setRows] = useState<OperatorRouteQualityDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcResult, setRecalcResult] = useState<MatchAndAggregateResult | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);

  const [auditEntries, setAuditEntries] = useState<RouteSplitAuditEntry[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluateResult, setEvaluateResult] = useState<EvaluateRouteSplitsResult | null>(null);
  const [evaluateError, setEvaluateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRouteQualityDetails()
      .then((nextRows) => {
        if (!cancelled) {
          setRows(nextRows);
          if (selectedRouteId === null) {
            onSelectRoute(nextRows.find((r) => r.routeId !== null)?.routeId ?? null);
          }
        }
      })
      .catch((nextError: Error) => { if (!cancelled) setError(nextError.message); });
    fetchRouteSplitAudit()
      .then((entries) => { if (!cancelled) setAuditEntries(entries); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleEvaluateSplits(dryRun: boolean) {
    setEvaluating(true);
    setEvaluateResult(null);
    setEvaluateError(null);
    try {
      const result = await triggerEvaluateRouteSplits(undefined, dryRun);
      setEvaluateResult(result);
      const entries = await fetchRouteSplitAudit();
      setAuditEntries(entries);
    } catch (err) {
      setEvaluateError(err instanceof Error ? err.message : String(err));
    } finally {
      setEvaluating(false);
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    setRecalcResult(null);
    setRecalcError(null);
    try {
      const result = await triggerMatchAndAggregate();
      setRecalcResult(result);
      const nextRows = await fetchRouteQualityDetails();
      setRows(nextRows);
    } catch (err) {
      setRecalcError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecalculating(false);
    }
  }

  const counts = useMemo(() => ({
    recommended: rows.filter((r) => r.routeState === 'recommended').length,
    reference: rows.filter((r) => r.routeState === 'reference').length,
    missing: rows.filter((r) => r.routeState === 'none').length,
  }), [rows]);

  const totalAccepted = rows.reduce((s, r) => s + r.acceptedPointCount, 0);
  const totalRejected = rows.reduce((s, r) => s + r.rejectedPointCount, 0);

  const selectedRow = rows.find((r) => r.routeId === selectedRouteId) ?? null;

  return (
    <>
      <div className="page-header">
        <h2>Quality</h2>
        <span className="page-badge">Operator only</span>
        <button
          className="btn btn-ghost"
          onClick={handleRecalculate}
          disabled={recalculating}
          style={{ marginLeft: 'auto' }}
        >
          {recalculating ? 'Recalculating…' : 'Recalculate hitmaps'}
        </button>
      </div>

      {recalcResult && (
        <div className="notice success">
          <strong>Recalculation complete</strong>
          <span>
            {recalcResult.processedSessions} sessions processed &middot;{' '}
            {recalcResult.affectedRoutes} routes updated &middot;{' '}
            {recalcResult.orphanCellsAdded} orphan cells added
            {recalcResult.candidateClustersFormed > 0
              ? ` · ${recalcResult.candidateClustersFormed} candidate clusters`
              : ''}
          </span>
        </div>
      )}
      {recalcError && (
        <div className="notice error"><strong>Recalculation failed</strong><span>{recalcError}</span></div>
      )}
      {error && (
        <div className="notice error"><strong>Quality detail unavailable</strong><span>{error}</span></div>
      )}

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-label">Recommended</div>
          <div className="stat-value good">{counts.recommended}</div>
          <div className="stat-sub">routes</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Reference</div>
          <div className="stat-value warn">{counts.reference}</div>
          <div className="stat-sub">routes</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">No route</div>
          <div className="stat-value">{counts.missing}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Accepted pts</div>
          <div className="stat-value">{totalAccepted.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rejected pts</div>
          <div className="stat-value">{totalRejected.toLocaleString()}</div>
        </div>
      </div>

      <div className="quality-layout">
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="table-panel">
            <div className="table-panel-header">
              <span className="table-panel-title">Route quality</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>행 클릭 → confidence 상세</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Mountain</th>
                  <th>State</th>
                  <th>Confidence</th>
                  <th>Sessions</th>
                  <th>GPS</th>
                  <th>Ambiguity</th>
                  <th>Accepted</th>
                  <th>Rejected</th>
                  <th>Latest evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((row) => row.routeId !== null).map((row) => {
                  const isSelected = row.routeId === selectedRouteId;
                  return (
                    <tr
                      key={row.routeId ?? row.mountainId}
                      className={isSelected ? 'selected-row' : ''}
                      style={{ cursor: row.routeId !== null ? 'pointer' : undefined }}
                      onClick={() => { if (row.routeId !== null) onSelectRoute(row.routeId); }}
                    >
                      <td>
                        <span className="cell-name" style={{ fontWeight: isSelected ? 700 : 400 }}>
                          {row.routeDisplayName ?? '—'}
                        </span>
                        <span className="cell-sub">{row.routeId ?? '—'}</span>
                      </td>
                      <td>
                        <span className="cell-name" style={{ fontWeight: isSelected ? 700 : 400 }}>
                          {row.mountainDisplayName}
                        </span>
                        <span className="cell-sub">{row.mountainId}</span>
                      </td>
                      <td><span className={`status-badge ${row.routeState}`}>{row.routeState}</span></td>
                      <td>{formatScore(row.confidence)}</td>
                      <td>{row.sessionCount}</td>
                      <td>{formatScore(row.gpsQualityScore)}</td>
                      <td>{formatScore(row.branchAmbiguityScore)}</td>
                      <td>{row.acceptedPointCount.toLocaleString()}</td>
                      <td>{row.rejectedPointCount.toLocaleString()}</td>
                      <td style={{ fontSize: 12 }}>{formatDate(row.latestEvidenceAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="side-stack">
          <div className="card">
            <div className="card-title">
              Confidence inputs
              {selectedRow && (
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)', marginLeft: 6 }}>
                  — {selectedRow.routeDisplayName ?? selectedRow.routeId}
                </span>
              )}
            </div>
            {selectedRow ? (
              <>
                <ScoreRow label="세션 기여도" value={Math.min(1, selectedRow.sessionCount / 5)} max={1} note={`${selectedRow.sessionCount} / 5`} />
                <ScoreRow label="GPS 품질" value={selectedRow.gpsQualityScore} max={1} />
                <ScoreRow label="분기 명확성" value={selectedRow.branchAmbiguityScore} max={1} invert />
                <ScoreRow label="Confidence" value={selectedRow.confidence} max={1} bold />
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
                  Accepted {selectedRow.acceptedPointCount.toLocaleString()} pts
                  &nbsp;·&nbsp;
                  Rejected {selectedRow.rejectedPointCount.toLocaleString()} pts
                  {selectedRow.acceptedPointCount + selectedRow.rejectedPointCount > 0 && (
                    <> ({Math.round(selectedRow.rejectedPointCount / (selectedRow.acceptedPointCount + selectedRow.rejectedPointCount) * 100)}% rejected)</>
                  )}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>행을 선택하세요.</p>
            )}
          </div>

          <div className="card">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              자동 분할 이력
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}
                onClick={() => handleEvaluateSplits(true)}
                disabled={evaluating}
              >
                Dry-run
              </button>
              <button
                className="btn btn-primary"
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => handleEvaluateSplits(false)}
                disabled={evaluating}
              >
                {evaluating ? '…' : 'Execute'}
              </button>
            </div>
            {evaluateResult && (
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>
                {evaluateResult.plansEvaluated === 0
                  ? '분기 후보 없음.'
                  : `${evaluateResult.plansEvaluated}개 평가 · ${evaluateResult.plansValid}개 유효 · ${evaluateResult.dryRun ? 'dry-run' : '실행됨'}`}
              </div>
            )}
            {evaluateError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{evaluateError}</div>
            )}
            {auditEntries.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>분할 이력 없음.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {auditEntries.slice(0, 10).map((entry) => (
                  <div key={entry.id} style={{ fontSize: 12, borderLeft: '3px solid var(--border)', paddingLeft: 8 }}>
                    <div style={{ fontWeight: 600, color: entry.dryRun ? 'var(--text-3)' : 'var(--text-1)' }}>
                      {entry.originalRouteId}
                      {entry.dryRun && <span style={{ fontWeight: 400, marginLeft: 4 }}>(dry-run)</span>}
                    </div>
                    <div style={{ color: 'var(--text-3)' }}>
                      confidence {entry.cfgConfidence?.toFixed(2) ?? '—'} · ratio {entry.crossBranchRatio?.toFixed(2) ?? '—'} · {entry.affectedSessionCount} sessions
                    </div>
                    <div style={{ color: 'var(--text-3)' }}>{new Date(entry.decidedAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">구현 예정 기능</div>
            <ul className="bullet-list">
              <li>
                <strong>품질 알림</strong> — confidence가 임계값 이하로 떨어지거나 최신성(recency)이 낮아질 때
                오퍼레이터에게 알림. mvp_events 또는 별도 quality_alerts 테이블 필요.
              </li>
              <li>
                <strong>거절 포인트 감사</strong> — 루트별 거절률이 높은 세션 목록 드릴다운.
                rejected_track_points 테이블 조회 + 세션별 reason 분석.
              </li>
              <li>
                <strong>신뢰도 변화 추이</strong> — canonical_trails의 version 이력을 기반으로
                confidence 시계열 차트. 현재 latest version만 조회 중.
              </li>
              <li>
                <strong>루트별 알림 임계값 설정</strong> — recommended 기준(현재 전역 상수)을
                산/루트별로 다르게 설정할 수 있는 UI.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function ScoreRow({
  label,
  value,
  max,
  invert = false,
  bold = false,
  note,
}: {
  label: string;
  value: number | null;
  max: number;
  invert?: boolean;
  bold?: boolean;
  note?: string;
}) {
  const raw = value ?? 0;
  const pct = Math.min(100, Math.round((raw / max) * 100));
  const displayPct = invert ? 100 - pct : pct;
  const fillClass = displayPct >= 70 ? '' : displayPct >= 40 ? 'mid' : 'low';
  const display = value === null ? '-' : max === 1 ? value.toFixed(2) : String(Math.round(raw));

  return (
    <div className="score-row">
      <span className="score-label" style={{ fontWeight: bold ? 600 : undefined }}>
        {label}
        {note && <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 4 }}>({note})</span>}
      </span>
      <div className="score-track">
        <div className={`score-fill ${fillClass}`} style={{ width: `${displayPct}%` }} />
      </div>
      <span className="score-val" style={{ fontWeight: bold ? 600 : undefined }}>{display}</span>
    </div>
  );
}

function formatScore(value: number | null) {
  if (value === null) return '-';
  return value.toFixed(2);
}

function formatDate(value: string | null) {
  if (value === null) return '-';
  return new Date(value).toLocaleString();
}
