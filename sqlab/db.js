'use strict';
let SQL, db = null, ENG = null, schema = [], lastEd = null, dirty = false;
const NAMES = { t: new Set(), c: new Set() };
const ROW_CAP = 20000;
let META = null; // { cur, list:[{id,name}] }

/* ---------- dự án (nhiều database có tên) ---------- */
function loadMeta() {
  try { META = JSON.parse(LS.get('sqlab_meta', 'null')); } catch (e) { META = null; }
  if (!META || !Array.isArray(META.list) || !META.list.length) META = { cur: 'p1', list: [{ id: 'p1', name: 'Database 1' }] };
  META.list.forEach(p => { if (!p.engine) p.engine = 'sqlite'; });
  if (!META.list.some(p => p.id === META.cur)) META.cur = META.list[0].id;
  saveMeta();
}
const saveMeta = () => LS.set('sqlab_meta', JSON.stringify(META));
const curProject = () => META.list.find(p => p.id === META.cur);
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

function openDb(bytes) {
  if (db) try { db.close(); } catch (e) {}
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  dirty = false;
}
let saveTimer = 0;
function saveSoon() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1200); }
async function saveNow() {
  clearTimeout(saveTimer);
  if (!db || !dirty) return;
  try {
    const data = db.export(); db.run('PRAGMA foreign_keys = ON');
    await idb.set('db:' + META.cur, data); dirty = false;
    $('#status').textContent = 'Đã lưu trong trình duyệt'; $('#status').className = 'status ok';
  } catch (e) { toast('Không lưu được vào trình duyệt. Hãy dùng Sao lưu để giữ dữ liệu.', 'bad'); }
}

/* ---------- chạy SQL (có giới hạn dòng, có giao dịch an toàn) ---------- */
function execSql(sql, atomic) {
  const results = []; let changes = 0, count = 0;
  const wrap = atomic && !/\b(begin|commit|rollback|savepoint|release)\b/i.test(sql);
  if (wrap) db.run('BEGIN');
  try {
    for (const st of db.iterateStatements(sql)) {
      count++;
      const cols = st.getColumnNames();
      if (cols.length) {
        const rows = []; let truncated = false;
        while (st.step()) { if (rows.length >= ROW_CAP) { truncated = true; break; } rows.push(st.get()); }
        results.push({ columns: cols, values: rows, truncated });
      } else {
        st.step();
        if (/^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(insert|update|delete|replace)\b/i.test(st.getSQL())) changes += db.getRowsModified();
      }
    }
    if (wrap) db.run('COMMIT');
  } catch (e) {
    if (wrap) try { db.run('ROLLBACK'); } catch (_) {}
    e.stmtNo = count; throw e;
  }
  return { results, changes, count };
}

/* ---------- sao lưu: JSON + mã nén ---------- */
const encVal = v => v instanceof Uint8Array ? { $b: b64u.enc(v) } : v;
const decVal = v => v && typeof v === 'object' && '$b' in v ? b64u.dec(v.$b) : v;
function dumpDb(d, name) {
  const out = { app: 'sqlab', version: 1, name, exported: new Date().toISOString(), objects: [], data: {} };
  const r = d.exec("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL");
  for (const [type, nm, sql] of (r[0] ? r[0].values : [])) {
    out.objects.push({ type, name: nm, sql });
    if (type === 'table') {
      const t = d.exec(`SELECT * FROM ${q(nm)}`);
      out.data[nm] = t[0] ? { cols: t[0].columns, rows: t[0].values.map(row => row.map(encVal)) } : { cols: [], rows: [] };
    }
  }
  return out;
}
function restoreInto(d, obj) {
  if (!obj || obj.app !== 'sqlab' || !Array.isArray(obj.objects)) throw new Error('Dữ liệu không phải bản sao lưu của SQLab');
  d.run('PRAGMA foreign_keys = OFF'); d.run('BEGIN');
  try {
    for (const o of obj.objects) if (o.type === 'table') d.run(o.sql);
    for (const [name, t] of Object.entries(obj.data || {})) {
      if (!t.rows.length) continue;
      const st = d.prepare(`INSERT INTO ${q(name)} (${t.cols.map(q).join(',')}) VALUES (${t.cols.map(() => '?').join(',')})`);
      try { for (const row of t.rows) st.run(row.map(decVal)); } finally { st.free(); }
    }
    for (const type of ['index', 'view', 'trigger']) for (const o of obj.objects) if (o.type === type) d.run(o.sql);
    d.run('COMMIT');
  } catch (e) { try { d.run('ROLLBACK'); } catch (_) {} throw e; }
  d.run('PRAGMA foreign_keys = ON');
}
const b64u = {
  enc(u8) {
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u;
  }
};
async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
async function toCode(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') return 'SQLAB1:' + b64u.enc(await pipe(raw, new CompressionStream('gzip')));
  return 'SQLAB0:' + b64u.enc(raw);
}
async function fromCode(code) {
  code = String(code).trim();
  const lm = /sqlab=([^&\s]+)/.exec(code); if (lm) code = decodeURIComponent(lm[1]);
  const i = code.indexOf(':'); if (i < 0) throw new Error('Mã không hợp lệ');
  const tag = code.slice(0, i), u = b64u.dec(code.slice(i + 1));
  let raw;
  if (tag === 'SQLAB1') raw = await pipe(u, new DecompressionStream('gzip')); else if (tag === 'SQLAB0') raw = u; else throw new Error('Mã không hợp lệ');
  return JSON.parse(new TextDecoder().decode(raw));
}

/* ---------- engine SQLite (sql.js) theo giao diện chung với engine PostgreSQL ---------- */
const sqliteEngine = {
  kind: 'sqlite', gis: false,
  get ready() { return !!db; },
  async open(proj) {
    let bytes = null;
    try { bytes = await idb.get('db:' + proj.id); if (!bytes && proj.id === 'p1') bytes = await idb.get('db'); } catch (e) {}
    try { openDb(bytes || null); } catch (e) { openDb(null); }
  },
  async flush() { await saveNow(); },
  async close() { await saveNow(); if (db) { try { db.close(); } catch (e) {} db = null; } },
  markDirty() { saveSoon(); },
  async exec(sql, atomic) { return execSql(sql, atomic); },
  async schema() {
    const meta = [];
    const r = db.exec("SELECT name,type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
    for (const [name, type] of (r[0] ? r[0].values : [])) {
      let cols = [], n = null;
      try { cols = db.exec(`PRAGMA table_info(${q(name)})`)[0].values.map(c => ({ n: c[1], t: c[2], nn: c[3], pk: c[5] })); } catch (e) {}
      try { n = db.exec(`SELECT COUNT(*) FROM ${q(name)}`)[0].values[0][0]; } catch (e) {}
      meta.push({ name, type, cols, n });
    }
    return meta;
  },
  async tableData(name, limit) { const r = db.exec(`SELECT * FROM ${q(name)} LIMIT ${limit}`); return r[0] ? { columns: r[0].columns, values: r[0].values } : null; },
  async drop(name, type) { db.run(`DROP ${type === 'view' ? 'VIEW' : 'TABLE'} ${q(name)}`); },
  async validate(sql) { try { const s = db.prepare(sql); s.free(); return null; } catch (e) { return { message: e.message, pos: null }; } },
  async dump(name) { const o = dumpDb(db, name); db.run('PRAGMA foreign_keys = ON'); return o; },
  exportFile() { const b = db.export(); db.run('PRAGMA foreign_keys = ON'); return b; }
};
