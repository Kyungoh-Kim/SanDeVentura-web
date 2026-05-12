import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trackRoot = path.join(repoRoot, 'test-tracks');
const outputPath = process.argv[2] ?? path.join(repoRoot, 'supabase', '.temp', 'gpx_comparison_seed.sql');

const userIds = [
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
];

const mountainConfigs = {
  'sample-dobongsan': {
    displayName: 'Dobongsan GPX Demo',
    source: 'gpx-comparison-osm-bukhansan-bbox',
    bbox: '126.9333869,37.5965670,127.0432599,37.7386928',
  },
  'sample-hallasan': {
    displayName: 'Hallasan GPX Demo',
    source: 'gpx-comparison-track-expanded-bbox',
    bbox: '126.4529600,33.3519460,126.5389930,33.3899890',
  },
  'sample-seoraksan': {
    displayName: 'Seoraksan GPX Demo',
    source: 'gpx-comparison-osm-seoraksan-bbox',
    bbox: '128.2554860,38.0040944,128.5837338,38.2640709',
  },
};

const routeConfigs = [
  { id: 'sample-dobongsan-main', mountainId: 'sample-dobongsan', displayName: 'Dobongsan Main' },
  { id: 'sample-hallasan-eorimok', mountainId: 'sample-hallasan', displayName: 'Hallasan Eorimok' },
  { id: 'sample-seoraksan-main', mountainId: 'sample-seoraksan', displayName: 'Seoraksan Main' },
  { id: 'sample-branch-main', mountainId: 'sample-branch-test', displayName: 'Synthetic Main' },
];

const folderConfigs = {
  'dobong-main': {
    mountainId: 'sample-dobongsan',
    routeId: 'sample-dobongsan-main',
    keyPrefix: 'dobong-main',
  },
  'dobong-west': {
    mountainId: 'sample-dobongsan',
    routeId: null,
    keyPrefix: 'dobong-west',
  },
  'halla-eorimok': {
    mountainId: 'sample-hallasan',
    routeId: 'sample-hallasan-eorimok',
    keyPrefix: 'halla-eorimok',
  },
  'sorak-main': {
    mountainId: 'sample-seoraksan',
    routeId: 'sample-seoraksan-main',
    keyPrefix: 'sorak-main',
  },
  'sorak-alternate': {
    mountainId: 'sample-seoraksan',
    routeId: null,
    keyPrefix: 'sorak-alternate',
  },
  'branch-test-main': {
    mountainId: 'sample-branch-test',
    routeId: 'sample-branch-main',
    keyPrefix: 'branch-main',
  },
  'branch-test-fork': {
    mountainId: 'sample-branch-test',
    routeId: null,
    keyPrefix: 'branch-fork',
  },
};

ensureSyntheticBranchGpx();

const sessions = [];
for (const folderName of fs.readdirSync(trackRoot).sort()) {
  const folderPath = path.join(trackRoot, folderName);
  if (!fs.statSync(folderPath).isDirectory()) continue;

  const config = folderConfigs[folderName];
  if (!config) continue;

  const files = fs.readdirSync(folderPath)
    .filter((file) => file.toLowerCase().endsWith('.gpx'))
    .sort();

  for (const fileName of files) {
    const gpxPath = path.join(folderPath, fileName);
    const parsed = parseGpx(gpxPath);
    if (parsed.points.length === 0) continue;

    const sessionNumber = sessions.length + 1;
    sessions.push({
      id: `22222222-0000-0000-0000-${String(sessionNumber).padStart(12, '0')}`,
      userId: userIds[(sessionNumber - 1) % userIds.length],
      mountainId: config.mountainId,
      routeId: config.routeId,
      clientSessionKey: `${config.keyPrefix}-${path.basename(fileName, '.gpx')}`,
      displayName: parsed.name,
      startedAt: parsed.points[0].time,
      endedAt: parsed.points.at(-1).time,
      points: parsed.points,
      sourcePath: path.relative(repoRoot, gpxPath).replaceAll(path.sep, '/'),
    });
  }
}

mountainConfigs['sample-branch-test'] = {
  displayName: 'Synthetic Branch GPX Demo',
  source: 'gpx-comparison-synthetic-branch-bbox',
  bbox: bboxForSessions(sessions.filter((session) => session.mountainId === 'sample-branch-test')),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, buildSql(sessions), 'utf8');

console.log(`Wrote ${outputPath}`);
console.log(`Sessions: ${sessions.length}`);
console.log(`Track points: ${sessions.reduce((sum, session) => sum + session.points.length, 0)}`);
for (const [mountainId, config] of Object.entries(mountainConfigs)) {
  console.log(`${mountainId}: ${config.bbox}`);
}

function parseGpx(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const name = xml.match(/<name>([^<]+)<\/name>/)?.[1] ?? path.basename(filePath, '.gpx');
  const points = [...xml.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)]
    .map((match, index) => {
      const body = match[3];
      const time = body.match(/<time>([^<]+)<\/time>/)?.[1] ??
        new Date(Date.UTC(2026, 5, 1, 0, 0, index * 5)).toISOString();
      const altitude = body.match(/<ele>([^<]+)<\/ele>/)?.[1];
      return {
        lat: Number(match[1]),
        lon: Number(match[2]),
        altitude: altitude === undefined ? null : Number(altitude),
        time,
      };
    })
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  return { name, points };
}

function buildSql(seedSessions) {
  const lines = [];
  lines.push('-- Generated by scripts/prepare-gpx-comparison-seed.mjs');
  lines.push('-- Input source: test-tracks/**/*.gpx; KML files are intentionally ignored.');
  lines.push('begin;');
  lines.push(`
truncate
  public.mvp_events,
  public.route_split_audit,
  public.route_to_candidate_transitions,
  public.candidate_cell_transitions,
  public.session_cell_attributions,
  public.session_route_assignments,
  public.rejected_track_points,
  public.track_points,
  public.hiking_sessions,
  public.candidate_cells,
  public.trail_cell_transitions,
  public.trail_cells,
  public.canonical_trails,
  public.routes,
  public.mountains
restart identity cascade;
`.trim());

  lines.push('\ninsert into public.mountains (id, display_name, source, bbox)\nvalues');
  lines.push(Object.entries(mountainConfigs)
    .map(([id, config]) => `  (${sql(id)}, ${sql(config.displayName)}, ${sql(config.source)}, ${sql(config.bbox)})`)
    .join(',\n') + ';');

  lines.push('\ninsert into public.routes (id, mountain_id, display_name)\nvalues');
  lines.push(routeConfigs
    .map((route) => `  (${sql(route.id)}, ${sql(route.mountainId)}, ${sql(route.displayName)})`)
    .join(',\n') + ';');

  lines.push(`
create temporary table gpx_seed_point_input (
  session_id uuid not null,
  mountain_id text not null,
  sequence_index integer not null,
  recorded_at timestamptz not null,
  lat double precision not null,
  lon double precision not null,
  altitude double precision,
  accuracy double precision,
  speed double precision,
  quality_score double precision
) on commit drop;
`.trim());

  lines.push(`
insert into public.hiking_sessions (
  id,
  user_id,
  mountain_id,
  route_id,
  client_session_key,
  started_at,
  ended_at,
  status,
  upload_consent_version,
  accepted_point_count,
  rejected_point_count,
  retention_review_at,
  created_at
) values`.trim());
  lines.push(seedSessions.map((session) => `  (
    ${sql(session.id)}::uuid,
    ${sql(session.userId)}::uuid,
    ${sql(session.mountainId)},
    ${session.routeId === null ? 'null' : sql(session.routeId)},
    ${sql(session.clientSessionKey)},
    ${sql(session.startedAt)}::timestamptz,
    ${sql(session.endedAt)}::timestamptz,
    'ingested',
    'beta-route-upload-v1',
    ${session.points.length},
    0,
    ${sql(session.endedAt)}::timestamptz,
    ${sql(session.endedAt)}::timestamptz
  )`).join(',\n') + ';');

  const pointValues = [];
  for (const session of seedSessions) {
    session.points.forEach((point, index) => {
      pointValues.push(`  (${sql(session.id)}::uuid, ${sql(session.mountainId)}, ${index}, ${sql(point.time)}::timestamptz, ${point.lat.toFixed(7)}, ${point.lon.toFixed(7)}, ${point.altitude === null ? 'null' : point.altitude.toFixed(1)}, 7.0, 1.0, 0.97)`);
    });
  }
  lines.push(`
insert into gpx_seed_point_input (
  session_id,
  mountain_id,
  sequence_index,
  recorded_at,
  lat,
  lon,
  altitude,
  accuracy,
  speed,
  quality_score
) values`.trim());
  lines.push(pointValues.join(',\n') + ';');

  lines.push(`
insert into public.track_points (
  session_id,
  mountain_id,
  recorded_at,
  geom,
  altitude,
  accuracy,
  speed,
  quality_score,
  sequence_index
)
select
  session_id,
  mountain_id,
  recorded_at,
  st_setsrid(st_makepoint(lon, lat), 4326)::geography,
  altitude,
  accuracy,
  speed,
  quality_score,
  sequence_index
from gpx_seed_point_input;

insert into public.mvp_events (
  user_id,
  mountain_id,
  session_id,
  event_name,
  event_payload,
  created_at
)
select
  hs.user_id,
  hs.mountain_id,
  hs.id,
  'session_uploaded',
  jsonb_build_object(
    'clientSessionKey', hs.client_session_key,
    'acceptedPointCount', hs.accepted_point_count,
    'rejectedPointCount', hs.rejected_point_count,
    'seedStage', 'gpx-input-only'
  ),
  hs.created_at
from public.hiking_sessions hs;

commit;
`.trim());

  return lines.join('\n\n') + '\n';
}

function ensureSyntheticBranchGpx() {
  const mainDir = path.join(trackRoot, 'branch-test-main');
  const forkDir = path.join(trackRoot, 'branch-test-fork');
  fs.mkdirSync(mainDir, { recursive: true });
  fs.mkdirSync(forkDir, { recursive: true });

  for (let session = 1; session <= 3; session += 1) {
    writeGpx(
      path.join(mainDir, `session-${String(session).padStart(2, '0')}.gpx`),
      `Synthetic Branch Main Session ${String(session).padStart(2, '0')}`,
      buildSyntheticPath('main', session),
      Date.UTC(2026, 5, 10, 1 + session, 0, 0),
    );
  }
  for (let session = 1; session <= 4; session += 1) {
    writeGpx(
      path.join(forkDir, `session-${String(session).padStart(2, '0')}.gpx`),
      `Synthetic Branch Fork Session ${String(session).padStart(2, '0')}`,
      buildSyntheticPath('fork', session),
      Date.UTC(2026, 5, 11, 1 + session, 0, 0),
    );
  }
}

function buildSyntheticPath(kind, session) {
  const jitter = (session - 2.5) * 0.00001;
  const points = [];
  for (let i = 0; i < 24; i += 1) {
    let lat = 37.6400 + i * 0.00035 + jitter;
    let lon = 127.0050 + Math.sin(i / 4) * 0.00008 + jitter;
    if (kind === 'fork' && i >= 10) {
      const t = i - 9;
      lat = 37.6400 + 9 * 0.00035 + t * 0.00023 + jitter;
      lon = 127.0050 - t * 0.00042 + jitter;
    }
    points.push({ lat, lon, altitude: 300 + i * 8 });
  }
  return points;
}

function writeGpx(filePath, name, points, startMs) {
  const body = points.map((point, index) => {
    const time = new Date(startMs + index * 15_000).toISOString();
    return `      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lon.toFixed(7)}">
        <ele>${point.altitude.toFixed(1)}</ele>
        <time>${time}</time>
      </trkpt>`;
  }).join('\n');
  fs.writeFileSync(filePath, `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SanDeVentura synthetic branch seed" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>
`, 'utf8');
}

function bboxForSessions(seedSessions) {
  const points = seedSessions.flatMap((session) => session.points);
  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLon = Math.min(...points.map((point) => point.lon));
  const maxLon = Math.max(...points.map((point) => point.lon));
  const pad = 0.005;
  return `${(minLon - pad).toFixed(7)},${(minLat - pad).toFixed(7)},${(maxLon + pad).toFixed(7)},${(maxLat + pad).toFixed(7)}`;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
