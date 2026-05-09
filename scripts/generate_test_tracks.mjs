/**
 * Generates KML test track files for mobile app route testing.
 * Run: node scripts/generate_test_tracks.mjs
 *
 * Output: test-tracks/<routeId>/session-NN.kml
 *
 * Workflow to test "recommended" determination:
 *  1. Upload each session KML to the app in order (session-01 first)
 *  2. After each upload, trigger match-and-aggregate in the operator dashboard
 *  3. Watch confidence score build up on the Routes page
 *  4. Route flips to "recommended" once enough sessions are consistently matched
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const GPS_INTERVAL_SEC = 5;
const WALKING_SPEED_MS = 3.5 * 1000 / 3600;
const GPS_NOISE_M = 6;
const BASE_DATE = new Date('2026-05-10T06:00:00Z');

const ROUTES = {
  'sorak-main': {
    mountainId: 'sorak',
    displayName: '설악산 주능선 코스',
    sessions: 5,
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
    displayName: '설악산 울산바위 우회',
    sessions: 3,
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
  'dobong-main': {
    mountainId: 'dobong',
    displayName: '도봉산 주등산로',
    sessions: 4,
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
    displayName: '도봉산 서쪽 능선',
    sessions: 2,
    waypoints: [
      [127.00200, 37.68200, 270], [127.00500, 37.68400, 330],
      [127.00820, 37.68520, 380], [127.01100, 37.68620, 430],
      [127.01400, 37.68720, 470], [127.01600, 37.68850, 510],
      [127.01780, 37.69000, 550], [127.01900, 37.69120, 590],
      [127.02000, 37.69200, 640],
    ],
  },
  'halla-eorimok': {
    mountainId: 'halla',
    displayName: '한라산 어리목 코스',
    sessions: 3,
    waypoints: [
      [126.46300, 33.38000, 980], [126.47000, 33.37600, 1060],
      [126.47700, 33.37200, 1140], [126.48450, 33.36800, 1220],
      [126.49200, 33.36520, 1300], [126.49980, 33.36350, 1370],
      [126.50780, 33.36250, 1440], [126.51580, 33.36200, 1510],
      [126.52280, 33.36200, 1580], [126.52800, 33.36200, 1650],
      [126.52900, 33.36200, 1850],
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

function generateTrack(waypoints, sessionIdx, noiseSeed) {
  const points = [];
  let elapsedSec = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const [lon1, lat1, alt1] = waypoints[i];
    const [lon2, lat2, alt2] = waypoints[i + 1];
    const segDist = haversine(lat1, lon1, lat2, lon2);
    const numSteps = Math.max(1, Math.ceil(segDist / WALKING_SPEED_MS / GPS_INTERVAL_SEC));

    for (let s = 0; s < numSteps; s++) {
      const t = s / numSteps;
      const bLat = lat1 + (lat2 - lat1) * t;
      const bLon = lon1 + (lon2 - lon1) * t;
      const alt = alt1 + (alt2 - alt1) * t;
      const seed = noiseSeed + sessionIdx * 100000 + i * 1000 + s;
      const [lat, lon] = addNoise(bLat, bLon, GPS_NOISE_M, seed);
      const accuracy = 5 + Math.abs(deterministicNoise(seed + 500)) * 8;
      points.push({ lat, lon, alt, accuracy, elapsedSec });
      elapsedSec += GPS_INTERVAL_SEC;
    }
  }

  const [lon, lat, alt] = waypoints[waypoints.length - 1];
  const seed = noiseSeed + sessionIdx * 100000 + 99999;
  const [nlat, nlon] = addNoise(lat, lon, GPS_NOISE_M, seed);
  points.push({ lat: nlat, lon: nlon, alt, accuracy: 7, elapsedSec });

  return points;
}

function toTimestamp(baseDate, elapsedSec) {
  return new Date(baseDate.getTime() + elapsedSec * 1000).toISOString().replace('.000Z', 'Z');
}

function buildKml(routeId, routeDef, sessionIdx, points, startDate) {
  const sessionNum = String(sessionIdx + 1).padStart(2, '0');
  const name = `${routeDef.displayName} — 세션 ${sessionNum}`;

  const whens = points.map(p => `      <when>${toTimestamp(startDate, p.elapsedSec)}</when>`).join('\n');
  const coords = points.map(p =>
    `      <gx:coord>${p.lon.toFixed(7)} ${p.lat.toFixed(7)} ${p.alt.toFixed(1)}</gx:coord>`
  ).join('\n');

  // Also build a simple LineString for apps that don't support gx:Track
  const lineCoords = points
    .map(p => `${p.lon.toFixed(7)},${p.lat.toFixed(7)},${p.alt.toFixed(1)}`)
    .join(' ');

  const durationMin = Math.round(points[points.length - 1].elapsedSec / 60);

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${name}</name>
    <description>Route: ${routeId} | Mountain: ${routeDef.mountainId} | Session: ${sessionNum}/${routeDef.sessions} | Duration: ~${durationMin}min | GPS interval: ${GPS_INTERVAL_SEC}s</description>

    <Style id="trackLine">
      <LineStyle>
        <color>ff0080ff</color>
        <width>3</width>
      </LineStyle>
    </Style>

    <!-- gx:Track (timestamps + coords for GPS simulation) -->
    <Placemark>
      <name>GPS Track</name>
      <styleUrl>#trackLine</styleUrl>
      <gx:Track>
        <altitudeMode>absolute</altitudeMode>
${whens}
${coords}
      </gx:Track>
    </Placemark>

    <!-- LineString (fallback for simple viewers) -->
    <Placemark>
      <name>Route Path</name>
      <styleUrl>#trackLine</styleUrl>
      <LineString>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${lineCoords}</coordinates>
      </LineString>
    </Placemark>

    <!-- Start/End markers -->
    <Placemark>
      <name>출발</name>
      <Point>
        <coordinates>${points[0].lon.toFixed(7)},${points[0].lat.toFixed(7)},${points[0].alt.toFixed(1)}</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>도착</name>
      <Point>
        <coordinates>${points[points.length-1].lon.toFixed(7)},${points[points.length-1].lat.toFixed(7)},${points[points.length-1].alt.toFixed(1)}</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
}

// ── Generate files ────────────────────────────────────────────────────────────

const outDir = join(process.cwd(), 'test-tracks');
let totalFiles = 0;

for (const [routeId, routeDef] of Object.entries(ROUTES)) {
  const routeDir = join(outDir, routeId);
  mkdirSync(routeDir, { recursive: true });

  console.log(`\n${routeId} (${routeDef.sessions} sessions):`);

  for (let si = 0; si < routeDef.sessions; si++) {
    const noiseSeed = Object.keys(ROUTES).indexOf(routeId) * 10000 + si * 1000;
    const points = generateTrack(routeDef.waypoints, si, noiseSeed);
    const startDate = new Date(BASE_DATE.getTime() + (totalFiles * 86_400_000));
    const kml = buildKml(routeId, routeDef, si, points, startDate);

    const sessionNum = String(si + 1).padStart(2, '0');
    const filename = `session-${sessionNum}.kml`;
    writeFileSync(join(routeDir, filename), kml, 'utf8');

    const durationMin = Math.round(points[points.length - 1].elapsedSec / 60);
    console.log(`  ✓ ${filename}  (${points.length} pts, ~${durationMin}min)`);
    totalFiles++;
  }
}

console.log(`\n✓ ${totalFiles} KML files written to test-tracks/`);
console.log(`\nTesting workflow:`);
console.log(`  1. Upload sessions in order (session-01 → session-02 → ...)`);
console.log(`  2. After each upload, trigger "Scan for candidates" in operator dashboard`);
console.log(`  3. Watch route confidence build up on Routes page`);
console.log(`  sorak-main needs 5 sessions to reach recommended confidence`);
console.log(`  dobong-main needs 4 sessions`);
