let PGMODE = false, GISON = false;
const KW_BASE = ('select from where and or not null insert into values update set delete create table drop alter add column rename to index view trigger primary key foreign references default unique check constraint join inner left right outer cross natural on using as group by order having limit offset distinct union intersect except all case when then else end is in like glob between exists asc desc autoincrement integer int text real blob numeric varchar char boolean date datetime if begin commit rollback transaction savepoint release pragma with recursive replace cast returning collate over partition window filter true false vacuum explain analyze temp temporary cascade restrict').split(' ');
const KW_PGX = ('serial bigserial smallserial uuid jsonb json timestamp timestamptz interval bytea geometry geography ilike similar schema extension sequence materialized lateral only generated always identity overriding system value truncate restart do language function procedure array').split(' ');
const FUNCS_BASE = ['count', 'sum', 'avg', 'min', 'max', 'round', 'abs', 'length', 'lower', 'upper', 'substr', 'replace', 'trim', 'ltrim', 'rtrim', 'instr', 'coalesce', 'ifnull', 'nullif', 'iif', 'typeof', 'random', 'date', 'time', 'datetime', 'julianday', 'strftime', 'group_concat', 'printf', 'json_extract', 'json_array', 'json_object', 'row_number', 'rank', 'dense_rank', 'lag', 'lead', 'total', 'hex', 'quote', 'last_insert_rowid', 'changes'];
const FUNCS_PG = ['count', 'sum', 'avg', 'min', 'max', 'round', 'floor', 'ceil', 'abs', 'power', 'sqrt', 'random', 'length', 'lower', 'upper', 'substring', 'replace', 'trim', 'left', 'right', 'split_part', 'regexp_replace', 'position', 'concat', 'concat_ws', 'coalesce', 'nullif', 'greatest', 'least', 'now', 'current_date', 'current_timestamp', 'age', 'date_trunc', 'extract', 'to_char', 'to_date', 'to_timestamp', 'string_agg', 'array_agg', 'unnest', 'array_length', 'generate_series', 'gen_random_uuid', 'jsonb_build_object', 'jsonb_agg', 'row_number', 'rank', 'dense_rank', 'lag', 'lead'];
const FUNCS_GIS = ['ST_Point', 'ST_MakePoint', 'ST_SetSRID', 'ST_SRID', 'ST_Transform', 'ST_GeomFromText', 'ST_GeomFromGeoJSON', 'ST_GeogFromText', 'ST_AsText', 'ST_AsEWKT', 'ST_AsGeoJSON', 'ST_X', 'ST_Y', 'ST_Distance', 'ST_DistanceSphere', 'ST_DWithin', 'ST_Intersects', 'ST_Contains', 'ST_Within', 'ST_Covers', 'ST_Touches', 'ST_Crosses', 'ST_Overlaps', 'ST_Equals', 'ST_Buffer', 'ST_Area', 'ST_Length', 'ST_Perimeter', 'ST_Centroid', 'ST_Envelope', 'ST_Union', 'ST_Intersection', 'ST_Difference', 'ST_ConvexHull', 'ST_Collect', 'ST_MakeLine', 'ST_MakePolygon', 'ST_MakeEnvelope', 'ST_ClosestPoint', 'ST_Simplify', 'ST_IsValid', 'ST_MakeValid', 'ST_NumPoints', 'ST_GeometryType', 'ST_Extent', 'ST_AsBinary', 'postgis_version'];
const SNIPS_SQLITE = [
  { label: 'ctable', detail: 'snippet: tạo bảng', ins: 'CREATE TABLE ten_bang (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  ten TEXT NOT NULL$0\n);' },
  { label: 'sins', detail: 'snippet: INSERT', ins: 'INSERT INTO $0 () VALUES ();' },
  { label: 'sjoin', detail: 'snippet: SELECT + JOIN', ins: 'SELECT *\nFROM $0 a\nJOIN b ON a.id = b.a_id;' },
  { label: 'sgroup', detail: 'snippet: GROUP BY', ins: 'SELECT $0, COUNT(*)\nFROM \nGROUP BY ;' }
];
const SNIPS_PG = [
  { label: 'ctable', detail: 'snippet: tạo bảng', ins: 'CREATE TABLE ten_bang (\n  id SERIAL PRIMARY KEY,\n  ten TEXT NOT NULL$0\n);' },
  { label: 'sins', detail: 'snippet: INSERT', ins: 'INSERT INTO $0 () VALUES ();' },
  { label: 'sjoin', detail: 'snippet: SELECT + JOIN', ins: 'SELECT *\nFROM $0 a\nJOIN b ON a.id = b.a_id;' },
  { label: 'sgroup', detail: 'snippet: GROUP BY', ins: 'SELECT $0, COUNT(*)\nFROM \nGROUP BY ;' }
];
const SNIPS_GIS = [
  { label: 'cgeom', detail: 'snippet: bảng có cột không gian', ins: 'CREATE TABLE diem (\n  id SERIAL PRIMARY KEY,\n  ten TEXT,\n  geom geometry(Point, 4326)$0\n);' },
  { label: 'sgeom', detail: 'snippet: INSERT điểm', ins: "INSERT INTO $0 (ten, geom) VALUES ('A', ST_SetSRID(ST_MakePoint(106.70, 10.78), 4326));" },
  { label: 'sdist', detail: 'snippet: tìm theo khoảng cách', ins: 'SELECT ten, ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(106.70, 10.78), 4326)::geography) AS met\nFROM $0\nORDER BY met;' }
];
let KW_LIST = [], KW = new Set(), FUNCS = [], FN = new Set(), SNIPS = [], KWUP = [];
function setLang(kind, gis) {
  PGMODE = kind === 'pg'; GISON = !!gis;
  KW_LIST = PGMODE ? KW_BASE.concat(KW_PGX) : KW_BASE;
  KW = new Set(KW_LIST); KWUP = KW_LIST.map(k => k.toUpperCase());
  FUNCS = PGMODE ? FUNCS_PG.concat(GISON ? FUNCS_GIS : []) : FUNCS_BASE;
  FN = new Set(FUNCS.map(f => f.toLowerCase()));
  SNIPS = PGMODE ? SNIPS_PG.concat(GISON ? SNIPS_GIS : []) : SNIPS_SQLITE;
}
setLang('sqlite', false);

function hl(s) {
  if (s.length > 150000) return esc(s);
  return s.replace(/(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*(?:'|$))|("(?:[^"]|"")*(?:"|$))|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([&<>])/g,
    (...a) => {
      const m = a[0], cm = a[1], str = a[2], dq = a[3], num = a[4], w = a[5];
      if (cm) return '<i class="c">' + esc(m) + '</i>';
      if (str) return '<i class="s">' + esc(m) + '</i>';
      if (dq) { const n = m.slice(1, -1).toLowerCase(); return '<i class="' + (NAMES.t.has(n) ? 't' : NAMES.c.has(n) ? 'f' : 's') + '">' + esc(m) + '</i>'; }
      if (num) return '<i class="n">' + m + '</i>';
      if (w) {
        const l = w.toLowerCase();
        if (KW.has(l)) return '<i class="k">' + w + '</i>';
        if (FN.has(l) && /^\s*\(/.test(a[a.length - 1].substr(a[a.length - 2] + m.length, 12))) return '<i class="fn">' + w + '</i>';
        return NAMES.t.has(l) ? '<i class="t">' + w + '</i>' : NAMES.c.has(l) ? '<i class="f">' + w + '</i>' : w;
      }
      return esc(m);
    });
}

/* thay chú thích và chuỗi '...' bằng khoảng trắng (giữ nguyên độ dài và xuống dòng) */
function blankLit(t) {
  if (PGMODE) t = t.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, m => m.replace(/[^\n]/g, ' '));
  return t.replace(/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^']|'')*(?:'|$)/g, m => m.replace(/[^\n]/g, ' '));
}

function splitStatements(t) {
  const out = []; let i = 0, s = 0; const n = t.length;
  while (i < n) {
    const c = t[i], d = t[i + 1];
    if (c === '-' && d === '-') { const e = t.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && d === '*') { const e = t.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) { if (t[j] === c) { if (t[j + 1] === c) { j += 2; continue; } break; } j++; }
      i = j + 1; continue;
    }
    if (PGMODE && c === '$') {
      const m = /^\$(\w*)\$/.exec(t.slice(i, i + 60));
      if (m) { const e = t.indexOf(m[0], i + m[0].length); i = e < 0 ? n : e + m[0].length; continue; }
    }
    if (c === ';') { out.push({ start: s, end: i }); s = i + 1; }
    i++;
  }
  if (s < n) out.push({ start: s, end: n });
  const m = [];
  for (let k = 0; k < out.length; k++) {
    let cur = out[k];
    while (!PGMODE && k + 1 < out.length) {
      const x = blankLit(t.slice(cur.start, cur.end)).trim();
      if (/^create\s+(?:temp(?:orary)?\s+)?trigger\b/i.test(x) && !/\bend$/i.test(x)) { k++; cur = { start: cur.start, end: out[k].end }; } else break;
    }
    m.push(cur);
  }
  return m.map(x => ({ start: x.start, end: x.end, text: t.slice(x.start, x.end) }));
}
function statementAt(v, pos) {
  for (const s of splitStatements(v)) if (pos >= s.start && pos <= s.end) return s;
  return { start: pos, end: pos, text: '' };
}
function inLiteral(v, pos) {
  const st = statementAt(v, pos).start; let i = st;
  while (i < pos) {
    const c = v[i], d = v[i + 1];
    if (c === '-' && d === '-') { const e = v.indexOf('\n', i); if (e < 0 || e >= pos) return true; i = e; continue; }
    if (c === '/' && d === '*') { const e = v.indexOf('*/', i + 2); if (e < 0 || e + 2 > pos) return true; i = e + 2; continue; }
    if (c === "'") { let j = i + 1; while (j < v.length) { if (v[j] === "'") { if (v[j + 1] === "'") { j += 2; continue; } break; } j++; } if (j >= pos) return true; i = j + 1; continue; }
    i++;
  }
  return false;
}

const NOALIAS = new Set('where on join inner left right full outer cross natural group order having limit offset union intersect except set values using select from returning window when then else end and or not as is in like between exists case with default'.split(' '));
function parseTables(stmt) {
  const t = blankLit(stmt), res = [];
  const unq = s => s ? s.replace(/^["`\[]|["`\]]$/g, '') : null;
  const add = (name, alias) => {
    const n = unq(name.split('.').pop());
    const tb = schema.find(m => m.name.toLowerCase() === n.toLowerCase());
    if (!tb) return;
    const al = alias && !NOALIAS.has(alias.toLowerCase()) ? unq(alias) : null;
    res.push({ table: tb, alias: al });
  };
  const re = /\b(from|join|update|into|table)\s+((?:"[^"]+"|`[^`]+`|[A-Za-z_]\w*)(?:\.(?:"[^"]+"|\w+))?)(?:\s+(?:as\s+)?("[^"]+"|[A-Za-z_]\w*))?/gi;
  const cre = /^\s*,\s*("[^"]+"|[A-Za-z_]\w*)(?:\s+(?:as\s+)?("[^"]+"|[A-Za-z_]\w*))?/;
  let m;
  while ((m = re.exec(t))) {
    add(m[2], m[3]);
    if (m[1].toLowerCase() === 'from') {
      let pos = re.lastIndex, cm;
      while ((cm = cre.exec(t.slice(pos)))) { add(cm[1], cm[2]); pos += cm[0].length; }
      re.lastIndex = Math.max(re.lastIndex, pos);
    }
  }
  return res;
}
