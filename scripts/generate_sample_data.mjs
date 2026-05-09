/**
 * Generates 0019_sample_data_v2.sql
 * Run: node scripts/generate_sample_data.mjs > supabase/migrations/0019_sample_data_v2.sql
 *
 * Simulates the full match-and-aggregate pipeline:
 *   1. GPS track points at 30s intervals with noise
 *   2. Speed filter (reject >10 km/h)
 *   3. H3 cell computation including edge cells (gridPathCells)
 *   4. Canonical trail inference from accumulated cells/transitions
 */

import { cellToLatLng, gridPathCells, latLngToCell } from 'h3-js';

const H3_RES = 11;
const GPS_INTERVAL_SEC = 30;
const WALKING_SPEED_MS = 3.5 * 1000 / 3600; // 3.5 km/h in m/s
const GPS_NOISE_M = 6;
const SPEED_REJECT_MS = 10 * 1000 / 3600; // 10 km/h reject threshold
const ACCURACY_REJECT_M = 25;

// ── Route definitions ────────────────────────────────────────────────────────
// [lon, lat, altMeters]

const ROUTES = {
  'sorak-main': {
    mountainId: 'sorak',
    displayName: '주능선 코스',
    sessionCount: 6,
    waypoints: [
      [128.44500, 38.09700, 650], [128.44720, 38.10350, 740],
      [128.44960, 38.11000, 830], [128.45230, 38.11600, 920],
      [128.45540, 38.12100, 1010], [128.45780, 38.12700, 1100],
      [128.45920, 38.13350, 1190], [128.46010, 38.13950, 1280],
      [128.46100, 38.14500, 1370], [128.46180, 38.14900, 1460],
      [128.46220, 38.15000, 1540],
    ],
  },
  'sorak-alternate': {
    mountainId: 'sorak',
    displayName: '울산바위 우회',
    sessionCount: 3,
    waypoints: [
      [128.44500, 38.09700, 650], [128.44200, 38.10100, 720],
      [128.43780, 38.10700, 790], [128.43380, 38.11200, 860],
      [128.43020, 38.11700, 920], [128.42770, 38.12200, 970],
      [128.42620, 38.12700, 1030], [128.42600, 38.13200, 1090],
      [128.42740, 38.13700, 1140], [128.43100, 38.14100, 1200],
      [128.43620, 38.14450, 1270], [128.44200, 38.14720, 1340],
      [128.44900, 38.14900, 1420], [128.45600, 38.14980, 1490],
      [128.46220, 38.15000, 1550],
    ],
  },
  'sorak-osaek': {
    mountainId: 'sorak',
    displayName: '오색 코스',
    sessionCount: 3,
    waypoints: [
      [128.54000, 38.10800, 720], [128.53100, 38.11400, 800],
      [128.52200, 38.12000, 880], [128.51300, 38.12550, 960],
      [128.50350, 38.13050, 1040], [128.49500, 38.13550, 1120],
      [128.48700, 38.14000, 1200], [128.47920, 38.14420, 1280],
      [128.47200, 38.14750, 1360], [128.46600, 38.14940, 1450],
      [128.46220, 38.15000, 1540],
    ],
  },
  'sorak-hangyeryeong': {
    mountainId: 'sorak',
    displayName: '한계령 코스',
    sessionCount: 2,
    waypoints: [
      [128.40200, 38.16800, 1020], [128.40900, 38.16500, 1100],
      [128.41600, 38.16200, 1180], [128.42300, 38.15900, 1260],
      [128.43000, 38.15700, 1330], [128.43700, 38.15500, 1400],
      [128.44300, 38.15300, 1460], [128.44900, 38.15150, 1510],
      [128.45500, 38.15050, 1560], [128.46220, 38.15000, 1620],
    ],
  },
  'halla-main': {
    mountainId: 'halla',
    displayName: '성판악 코스',
    sessionCount: 3,
    waypoints: [
      [126.60700, 33.31600, 520], [126.59800, 33.32100, 640],
      [126.58900, 33.32600, 760], [126.58000, 33.33100, 880],
      [126.57100, 33.33580, 1000], [126.56200, 33.34020, 1120],
      [126.55380, 33.34430, 1240], [126.54620, 33.34820, 1360],
      [126.53940, 33.35180, 1480], [126.53420, 33.35560, 1600],
      [126.53020, 33.35900, 1720], [126.52900, 33.36200, 1850],
    ],
  },
  'halla-eorimok': {
    mountainId: 'halla',
    displayName: '어리목 코스',
    sessionCount: 6,
    waypoints: [
      [126.46300, 33.38000, 980], [126.47000, 33.37600, 1060],
      [126.47700, 33.37200, 1140], [126.48450, 33.36800, 1220],
      [126.49200, 33.36520, 1300], [126.49980, 33.36350, 1370],
      [126.50780, 33.36250, 1440], [126.51580, 33.36200, 1510],
      [126.52280, 33.36200, 1580], [126.52800, 33.36200, 1650],
      [126.52900, 33.36200, 1850],
    ],
  },
  'halla-yeongsil': {
    mountainId: 'halla',
    displayName: '영실 코스',
    sessionCount: 2,
    waypoints: [
      [126.49200, 33.33000, 1280], [126.49800, 33.33600, 1360],
      [126.50450, 33.34150, 1440], [126.51020, 33.34680, 1520],
      [126.51560, 33.35140, 1580], [126.52000, 33.35560, 1640],
      [126.52350, 33.35880, 1700], [126.52580, 33.36060, 1760],
      [126.52760, 33.36160, 1820], [126.52900, 33.36200, 1890],
    ],
  },
  'dobong-main': {
    mountainId: 'dobong',
    displayName: '도봉산 주등산로',
    sessionCount: 6,
    waypoints: [
      [127.01700, 37.65600, 120], [127.01780, 37.66100, 190],
      [127.01830, 37.66600, 260], [127.01890, 37.67100, 330],
      [127.01940, 37.67600, 400], [127.01970, 37.68100, 460],
      [127.01990, 37.68550, 520], [127.02010, 37.69000, 580],
      [127.02000, 37.69200, 640],
    ],
  },
  'dobong-west': {
    mountainId: 'dobong',
    displayName: '서쪽 능선 코스',
    sessionCount: 3,
    waypoints: [
      [127.00200, 37.68200, 270], [127.00500, 37.68400, 330],
      [127.00820, 37.68520, 380], [127.01100, 37.68620, 430],
      [127.01400, 37.68720, 470], [127.01600, 37.68850, 510],
      [127.01780, 37.69000, 550], [127.01900, 37.69120, 590],
      [127.02000, 37.69200, 640],
    ],
  },
};

// Orphan (no route) sessions → become candidate_cells
const ORPHAN_SESSIONS = [
  {
    mountainId: 'bukhan',
    sessionCount: 3,
    // Follows a path inside bukhan bbox
    waypoints: [
      [126.9700, 37.6630, 200], [126.9720, 37.6660, 230],
      [126.9750, 37.6700, 280], [126.9775, 37.6735, 340],
      [126.9800, 37.6760, 400], [126.9820, 37.6785, 450],
      [126.9840, 37.6810, 510], [126.9855, 37.6840, 570],
      [126.9870, 37.6870, 630], [126.9880, 37.6900, 680],
    ],
  },
];

// Unprocessed sessions (have track_points but not yet matched to routes)
const JIRI_WAYPOINTS = [
  [127.7300, 35.3400, 480], [127.7320, 35.3430, 510],
  [127.7345, 35.3460, 550], [127.7370, 35.3490, 590],
  [127.7395, 35.3520, 640],
];

// ── Math helpers ─────────────────────────────────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Deterministic pseudo-noise (reproducible sample data)
function deterministicNoise(seed) {
  return Math.sin(seed * 127.1 + 311.7) * Math.cos(seed * 269.5 + 183.3);
}

function addNoise(lat, lon, stdM, seed) {
  const mPerDegLat = 111_000;
  const mPerDegLon = 111_000 * Math.cos(lat * Math.PI / 180);
  return [
    lat + deterministicNoise(seed) * stdM / mPerDegLat,
    lon + deterministicNoise(seed + 7777) * stdM / mPerDegLon,
  ];
}

// ── GPS track generation ─────────────────────────────────────────────────────

function generateTrack(waypoints, sessionIdx, noiseSeed = 0) {
  const points = [];
  let seqIdx = 0;
  let elapsedSec = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const [lon1, lat1, alt1] = waypoints[i];
    const [lon2, lat2, alt2] = waypoints[i + 1];
    const segDist = haversine(lat1, lon1, lat2, lon2);
    const segTimeSec = segDist / WALKING_SPEED_MS;
    const numSteps = Math.max(1, Math.ceil(segTimeSec / GPS_INTERVAL_SEC));

    for (let s = 0; s < numSteps; s++) {
      const t = s / numSteps;
      const bLat = lat1 + (lat2 - lat1) * t;
      const bLon = lon1 + (lon2 - lon1) * t;
      const alt = alt1 + (alt2 - alt1) * t;
      const seed = noiseSeed + sessionIdx * 100000 + i * 1000 + s;
      const [lat, lon] = addNoise(bLat, bLon, GPS_NOISE_M, seed);
      const accuracy = 5 + Math.abs(deterministicNoise(seed + 500)) * 8;
      points.push({ lat, lon, alt, accuracy, seqIdx: seqIdx++, elapsedSec });
      elapsedSec += GPS_INTERVAL_SEC;
    }
  }

  // Final waypoint
  const [lon, lat, alt] = waypoints[waypoints.length - 1];
  const seed = noiseSeed + sessionIdx * 100000 + 99999;
  const [nlat, nlon] = addNoise(lat, lon, GPS_NOISE_M, seed);
  points.push({ lat: nlat, lon: nlon, alt, accuracy: 7, seqIdx: seqIdx++, elapsedSec });

  return points;
}

// Inject 1–2 GPS glitch points (very high speed) per session
function injectGlitches(points, sessionIdx) {
  if (points.length < 10) return points;
  const result = [...points];
  const glitchIdx = Math.floor(points.length * (0.3 + 0.2 * (sessionIdx % 3)));
  const prev = result[glitchIdx];
  // Jump ~500m away instantly → speed will be ~60 km/h
  const metersPerDeg = 111_000;
  result.splice(glitchIdx + 1, 0, {
    lat: prev.lat + 500 / metersPerDeg,
    lon: prev.lon + 300 / metersPerDeg,
    alt: prev.alt,
    accuracy: 45, // also bad accuracy
    seqIdx: prev.seqIdx + 0.5,
    elapsedSec: prev.elapsedSec + GPS_INTERVAL_SEC,
  });
  // Re-index sequence
  for (let i = 0; i < result.length; i++) result[i].seqIdx = i;
  return result;
}

// Speed filter: returns { accepted, rejected }
function filterPoints(points) {
  const accepted = [];
  const rejected = [];
  let prevAccepted = null;

  for (const pt of points) {
    if (prevAccepted === null) {
      accepted.push(pt);
      prevAccepted = pt;
      continue;
    }
    const dist = haversine(prevAccepted.lat, prevAccepted.lon, pt.lat, pt.lon);
    const dt = Math.max(0.1, pt.elapsedSec - prevAccepted.elapsedSec);
    const speedMs = dist / dt;

    if (speedMs > SPEED_REJECT_MS || pt.accuracy > ACCURACY_REJECT_M) {
      rejected.push(pt);
    } else {
      accepted.push(pt);
      prevAccepted = pt;
    }
  }
  return { accepted, rejected };
}

// ── H3 hitmap (mirrors route_inference.ts buildSessionHitmap) ────────────────

function buildHitmap(accepted, sessionId) {
  const sorted = [...accepted].sort((a, b) => a.seqIdx - b.seqIdx);

  // Expand with gridPathCells (mirrors expandWithGridPath)
  const expanded = [];
  for (let i = 0; i < sorted.length; i++) {
    expanded.push(sorted[i]);
    if (i < sorted.length - 1) {
      const fromKey = latLngToCell(sorted[i].lat, sorted[i].lon, H3_RES);
      const toKey = latLngToCell(sorted[i + 1].lat, sorted[i + 1].lon, H3_RES);
      if (fromKey !== toKey) {
        try {
          const path = gridPathCells(fromKey, toKey);
          for (let j = 1; j < path.length - 1; j++) {
            const t = j / (path.length - 1);
            const [clat, clon] = cellToLatLng(path[j]);
            expanded.push({
              lat: clat, lon: clon,
              alt: sorted[i].alt + (sorted[i + 1].alt - sorted[i].alt) * t,
              accuracy: sorted[i].accuracy,
              seqIdx: sorted[i].seqIdx + t,
              elapsedSec: sorted[i].elapsedSec,
            });
          }
        } catch (_) { /* distant cells, skip */ }
      }
    }
  }
  expanded.sort((a, b) => a.seqIdx - b.seqIdx);

  // Aggregate cells
  const cells = {};
  for (const pt of expanded) {
    const key = latLngToCell(pt.lat, pt.lon, H3_RES);
    if (!cells[key]) {
      cells[key] = {
        cellKey: key,
        latSum: 0, lonSum: 0, altSum: 0, altCount: 0,
        pointCount: 0, accuracySum: 0, sessions: new Set(),
      };
    }
    const c = cells[key];
    c.latSum += pt.lat; c.lonSum += pt.lon;
    c.pointCount++; c.accuracySum += pt.accuracy;
    c.sessions.add(sessionId);
    if (pt.alt !== undefined) { c.altSum += pt.alt; c.altCount++; }
  }

  // Aggregate transitions
  const transitions = {};
  let prevKey = null;
  for (const pt of expanded) {
    const key = latLngToCell(pt.lat, pt.lon, H3_RES);
    if (prevKey && prevKey !== key) {
      const tk = `${prevKey}->${key}`;
      if (!transitions[tk]) {
        transitions[tk] = { fromCellKey: prevKey, toCellKey: key, count: 0, sessions: new Set() };
      }
      transitions[tk].count++;
      transitions[tk].sessions.add(sessionId);
    }
    prevKey = key;
  }

  return { cells, transitions };
}

// Accumulate hitmaps across multiple sessions
function accumulate(hitmaps) {
  const allCells = {}, allTransitions = {};
  for (const { cells, transitions } of hitmaps) {
    for (const [k, c] of Object.entries(cells)) {
      if (!allCells[k]) {
        allCells[k] = { ...c, sessions: new Set(c.sessions) };
      } else {
        const e = allCells[k];
        e.latSum += c.latSum; e.lonSum += c.lonSum;
        e.altSum += c.altSum; e.altCount += c.altCount;
        e.pointCount += c.pointCount; e.accuracySum += c.accuracySum;
        for (const s of c.sessions) e.sessions.add(s);
      }
    }
    for (const [k, t] of Object.entries(transitions)) {
      if (!allTransitions[k]) {
        allTransitions[k] = { ...t, sessions: new Set(t.sessions) };
      } else {
        const e = allTransitions[k];
        e.count += t.count;
        for (const s of t.sessions) e.sessions.add(s);
      }
    }
  }
  return { allCells, allTransitions };
}

// Simple path inference: longest chain of transitions
function inferPath(allCells, allTransitions) {
  const validCells = Object.values(allCells)
    .filter(c => c.pointCount >= 2 && c.sessions.size >= 1)
    .map(c => c.cellKey);
  const validSet = new Set(validCells);

  const adj = {};
  for (const t of Object.values(allTransitions)) {
    if (!validSet.has(t.fromCellKey) || !validSet.has(t.toCellKey)) continue;
    if (!adj[t.fromCellKey]) adj[t.fromCellKey] = [];
    adj[t.fromCellKey].push({ to: t.toCellKey, score: t.count * t.sessions.size });
  }

  // Find the cell with no strong incoming (start of path)
  const inbound = {};
  for (const [from, nexts] of Object.entries(adj)) {
    for (const n of nexts) {
      inbound[n.to] = (inbound[n.to] ?? 0) + n.score;
    }
  }
  const starts = validCells.filter(k => !inbound[k] || inbound[k] === 0);
  const startCell = starts.length > 0
    ? starts[0]
    : validCells.sort((a, b) => (inbound[a] ?? 0) - (inbound[b] ?? 0))[0];

  if (!startCell) return [];

  // Greedy path
  const path = [startCell];
  const visited = new Set([startCell]);
  let current = startCell;
  for (let iter = 0; iter < validCells.length; iter++) {
    const nexts = (adj[current] ?? [])
      .filter(n => !visited.has(n.to))
      .sort((a, b) => b.score - a.score);
    if (nexts.length === 0) break;
    current = nexts[0].to;
    path.push(current);
    visited.add(current);
  }

  return path;
}

// ── SQL generation helpers ────────────────────────────────────────────────────

let sessionCounter = 1;
let pointCounter = 0;
const allSQLLines = [];

function sql(line) { allSQLLines.push(line); }

function sessionId(n) {
  return `'${String(n).padStart(8, '0')}-0000-0000-0000-000000000000'`;
}

const BASE_DATE = new Date('2026-04-01T07:00:00Z');

function sessionDate(sessionN, offsetDays) {
  const d = new Date(BASE_DATE.getTime() + offsetDays * 86_400_000);
  return d.toISOString().replace('.000Z', 'Z');
}

function toTimestamp(base, offsetSec) {
  return new Date(new Date(base).getTime() + offsetSec * 1000)
    .toISOString().replace('.000Z', 'Z');
}

function pgStr(v) { return `'${String(v).replace(/'/g, "''")}'`; }

// ── Main generation ───────────────────────────────────────────────────────────

sql('-- =============================================================================');
sql('-- 0019_sample_data_v2.sql');
sql('-- Realistic sample data: dense GPS tracks + H3 cells computed via gridPathCells.');
sql('-- GPS interval: 30s | Walking speed: 3.5 km/h | Speed filter: >10 km/h rejected');
sql('-- =============================================================================');
sql('');
sql('-- ── Clear old sample data ─────────────────────────────────────────────────────');
sql('truncate public.mvp_events restart identity cascade;');
sql('truncate public.session_route_assignments restart identity cascade;');
sql('truncate public.trail_cell_transitions restart identity cascade;');
sql('truncate public.trail_cells restart identity cascade;');
sql('truncate public.candidate_cells restart identity cascade;');
sql('truncate public.canonical_trails restart identity cascade;');
sql('truncate public.rejected_track_points restart identity cascade;');
sql('truncate public.track_points restart identity cascade;');
sql('truncate public.hiking_sessions restart identity cascade;');
sql('truncate public.routes restart identity cascade;');
sql('truncate public.mountains restart identity cascade;');
sql('');

// Mountains
sql('-- ── Mountains ─────────────────────────────────────────────────────────────────');
sql(`insert into public.mountains (id, display_name, bbox) values`);
sql(`  ('sorak',  '설악산 (Seorak)',  '128.40,38.08,128.55,38.20'),`);
sql(`  ('halla',  '한라산 (Halla)',   '126.45,33.30,126.65,33.45'),`);
sql(`  ('dobong', '도봉산 (Dobong)',  '127.00,37.65,127.08,37.73'),`);
sql(`  ('jiri',   '지리산 (Jiri)',    '127.60,35.25,127.85,35.50'),`);
sql(`  ('bukhan', '북한산 (Bukhan)',  '126.96,37.63,127.03,37.72');`);
sql('');

// Routes
sql('-- ── Routes ────────────────────────────────────────────────────────────────────');
const routeRows = [
  ...Object.entries(ROUTES).map(([id, r]) => `  ('${id}', '${r.mountainId}', '${r.displayName}')`),
  `  ('jiri-north', 'jiri', '노고단 북쪽')`,
  `  ('jiri-south', 'jiri', '천왕봉 남쪽')`,
  `  ('jiri-ridge', 'jiri', '지리산 주능선')`,
  `  ('dobong-obong', 'dobong', '오봉 능선')`,
];
sql('insert into public.routes (id, mountain_id, display_name) values');
sql(routeRows.join(',\n') + ';');
sql('');

// ── Process each route ──────────────────────────────────────────────────────
const sessionInserts = [];
const trackPointInserts = [];
const rejectedPointInserts = [];
const sessionAssignments = [];
const routeTrailCells = {}; // routeId -> { allCells, allTransitions }

let globalSessionN = 1;
let globalDayOffset = 0;

for (const [routeId, routeDef] of Object.entries(ROUTES)) {
  const hitmaps = [];
  const sessionIds = [];

  for (let si = 0; si < routeDef.sessionCount; si++) {
    const sid = `'${String(globalSessionN).padStart(8, '0')}-0000-0000-0000-${String(si + 1).padStart(12, '0')}'`;
    const startedAt = sessionDate(globalSessionN, globalDayOffset + si);
    const rawPoints = generateTrack(routeDef.waypoints, si, globalSessionN * 1000);
    const withGlitches = injectGlitches(rawPoints, si);
    const { accepted, rejected } = filterPoints(withGlitches);

    const endedAt = toTimestamp(startedAt, accepted[accepted.length - 1]?.elapsedSec ?? 3600);

    sessionInserts.push(
      `  (${sid}, '00000000-0000-0000-0000-000000000001', '${routeDef.mountainId}', ` +
      `'${routeId}-s${si + 1}', '${startedAt}', '${endedAt}', 'ingested', 'v1.0', ` +
      `${accepted.length}, ${rejected.length})`
    );

    for (let pi = 0; pi < accepted.length; pi++) {
      const p = accepted[pi];
      const ts = toTimestamp(startedAt, p.elapsedSec);
      trackPointInserts.push(
        `  (${sid}, '${routeDef.mountainId}', '${ts}', ` +
        `st_geogfromtext('POINT(${p.lon.toFixed(7)} ${p.lat.toFixed(7)})'), ` +
        `${p.accuracy.toFixed(1)}, ${p.alt.toFixed(0)}, ${pi})`
      );
    }

    for (let pi = 0; pi < rejected.length; pi++) {
      const p = rejected[pi];
      const ts = toTimestamp(startedAt, p.elapsedSec);
      rejectedPointInserts.push(
        `  (${sid}, 'speed_filter', '${ts}', ` +
        `${p.lat.toFixed(7)}, ${p.lon.toFixed(7)}, ` +
        `${p.alt.toFixed(0)}, ${p.accuracy.toFixed(1)}, null, ${pi})`
      );
    }

    const hitmap = buildHitmap(accepted, sid);
    hitmaps.push(hitmap);
    sessionIds.push({ sid, accepted: accepted.length, rejected: rejected.length });
    globalSessionN++;
  }

  globalDayOffset += routeDef.sessionCount;

  const { allCells, allTransitions } = accumulate(hitmaps);
  routeTrailCells[routeId] = { allCells, allTransitions, sessionIds };
}

// ── Orphan (bukhan candidate_cells) ─────────────────────────────────────────
const orphanHitmaps = [];
const orphanSessionDefs = [];

for (const def of ORPHAN_SESSIONS) {
  for (let si = 0; si < def.sessionCount; si++) {
    const sid = `'${String(globalSessionN).padStart(8, '0')}-0000-0000-0000-${String(si + 1).padStart(12, '0')}'`;
    const startedAt = sessionDate(globalSessionN, globalDayOffset + si);
    const rawPoints = generateTrack(def.waypoints, si, globalSessionN * 1000);
    const withGlitches = injectGlitches(rawPoints, si);
    const { accepted, rejected } = filterPoints(withGlitches);
    const endedAt = toTimestamp(startedAt, accepted[accepted.length - 1]?.elapsedSec ?? 3600);

    sessionInserts.push(
      `  (${sid}, '00000000-0000-0000-0000-000000000001', '${def.mountainId}', ` +
      `'bukhan-s${si + 1}', '${startedAt}', '${endedAt}', 'ingested', 'v1.0', ` +
      `${accepted.length}, ${rejected.length})`
    );

    for (let pi = 0; pi < accepted.length; pi++) {
      const p = accepted[pi];
      const ts = toTimestamp(startedAt, p.elapsedSec);
      trackPointInserts.push(
        `  (${sid}, '${def.mountainId}', '${ts}', ` +
        `st_geogfromtext('POINT(${p.lon.toFixed(7)} ${p.lat.toFixed(7)})'), ` +
        `${p.accuracy.toFixed(1)}, ${p.alt.toFixed(0)}, ${pi})`
      );
    }

    orphanHitmaps.push(buildHitmap(accepted, sid));
    orphanSessionDefs.push({ sid, mountainId: def.mountainId });
    globalSessionN++;
  }
  globalDayOffset += def.sessionCount;
}

// Jiri unprocessed sessions
const jiriSessionDefs = [];
for (let si = 0; si < 3; si++) {
  const sid = `'${String(globalSessionN).padStart(8, '0')}-0000-0000-0000-${String(si + 1).padStart(12, '0')}'`;
  const startedAt = sessionDate(globalSessionN, globalDayOffset + si);
  const rawPoints = generateTrack(JIRI_WAYPOINTS, si, globalSessionN * 1000);
  const { accepted } = filterPoints(rawPoints);
  const endedAt = toTimestamp(startedAt, accepted[accepted.length - 1]?.elapsedSec ?? 3600);

  sessionInserts.push(
    `  (${sid}, '00000000-0000-0000-0000-000000000001', 'jiri', ` +
    `'jiri-s${si + 1}', '${startedAt}', '${endedAt}', 'ingested', 'v1.0', ` +
    `${accepted.length}, 0)`
  );

  for (let pi = 0; pi < accepted.length; pi++) {
    const p = accepted[pi];
    const ts = toTimestamp(startedAt, p.elapsedSec);
    trackPointInserts.push(
      `  (${sid}, 'jiri', '${ts}', ` +
      `st_geogfromtext('POINT(${p.lon.toFixed(7)} ${p.lat.toFixed(7)})'), ` +
      `${p.accuracy.toFixed(1)}, ${p.alt.toFixed(0)}, ${pi})`
    );
  }

  jiriSessionDefs.push(sid);
  globalSessionN++;
}

// ── Output hiking_sessions ───────────────────────────────────────────────────
sql('-- ── Hiking sessions ───────────────────────────────────────────────────────────');
sql('insert into public.hiking_sessions');
sql('  (id, user_id, mountain_id, client_session_key, started_at, ended_at, status,');
sql('   upload_consent_version, accepted_point_count, rejected_point_count)');
sql('values');
sql(sessionInserts.join(',\n') + ';');
sql('');

// ── Output track_points ──────────────────────────────────────────────────────
sql('-- ── Track points (accepted) ───────────────────────────────────────────────────');
sql('insert into public.track_points');
sql('  (session_id, mountain_id, recorded_at, geom, accuracy, altitude, sequence_index)');
sql('values');
// Batch in 500-row chunks to avoid overly long INSERT
for (let i = 0; i < trackPointInserts.length; i += 500) {
  const chunk = trackPointInserts.slice(i, i + 500);
  if (i > 0) {
    sql('');
    sql('insert into public.track_points');
    sql('  (session_id, mountain_id, recorded_at, geom, accuracy, altitude, sequence_index)');
    sql('values');
  }
  sql(chunk.join(',\n') + ';');
}
sql('');

// ── Output rejected_track_points ─────────────────────────────────────────────
if (rejectedPointInserts.length > 0) {
  sql('-- ── Rejected track points (speed filter) ─────────────────────────────────────');
  sql('insert into public.rejected_track_points');
  sql('  (session_id, reason, recorded_at, lat, lon, altitude, accuracy, speed, point_sequence_index)');
  sql('values');
  sql(rejectedPointInserts.join(',\n') + ';');
  sql('');
}

// ── Output trail_cells & transitions ────────────────────────────────────────
sql('-- ── Trail cells (H3 res-11, including edge cells via gridPathCells) ────────────');

const trailCellInserts = [];
const trailTransitionInserts = [];
const canonicalTrailInserts = [];
const sessionAssignmentInserts = [];

for (const [routeId, { allCells, allTransitions, sessionIds }] of Object.entries(routeTrailCells)) {
  const validCells = Object.values(allCells).filter(c => c.pointCount >= 1);
  const cellKeySet = new Set(validCells.map(c => c.cellKey));

  const lastSeenBase = sessionDate(1, Object.keys(ROUTES).indexOf(routeId) + 1);

  for (const c of validCells) {
    const lat = c.latSum / c.pointCount;
    const lon = c.lonSum / c.pointCount;
    const avgAlt = c.altCount > 0 ? c.altSum / c.altCount : null;
    const avgAcc = c.accuracyCount > 0 ? c.accuracySum / c.accuracyCount : null;
    const sessionCount = c.sessions.size;
    const qualScore = avgAcc !== null ? Math.max(0, Math.min(1, 1 - avgAcc / 100)) : 0.8;
    trailCellInserts.push(
      `  ('${routeId}',${pgStr(c.cellKey)},` +
      `st_geogfromtext('POINT(${lon.toFixed(7)} ${lat.toFixed(7)})'),` +
      `${c.pointCount},${sessionCount},` +
      `${avgAcc !== null ? avgAcc.toFixed(2) : 'null'},` +
      `${avgAlt !== null ? avgAlt.toFixed(1) : 'null'},` +
      `'${lastSeenBase}',${qualScore.toFixed(3)})`
    );
  }

  for (const t of Object.values(allTransitions)) {
    if (!cellKeySet.has(t.fromCellKey) || !cellKeySet.has(t.toCellKey)) continue;
    const edgeCost = 1 / Math.max(1, t.count);
    trailTransitionInserts.push(
      `  ('${routeId}',${pgStr(t.fromCellKey)},${pgStr(t.toCellKey)},` +
      `${t.count},${t.sessions.size},${edgeCost.toFixed(4)})`
    );
  }

  // Infer canonical trail path
  const pathKeys = inferPath(allCells, allTransitions);
  if (pathKeys.length >= 2) {
    const linePoints = pathKeys.map(k => {
      const c = allCells[k];
      const lat = c.latSum / c.pointCount;
      const lon = c.lonSum / c.pointCount;
      return `${lon.toFixed(7)} ${lat.toFixed(7)}`;
    });
    const wkt = `LINESTRING(${linePoints.join(',')})`;
    const totalSessions = new Set(
      Object.values(allCells).flatMap(c => [...c.sessions])
    ).size;
    // Confidence: simplified version
    const confidence = Math.min(0.95, 0.3 + totalSessions * 0.13);
    const level = confidence >= 0.70 && totalSessions >= 3 ? 'recommended' : 'reference';
    const validTransCount = Object.values(allTransitions)
      .filter(t => cellKeySet.has(t.fromCellKey) && cellKeySet.has(t.toCellKey)).length;
    const branchScore = 0.05;
    const gpsScore = 0.85;
    canonicalTrailInserts.push(
      `  ('${routeId}', 1, st_geogfromtext('${wkt}'), ` +
      `${confidence.toFixed(3)}, '${level}', ${totalSessions}, ` +
      `${branchScore}, ${gpsScore})`
    );
  }

  // Session assignments
  for (const { sid, accepted, rejected } of sessionIds) {
    const cellCount = validCells.length;
    const transCount = trailTransitionInserts.length > 0 ? Math.min(cellCount - 1, Object.keys(allTransitions).length) : 0;
    sessionAssignmentInserts.push(
      `  (${sid}, '${routeId}', ${Math.max(1, Math.floor(cellCount * 0.7))}, ${Math.max(0, Math.floor(cellCount * 0.6))})`
    );
  }
}

sql('insert into public.trail_cells');
sql('  (route_id, cell_key, geom, point_count, session_count, avg_accuracy, avg_altitude, last_seen_at, quality_score)');
sql('values');
for (let i = 0; i < trailCellInserts.length; i += 200) {
  const chunk = trailCellInserts.slice(i, i + 200);
  if (i > 0) {
    sql('');
    sql('insert into public.trail_cells');
    sql('  (route_id, cell_key, geom, point_count, session_count, avg_accuracy, avg_altitude, last_seen_at, quality_score)');
    sql('values');
  }
  sql(chunk.join(',\n') + '\non conflict (route_id, cell_key) do nothing;');
}
sql('');

sql('-- ── Trail cell transitions ────────────────────────────────────────────────────');
sql('insert into public.trail_cell_transitions');
sql('  (route_id, from_cell_key, to_cell_key, transition_count, session_count, edge_cost)');
sql('values');
for (let i = 0; i < trailTransitionInserts.length; i += 200) {
  const chunk = trailTransitionInserts.slice(i, i + 200);
  if (i > 0) {
    sql('');
    sql('insert into public.trail_cell_transitions');
    sql('  (route_id, from_cell_key, to_cell_key, transition_count, session_count, edge_cost)');
    sql('values');
  }
  sql(chunk.join(',\n') + '\non conflict (route_id, from_cell_key, to_cell_key) do nothing;');
}
sql('');

sql('-- ── Canonical trails ─────────────────────────────────────────────────────────');
sql('insert into public.canonical_trails');
sql('  (route_id, version, geom, confidence, confidence_level, session_count, branch_ambiguity_score, gps_quality_score)');
sql('values');
sql(canonicalTrailInserts.join(',\n') + '\non conflict (route_id, version) do update set');
sql('  geom = excluded.geom, confidence = excluded.confidence,');
sql('  confidence_level = excluded.confidence_level, session_count = excluded.session_count,');
sql('  branch_ambiguity_score = excluded.branch_ambiguity_score, gps_quality_score = excluded.gps_quality_score;');
sql('');

sql('-- ── Session route assignments ─────────────────────────────────────────────────');
sql('insert into public.session_route_assignments');
sql('  (session_id, route_id, contributed_cell_count, contributed_transition_count)');
sql('values');
sql(sessionAssignmentInserts.join(',\n') + '\non conflict (session_id, route_id) do nothing;');
sql('');

// Candidate cells for bukhan
sql('-- ── Candidate cells (bukhan – no routes yet) ─────────────────────────────────');
const { allCells: bukhanCells, allTransitions: bukhanTrans } = accumulate(orphanHitmaps);
const bukhanCellInserts = [];
for (const c of Object.values(bukhanCells)) {
  const lat = c.latSum / c.pointCount;
  const lon = c.lonSum / c.pointCount;
  const avgAlt = c.altCount > 0 ? c.altSum / c.altCount : null;
  const avgAcc = c.accuracyCount > 0 ? c.accuracySum / c.accuracyCount : null;
  const contribArray = [...c.sessions].map(s => s.replace(/'/g, '')).join(',');
  bukhanCellInserts.push(
    `  ('bukhan', ${pgStr(c.cellKey)}, ` +
    `st_geogfromtext('POINT(${lon.toFixed(7)} ${lat.toFixed(7)})'), ` +
    `${c.pointCount}, ${c.sessions.size}, ` +
    `'{${[...c.sessions].map(s => s.replace(/'/g, '')).join(',')}}'::uuid[], ` +
    `${avgAcc !== null ? avgAcc.toFixed(2) : 'null'}, ` +
    `${avgAlt !== null ? avgAlt.toFixed(1) : 'null'}, ` +
    `'2026-04-20T10:00:00Z')`
  );
}
if (bukhanCellInserts.length > 0) {
  sql('insert into public.candidate_cells');
  sql('  (mountain_id, cell_key, geom, point_count, session_count, contributing_sessions, avg_accuracy, avg_altitude, last_seen_at)');
  sql('values');
  sql(bukhanCellInserts.join(',\n') + '\non conflict (mountain_id, cell_key) do nothing;');
  sql('');
}

// MVP events
sql('-- ── MVP events ────────────────────────────────────────────────────────────────');
const mvpEvents = [
  `('sorak', 'trail_served', '{"routeId":"sorak-main","routeState":"recommended","version":1}')`,
  `('sorak', 'trail_served', '{"routeId":"sorak-main","routeState":"recommended","version":1}')`,
  `('sorak', 'trail_served', '{"routeId":"sorak-alternate","routeState":"reference","version":1}')`,
  `('halla', 'trail_served', '{"routeId":"halla-main","routeState":"reference","version":1}')`,
  `('halla', 'trail_served', '{"routeId":"halla-eorimok","routeState":"reference","version":1}')`,
  `('dobong', 'trail_served', '{"routeId":"dobong-main","routeState":"recommended","version":1}')`,
  `('dobong', 'trail_served', '{"routeId":"dobong-main","routeState":"recommended","version":1}')`,
  `('sorak', 'snap_requested', '{"routeId":"sorak-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}')`,
  `('sorak', 'snap_requested', '{"routeId":"sorak-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}')`,
  `('halla', 'snap_requested', '{"routeId":"halla-eorimok","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}')`,
  `('dobong', 'snap_requested', '{"routeId":"dobong-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}')`,
];
sql('insert into public.mvp_events (mountain_id, event_name, event_payload) values');
sql(mvpEvents.map(e => `  ${e}`).join(',\n') + ';');
sql('');

// Stats
const totalTrackPoints = trackPointInserts.length;
const totalRejected = rejectedPointInserts.length;
const totalCells = trailCellInserts.length;
const totalTransitions = trailTransitionInserts.length;

sql(`-- Stats: ${sessionInserts.length} sessions, ${totalTrackPoints} accepted track points,`);
sql(`--        ${totalRejected} rejected points, ${totalCells} trail cells, ${totalTransitions} transitions`);

console.log(allSQLLines.join('\n'));
