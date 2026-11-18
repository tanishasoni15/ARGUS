/**
 * Records a static snapshot of the API for the serverless demo build.
 *
 * Run against a seeded local backend (`npm run setup` + `npm start` in backend/):
 *   node scripts/record-demo.mjs [http://localhost:4000]
 *
 * Writes public/demo/<hash>.json, one file per request key, using the same
 * key → filename scheme as src/api/demo.js. List endpoints are recorded whole
 * and filtered/paginated in the browser, so the demo answers any filter the UI
 * can produce without enumerating every combination here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { demoKey, demoFile } from '../src/api/demoKey.js';

const API = process.argv[2] || 'http://localhost:4000';
const OUT = path.resolve(import.meta.dirname, '../public/demo');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'investigator@argus.gov.in', password: 'argus2026' }),
}).then((r) => r.json());
const H = { Authorization: `Bearer ${login.token}` };

let count = 0;
let bytes = 0;
function save(method, p, params, data) {
  const json = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT, demoFile(demoKey(method, p, params))), json);
  count++;
  bytes += json.length;
}

async function call(method, p, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') qs.append(k, String(v));
  const url = `${API}${p}${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { method, headers: H });
  const text = await res.text();
  if (!res.ok) {
    console.warn(`  skip ${method} ${url} → ${res.status}`);
    return null;
  }
  return text ? JSON.parse(text) : null;
}

async function rec(p, params, method = 'GET') {
  const data = await call(method, p, params);
  if (data !== null) save(method, p, params, data);
  return data;
}

async function all(p, field, page) {
  const rows = [];
  for (let offset = 0; ; offset += page) {
    const d = await call('GET', p, { limit: page, offset });
    rows.push(...d[field]);
    if (!d.has_more && (d.total === undefined || rows.length >= d.total)) return { ...d, rows };
    if (d[field].length === 0) return { ...d, rows };
  }
}

// Auth --------------------------------------------------------------------
save('POST', '/api/auth/login', null, { token: 'demo', user: login.user });
save('GET', '/api/auth/me', null, { user: login.user });

// Singletons ----------------------------------------------------------------
for (const p of [
  '/api/dashboard/summary', '/api/clusters', '/api/geo/states', '/api/geo/routes',
  '/api/reference/meta', '/api/alerts/rules', '/api/chain/status', '/api/chain/transactions',
  '/api/osint/adapters', '/api/admin/health',
]) await rec(p);
// The users list is admin-only; read it with the admin account.
{
  const admin = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@argus.gov.in', password: 'argus2026' }),
  }).then((r) => r.json());
  const users = await fetch(`${API}/api/admin/users`, { headers: { Authorization: `Bearer ${admin.token}` } });
  if (users.ok) save('GET', '/api/admin/users', null, await users.json());
}
await rec('/api/reference/states', { metric: 'CHEATING', year: 2014 });

// Whole lists, filtered client-side -----------------------------------------
const complaints = await all('/api/complaints', 'complaints', 200);
const narratives = {};
for (const c of complaints.rows) {
  const d = await rec(`/api/complaints/${c.id}`);
  narratives[c.id] = d?.complaint?.narrative ?? d?.narrative ?? '';
  await rec(`/api/money/trace/${c.id}`);
  const st = d?.complaint?.state ?? c.state;
  const di = d?.complaint?.district ?? c.district;
  if (st && di) await rec(`/api/reference/district/${encodeURIComponent(st)}/${encodeURIComponent(di)}`);
}
save('GET', '/__all/complaints', null, { rows: complaints.rows.map((c) => ({ ...c, _narrative: narratives[c.id] })) });

const alerts = await call('GET', '/api/alerts', { limit: 200 });
save('GET', '/__all/alerts', null, alerts);
for (const a of alerts.alerts) await rec(`/api/alerts/${a.id}/explain`);

const timeline = await all('/api/timeline', 'events', 300);
save('GET', '/__all/timeline', null, { rows: timeline.rows });

const evidence = await call('GET', '/api/evidence', { limit: 100 });
await rec('/api/evidence', { limit: 100 });
for (const e of evidence.evidence) {
  await rec(`/api/evidence/${e.id}/history`);
  await rec(`/api/evidence/${e.id}/verify`, null, 'POST');
}

// Clusters ------------------------------------------------------------------
const clusters = await call('GET', '/api/clusters');
for (const c of clusters.clusters) {
  await rec(`/api/clusters/${encodeURIComponent(c.cluster_key)}`);
  await rec(`/api/graph/cluster/${encodeURIComponent(c.cluster_key)}`);
}

// Graph: walk every node reachable from the overview ------------------------
const overview = await rec('/api/graph/overview', { limit: 150 });
const seen = new Set();
const queue = overview.nodes.map((n) => n);
while (queue.length) {
  const n = queue.shift();
  if (seen.has(n.id)) continue;
  seen.add(n.id);
  const nb = await rec(`/api/graph/neighbors/${encodeURIComponent(n.id)}`, { depth: 1, limit: 40 });
  await rec(`/api/graph/why/${encodeURIComponent(n.id)}`);
  if (n.pg_id) await rec(`/api/entities/${n.pg_id}/osint`);
  for (const m of nb?.nodes ?? []) if (!seen.has(m.id)) queue.push(m);
}

console.log(`recorded ${count} responses, ${(bytes / 1e6).toFixed(1)} MB, ${seen.size} graph nodes`);
