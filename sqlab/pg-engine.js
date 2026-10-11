'use strict';
/* Engine PostgreSQL (PGlite, chạy bằng WebAssembly) + PostGIS. Chỉ tải khi người dùng chọn. */
const PG_URL = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/index.js';
const PGIS_URL = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite-postgis@0.2.8/dist/index.js';
const PG_HIDDEN = ['spatial_ref_sys', 'geometry_columns', 'geography_columns', 'raster_columns', 'raster_overviews'];
let _pgCore = null, _pgGis = null;

async function loadPgLib(wantGis) {
  if (window.SQLAB_PG_LIB) return window.SQLAB_PG_LIB; // dùng cho kiểm thử
  try {
    if (!_pgCore) _pgCore = import(PG_URL);
    const core = await _pgCore; let gis = null;
    if (wantGis) { if (!_pgGis) _pgGis = import(PGIS_URL); gis = await _pgGis; }
    return { PGlite: core.PGlite, postgis: gis && gis.postgis };
  } catch (e) {
    _pgCore = _pgGis = null;
    throw new Error('Không tải được PostgreSQL từ mạng (' + (e.message || e) + '). Hãy kiểm tra kết nối Internet.');
  }
}

function normVal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '+00');
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'object') return JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString() : x);
  return v;
}
const sqlLit = s => "'" + String(s).replace(/'/g, "''") + "'";

function makePgEngine(lib, proj) {
  let pg = null, gisOn = false, hidden = new Set(), geo = {};
  const dn = 'sqlab-pg-' + proj.id;
  const rows = async (sql, params) => (await pg.query(sql, params || [], { rowMode: 'array' })).rows;
  const keep = v => v; // giữ nguyên chuỗi ngày/giờ đúng như PostgreSQL hiển thị
  async function detectGis() {
    gisOn = (await rows("SELECT 1 FROM pg_extension WHERE extname='postgis'")).length > 0;
    hidden = gisOn ? new Set(PG_HIDDEN) : new Set();
    if (gisOn && !geo.geometry) { const o = (await rows("SELECT 'geometry'::regtype::oid::int, 'geography'::regtype::oid::int"))[0]; geo = { geometry: o[0], geography: o[1] }; }
    eng.gis = gisOn;
  }
  async function convertGeom(res, oids) {
    if (!gisOn) return res;
    for (let ci = 0; ci < oids.length; ci++) {
      const isG = oids[ci] === geo.geometry, isP = oids[ci] === geo.geography;
      if (!isG && !isP) continue;
      const uniq = [...new Set(res.values.slice(0, 5000).map(r => r[ci]).filter(v => typeof v === 'string'))].slice(0, 3000);
      if (!uniq.length) continue;
      try {
        const r = await rows(`SELECT ST_AsEWKT(v::${isP ? 'geography::geometry' : 'geometry'}) FROM unnest($1::text[]) WITH ORDINALITY t(v,i) ORDER BY i`, [uniq]);
        const map = new Map(uniq.map((u, i) => [u, r[i][0]]));
        for (const row of res.values) { const m = map.get(row[ci]); if (m !== undefined) row[ci] = m; }
      } catch (e) { /* giữ nguyên dạng hex nếu chuyển lỗi */ }
    }
    return res;
  }
  async function toResult(r) {
    const values = r.rows.length > ROW_CAP ? r.rows.slice(0, ROW_CAP) : r.rows;
    const res = { columns: r.fields.map(f => f.name), values: values.map(row => row.map(normVal)), truncated: r.rows.length > ROW_CAP };
    return convertGeom(res, r.fields.map(f => f.dataTypeID));
  }
  const eng = {
    kind: 'pg', proj, gis: false,
    get ready() { return !!pg; },
    async open() {
      const opts = { parsers: { 1082: keep, 1083: keep, 1114: keep, 1184: keep, 1266: keep } };
      if (proj.postgis) opts.extensions = { postgis: lib.postgis };
      pg = new lib.PGlite(lib.dataDir || ('idb://' + dn), opts);
      await pg.waitReady;
      if (proj.postgis) await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis');
      await detectGis();
    },
    async flush() { try { if (pg) await pg.syncToFs(); } catch (e) {} },
    async close() { if (pg) { const p = pg; pg = null; try { await p.close(); } catch (e) {} } },
    async destroy() {
      try {
        const names = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name).filter(n => n && n.includes(dn)) : [];
        for (const n of names.length ? names : ['/pglite/' + dn, dn]) await new Promise(res => { const r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = () => res(); });
      } catch (e) {}
    },
    markDirty() {},
    async exec(sql, atomic) {
      const stms = splitStatements(sql).map(s => s.text).filter(t => blankLit(t).trim());
      const raws = [], results = []; let changes = 0, count = 0;
      const own = /\b(begin|commit|rollback|savepoint|release|start\s+transaction)\b/i.test(blankLit(sql));
      const one = async cx => {
        for (const text of stms) {
          count++;
          const r = await cx.query(text, [], { rowMode: 'array' });
          if (r.fields && r.fields.length) raws.push(r);
          else if (/^\s*(insert|update|delete|merge|copy)\b/i.test(blankLit(text))) changes += r.affectedRows || 0;
        }
      };
      try { if (atomic && !own) await pg.transaction(cx => one(cx)); else await one(pg); }
      catch (e) { e.stmtNo = count; throw e; }
      for (const r of raws) results.push(await toResult(r)); // sau giao dịch, tránh khóa chéo
      return { results, changes, count };
    },
    async runScript(script) { await pg.exec(script); },
    async schema() {
      await detectGis();
      const r = await rows(`SELECT c.relname,c.relkind,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
        EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey))
        FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','v','p','m') ORDER BY c.relname,a.attnum`);
      const map = new Map();
      for (const [name, kind, an, t, nn, pk] of r) {
        if (hidden.has(name)) continue;
        if (!map.has(name)) map.set(name, { name, type: kind === 'v' || kind === 'm' ? 'view' : 'table', cols: [], n: null });
        map.get(name).cols.push({ n: an, t, nn: nn ? 1 : 0, pk: pk ? 1 : 0 });
      }
      const tabs = [...map.values()].filter(m => m.type === 'table');
      if (tabs.length) {
        try {
          const cr = await rows(tabs.map(m => `SELECT ${sqlLit(m.name)} AS t, COUNT(*)::int AS n FROM ${q(m.name)}`).join(' UNION ALL '));
          cr.forEach(([t, n]) => { map.get(t).n = n; });
        } catch (e) {}
      }
      return [...map.values()];
    },
    async tableData(name, limit) {
      const r = await pg.query(`SELECT * FROM ${q(name)} LIMIT ${limit}`, [], { rowMode: 'array' });
      return toResult(r);
    },
    async drop(name, type) { await pg.exec(`DROP ${type === 'view' ? 'VIEW' : 'TABLE'} ${q(name)}`); },
    async validate(sql) {
      try { await pg.describeQuery(sql); return null; }
      catch (e) { return { message: e.message, pos: e.position ? Number(e.position) - 1 : null }; }
    },
    async dump(name) { return { app: 'sqlab', version: 2, engine: 'pg', postgis: gisOn, name, script: await dumpScript() }; }
  };

  /* ---- mini pg_dump: tạo script SQL (cấu trúc + dữ liệu) cho schema public ---- */
  async function dumpScript() {
    await detectGis();
    const out = ['-- SQLab dump (PostgreSQL)'];
    if (gisOn) out.push('CREATE EXTENSION IF NOT EXISTS postgis;');
    const seqs = await rows(`SELECT s.sequencename, s.data_type::text, s.start_value::text, s.increment_by::text, s.min_value::text, s.max_value::text, s.last_value::text
      FROM pg_sequences s WHERE s.schemaname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=(quote_ident(s.schemaname)||'.'||quote_ident(s.sequencename))::regclass AND d.deptype IN ('a','i'))`);
    for (const [n, dt, st, inc, mn, mx, last] of seqs) {
      out.push(`CREATE SEQUENCE ${q(n)} AS ${dt} START ${st} INCREMENT ${inc} MINVALUE ${mn} MAXVALUE ${mx};`);
      if (last !== null) out.push(`SELECT setval(${sqlLit(q(n))}, ${last});`);
    }
    const tabs = (await rows("SELECT c.oid::int, c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') ORDER BY c.oid")).filter(t => !hidden.has(t[1]));
    const info = [];
    for (const [oid, name] of tabs) {
      const cols = await rows(`SELECT a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin,d.adrelid)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=$1::oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [oid]);
      const defs = [], dataCols = [], serial = []; let always = false;
      for (const [cn, ty, nn, ident, gen, dflt] of cols) {
        let t = ty, extra = '';
        if (gen === 's') extra = ` GENERATED ALWAYS AS (${dflt}) STORED`;
        else {
          dataCols.push(cn);
          if (ident) { extra = ident === 'a' ? ' GENERATED ALWAYS AS IDENTITY' : ' GENERATED BY DEFAULT AS IDENTITY'; serial.push(cn); if (ident === 'a') always = true; }
          else if (dflt && /^nextval\('.*'::regclass\)$/.test(dflt) && /^(integer|bigint|smallint)$/.test(ty)) { t = ty === 'integer' ? 'serial' : ty === 'bigint' ? 'bigserial' : 'smallserial'; serial.push(cn); }
          else if (dflt) extra = ' DEFAULT ' + dflt;
        }
        defs.push(`  ${q(cn)} ${t}${nn ? ' NOT NULL' : ''}${extra}`);
      }
      out.push(`CREATE TABLE ${q(name)} (\n${defs.join(',\n')}\n);`);
      info.push({ name, dataCols, serial, always });
    }
    for (const t of info) {
      if (!t.dataCols.length) continue;
      const data = await rows(`SELECT ${t.dataCols.map(c => `quote_nullable(${q(c)}::text)`).join(',')} FROM ${q(t.name)}`);
      for (let i = 0; i < data.length; i += 200) {
        out.push(`INSERT INTO ${q(t.name)} (${t.dataCols.map(q).join(', ')})${t.always ? ' OVERRIDING SYSTEM VALUE' : ''} VALUES\n` + data.slice(i, i + 200).map(r => '  (' + r.join(', ') + ')').join(',\n') + ';');
      }
    }
    for (const t of info) for (const c of t.serial) {
      out.push(`SELECT setval(pg_get_serial_sequence(${sqlLit('public.' + q(t.name))}, ${sqlLit(c)}), COALESCE((SELECT MAX(${q(c)}) FROM ${q(t.name)}), 0) + 1, false);`);
    }
    const cons = await rows(`SELECT quote_ident(r.relname), quote_ident(c.conname), pg_get_constraintdef(c.oid), r.relname
      FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
      WHERE c.connamespace='public'::regnamespace AND c.contype IN ('p','u','c','f','x') AND c.conparentid=0 ORDER BY (c.contype='f'), c.oid`);
    for (const [t, cn, def, raw] of cons) if (!hidden.has(raw)) out.push(`ALTER TABLE ${t} ADD CONSTRAINT ${cn} ${def};`);
    const idx = await rows(`SELECT indexdef, tablename FROM pg_indexes WHERE schemaname='public' AND indexname NOT IN
      (SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype IN ('p','u','x'))`);
    for (const [def, tn] of idx) if (!hidden.has(tn)) out.push(def + ';');
    const views = await rows("SELECT quote_ident(c.relname), pg_get_viewdef(c.oid,true), c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='v' ORDER BY c.oid");
    for (const [v, def, raw] of views) if (!hidden.has(raw)) out.push(`CREATE VIEW ${v} AS ${def.trim().replace(/;$/, '')};`);
    return out.join('\n') + '\n';
  }
  return eng;
}
