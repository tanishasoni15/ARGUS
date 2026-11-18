/**
 * Serverless demo transport. Enabled by building with VITE_DEMO=1.
 *
 * Answers API calls from the snapshot recorded by scripts/record-demo.mjs
 * (public/demo/*.json) so the UI runs on static hosting with no backend.
 * List endpoints are filtered and paginated here; writes are refused politely.
 */
import { demoKey, demoFile } from './demoKey';

const ROOT = `${import.meta.env.BASE_URL}demo/`;
const cache = new Map();

function load(method, path, params) {
  const file = demoFile(demoKey(method, path, params));
  if (!cache.has(file)) {
    cache.set(
      file,
      fetch(ROOT + file).then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))))
    );
  }
  return cache.get(file).catch((e) => {
    cache.delete(file);
    throw e;
  });
}

const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));

function page(rows, params, field, defLimit) {
  const limit = num(params.limit, defLimit);
  const offset = num(params.offset, 0);
  const slice = rows.slice(offset, offset + limit);
  return { [field]: slice, total: rows.length, limit, offset, has_more: offset + slice.length < rows.length };
}

async function listComplaints(params) {
  const { rows } = await load('GET', '/__all/complaints');
  const q = (params.q || '').toLowerCase();
  const out = rows
    .filter((c) => !params.category || c.scam_category === params.category)
    .filter((c) => !params.status || c.status === params.status)
    .filter((c) => !params.state || c.state === params.state)
    .filter(
      (c) =>
        !q ||
        [c.complaint_ref, c.victim_name, c._narrative].some((s) => (s || '').toLowerCase().includes(q))
    )
    .map(({ _narrative, ...c }) => c);
  return page(out, params, 'complaints', 50);
}

async function listAlerts(params) {
  const all = await load('GET', '/__all/alerts');
  const alerts = all.alerts
    .filter((a) => !params.severity || a.severity === params.severity)
    .filter((a) => !params.status || a.status === params.status)
    .slice(0, num(params.limit, 50));
  return { ...all, alerts };
}

async function listTimeline(params) {
  const { rows } = await load('GET', '/__all/timeline');
  return page(rows.filter((e) => !params.action || e.action === params.action), params, 'events', 50);
}

export class DemoError extends Error {}

export async function demoRequest(path, { method = 'GET', params } = {}) {
  params = params || {};
  if (method === 'GET') {
    if (path === '/api/complaints') return listComplaints(params);
    if (path === '/api/alerts') return listAlerts(params);
    if (path === '/api/timeline') return listTimeline(params);
  }
  if (method === 'POST' && path === '/api/auth/login') return load('POST', path);
  if (method === 'GET' || /^\/api\/evidence\/\d+\/verify$/.test(path)) {
    try {
      return await load(method, path, method === 'GET' ? params : null);
    } catch {
      throw new DemoError('Not available in this offline demo snapshot.', { cause: 404 });
    }
  }
  throw new DemoError(
    'This is a read-only public demo — creating, editing and uploading are disabled. Run ARGUS locally for the full system.',
    { cause: 403 }
  );
}
