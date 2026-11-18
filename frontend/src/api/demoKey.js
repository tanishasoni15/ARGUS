/** Shared by the demo recorder (Node) and the demo client (browser). */
export function demoKey(method, path, params) {
  const entries = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)])
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const qs = new URLSearchParams(entries).toString();
  return `${method} ${path}${qs ? `?${qs}` : ''}`;
}

/** FNV-1a, 32-bit → hex. Stable, tiny, good enough to name a few thousand files. */
export function demoFile(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}.json`;
}
