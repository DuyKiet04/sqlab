'use strict';
const editors = {}, grids = {};
let RES = [], resIdx = 0, HIST = [], ltabs = [], active = 'script', histTimer = 0, running = false, schemaTok = 0;
const expanded = new Set();

/* ---------- lưới dữ liệu ---------- */
function makeGrid(host) {
  const S = { cols: [], rows: [], page: 0, size: 100, sort: -1, dir: 1 };
  let view = [];
  const cmp = (a, b) => {
    if (a === b) return 0; if (a === null) return 1; if (b === null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  };
  const build = () => { view = S.sort < 0 ? S.rows : S.rows.slice().sort((x, y) => S.dir * cmp(x[S.sort], y[S.sort])); };
  const cell = v => v === null ? '<td class="nl">NULL</td>'
    : typeof v === 'number' ? `<td class="num">${v}</td>`
    : v instanceof Uint8Array ? `<td class="nl">[BLOB ${v.length} byte]</td>`
    : String(v).length > 40 ? `<td title="${esc(v)}">${esc(v)}</td>` : `<td>${esc(v)}</td>`;
  function paint() {
    const n = view.length, pages = Math.max(1, Math.ceil(n / S.size));
    if (S.page >= pages) S.page = pages - 1;
    const from = S.page * S.size, slice = view.slice(from, from + S.size);
    let h = '<div class="gwrap"><table><thead><tr><th class="rn">#</th>';
    S.cols.forEach((c, i) => { h += `<th data-c="${i}" title="Bấm để sắp xếp">${esc(c)}${S.sort === i ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`; });
    h += '</tr></thead><tbody>';
    slice.forEach((r, ri) => { h += `<tr><td class="rn">${from + ri + 1}</td>`; for (const v of r) h += cell(v); h += '</tr>'; });
    h += '</tbody></table>' + (n ? '' : '<p class="empty">Không có dòng nào.</p>') + '</div>';
    h += `<div class="pager"><button data-p="-1" ${S.page ? '' : 'disabled'}>‹</button><span>Trang ${S.page + 1}/${pages}</span><button data-p="1" ${S.page < pages - 1 ? '' : 'disabled'}>›</button><select aria-label="Số dòng mỗi trang">${[50, 100, 500, 1000].map(x => `<option ${x === S.size ? 'selected' : ''}>${x}</option>`).join('')}</select><span>dòng/trang</span></div>`;
    host.innerHTML = h;
  }
  host.addEventListener('click', e => {
    const th = e.target.closest('th[data-c]');
    if (th) { const i = +th.dataset.c; S.dir = S.sort === i ? -S.dir : 1; S.sort = i; build(); paint(); return; }
    const b = e.target.closest('button[data-p]');
    if (b) { S.page += +b.dataset.p; paint(); }
  });
  host.addEventListener('change', e => { if (e.target.tagName === 'SELECT') { S.size = +e.target.value; S.page = 0; paint(); } });
  return { set(cols, rows) { S.cols = cols; S.rows = rows; S.page = 0; S.sort = -1; build(); paint(); } };
}

/* ---------- kết quả & lịch sử ---------- */
function showBottom(tab) {
  $$('#bTabs [data-b]').forEach(b => b.classList.toggle('on', b.dataset.b === tab));
  $('#bRes').hidden = tab !== 'res'; $('#bLog').hidden = tab !== 'log';
}
function paintResult() {
  const r = RES[resIdx];
  $('#resChips').hidden = RES.length < 2;
  $('#resChips').innerHTML = RES.map((x, i) => `<button data-i="${i}" class="${i === resIdx ? 'on' : ''}">Bảng ${i + 1} (${x.values.length}${x.truncated ? '+' : ''} dòng)</button>`).join('');
  $('#resGrid').hidden = !r; $('#resNote').hidden = !!r; $('#btnCsv').disabled = !r;
  if (r) grids.res.set(r.columns, r.values);
}
function setResults(list, note, cls) {
  RES = list; resIdx = list.length ? list.length - 1 : 0;
  const n = $('#resNote'); n.textContent = note || ''; n.className = 'note' + (cls ? ' ' + cls : '');
  paintResult();
}
function persistHist() {
  clearTimeout(histTimer);
  histTimer = setTimeout(() => { if (META) idb.set('hist:' + META.cur, HIST).catch(() => {}); }, 1500);
}
function log(src, sql, ok, msg, ms) {
  HIST.unshift({ t: Date.now(), src, sql: sql.slice(0, 3000), ok, msg, ms });
  if (HIST.length > 300) HIST.length = 300;
  renderHist(); persistHist();
}
function renderHist() {
  const f = $('#hFilter').value.trim().toLowerCase();
  const list = HIST.map((h, i) => ({ h, i })).filter(x => !f || x.h.sql.toLowerCase().includes(f) || x.h.msg.toLowerCase().includes(f));
  $('#histBody').innerHTML = list.length ? list.slice(0, 150).map(({ h, i }) => {
    const d = new Date(h.t);
    return `<div class="hi ${h.ok ? '' : 'bad'}" data-i="${i}" title="Bấm để nạp lại vào ${h.src === 'Script' ? 'Script' : 'Truy vấn'}"><div class="hm"><span>${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN')}</span><span>${h.src}</span><span>${h.ms.toFixed(0)} ms</span></div><code>${esc(h.sql.replace(/\s+/g, ' ').slice(0, 110))}</code></div>`;
  }).join('') : '<p class="empty">Chưa có thao tác nào.</p>';
  $('#bLog').innerHTML = HIST.slice(0, 40).map(h => `<div class="lg ${h.ok ? '' : 'bad'}"><div class="m"><span>${new Date(h.t).toLocaleTimeString('vi-VN')}</span><span>${h.src}</span><span>${h.ms.toFixed(1)} ms</span></div><div class="r">${esc(h.msg)}</div><code>${esc(h.sql.slice(0, 300))}</code></div>`).join('') || '<p class="empty">Chưa có thông báo.</p>';
}

async function run(src) {
  if (!ENG || !ENG.ready) return toast('Đang khởi động, chờ chút...');
  if (running) return toast('Đang chạy câu lệnh trước, chờ chút...');
  const ed = src === 'Script' ? editors.script : editors.query, sql = ed.sql();
  if (!sql) return toast('Chưa có câu lệnh nào để chạy', 'bad');
  running = true; $('#runScript').disabled = $('#runQuery').disabled = true;
  const t0 = performance.now(), atomic = $('#atomic').checked;
  try {
    const r = await ENG.exec(sql, atomic), ms = performance.now() - t0, last = r.results[r.results.length - 1];
    const parts = [`${r.count} câu lệnh`];
    if (r.changes) parts.push(`${r.changes} dòng bị ảnh hưởng`);
    if (last) parts.push(`${last.values.length}${last.truncated ? '+' : ''} dòng kết quả`);
    const msg = 'Thành công: ' + parts.join(', ');
    log(src, sql, true, msg, ms);
    $('#binfo').textContent = ms.toFixed(1) + ' ms';
    setResults(r.results, r.results.length ? '' : msg + '.');
    showBottom('res');
    if (/\b(create|drop|alter|insert|update|delete|replace|pragma|vacuum|truncate|extension|merge)\b/i.test(sql)) { await refreshSchema(); ENG.markDirty(); }
    toast('Chạy xong trong ' + ms.toFixed(1) + ' ms', 'ok');
  } catch (e) {
    const ms = performance.now() - t0;
    const msg = 'Lỗi' + (e.stmtNo > 1 ? ` (câu lệnh thứ ${e.stmtNo})` : '') + ': ' + e.message + (atomic ? '. Đã hoàn tác (ROLLBACK).' : '');
    log(src, sql, false, msg, ms);
    setResults([], msg, 'bad'); $('#binfo').textContent = ''; showBottom('res');
    toast('Có lỗi, xem khung Kết quả', 'bad');
    await refreshSchema();
  } finally { running = false; $('#runScript').disabled = $('#runQuery').disabled = !ENG || !ENG.ready; }
}

/* ---------- cây bảng & tab dữ liệu ---------- */
async function refreshSchema() {
  if (!ENG || !ENG.ready) return;
  const my = ++schemaTok; let meta = [];
  try { meta = await ENG.schema(); } catch (e) {}
  if (my !== schemaTok) return;
  if (ENG.kind === 'pg' && GISON !== !!ENG.gis) setLang('pg', !!ENG.gis);
  schema = meta;
  NAMES.t = new Set(meta.map(m => m.name.toLowerCase()));
  NAMES.c = new Set(meta.flatMap(m => m.cols.map(c => c.n.toLowerCase())));
  ltabs = ltabs.filter(t => meta.some(m => m.name === t));
  if (active !== 'script' && !ltabs.includes(active)) active = 'script';
  renderTree(); renderTabs(); editors.script.paint(); editors.query.paint();
  editors.script.revalidate(); editors.query.revalidate();
  if (active !== 'script') await loadData();
}
function renderTree() {
  const f = $('#tFilter').value.trim().toLowerCase();
  const list = schema.filter(m => !f || m.name.toLowerCase().includes(f));
  $('#treeBody').innerHTML = list.length ? list.map(m => {
    const open = expanded.has(m.name);
    return `<div class="tb${open ? ' open' : ''}" data-t="${esc(m.name)}"><div class="tbrow" title="Bấm để xem cột, bấm đúp để xem dữ liệu"><span class="chev">${ic('chev')}</span><span class="nm">${esc(m.name)}${m.type === 'view' ? ' <small>view</small>' : ''}</span><em>${m.n ?? ''}</em><span class="acts"><button data-a="data" title="Xem dữ liệu">${ic('table')}</button><button data-a="tcopy" title="Copy tên bảng">${ic('copy')}</button><button data-a="sel" title="Tạo SELECT bên khung truy vấn">SELECT</button></span></div>${open ? '<ul class="cols">' + m.cols.map(c => `<li data-v="${esc(c.n)}" title="Bấm để copy tên cột"><span class="cn">${esc(c.n)}</span>${c.pk ? '<b>PK</b>' : ''}${c.nn ? '<b>NN</b>' : ''}<span class="ty">${esc(c.t || '')}</span><span class="acts"><button data-a="ccopy" title="Copy tên cột">${ic('copy')}</button><button data-a="cins" title="Chèn vào editor">${ic('insert')}</button></span></li>`).join('') + '</ul>' : ''}</div>`;
  }).join('') : `<p class="empty">${schema.length ? 'Không có bảng khớp.' : 'Chưa có bảng nào. Viết CREATE TABLE ở khung Script rồi bấm Chạy.'}</p>`;
}
async function copyName(t) { toast(await copyText(t) ? 'Đã copy: ' + t : 'Không copy được, hãy bôi đen và Ctrl+C', 'ok'); }
function onTreeClick(e) {
  const tb = e.target.closest('.tb'); if (!tb) return;
  const name = tb.dataset.t, btn = e.target.closest('button[data-a]');
  if (btn) {
    const a = btn.dataset.a, col = btn.closest('li') && btn.closest('li').dataset.v;
    if (a === 'data') openTab(name);
    else if (a === 'tcopy') copyName(name);
    else if (a === 'sel') editors.query.appendSelect(`SELECT * FROM ${ident(name)} LIMIT 100;`);
    else if (a === 'ccopy') copyName(col);
    else if (a === 'cins') (lastEd || editors.query).insert(ident(col));
    return;
  }
  const li = e.target.closest('li');
  if (li) return copyName(li.dataset.v);
  expanded.has(name) ? expanded.delete(name) : expanded.add(name); renderTree();
}
function renderTabs() {
  $('#lTabs').innerHTML = `<button data-l="script" class="${active === 'script' ? 'on' : ''}">Script</button>` +
    ltabs.map(t => `<button data-l="${esc(t)}" class="${active === t ? 'on' : ''}">${ic('table')}${esc(t)}<span class="x" data-x="${esc(t)}" title="Đóng">×</span></button>`).join('');
  $('#pScript').hidden = active !== 'script'; $('#pData').hidden = active === 'script';
}
function openTab(name) {
  if (name !== 'script' && !ltabs.includes(name)) ltabs.push(name);
  active = name; renderTabs();
  if (name !== 'script') loadData(); else editors.script.ta.focus();
}
async function loadData() {
  const name = active, m = schema.find(x => x.name === name); if (!m) return;
  $('#dName').textContent = name; $('#dDrop').textContent = m.type === 'view' ? 'Xóa view' : 'Xóa bảng';
  try {
    const t0 = performance.now(), r = await ENG.tableData(name, ROW_CAP);
    if (active !== name) return;
    const rows = r ? r.values : [];
    grids.data.set(r ? r.columns : m.cols.map(c => c.n), rows);
    $('#dInfo').textContent = `${m.cols.length} cột, ${m.n ?? '?'} dòng${rows.length < (m.n || 0) ? ` (hiện ${rows.length} dòng đầu)` : ''} · ${(performance.now() - t0).toFixed(1)} ms`;
  } catch (e) { grids.data.set(['Lỗi'], [[e.message]]); }
}

/* ---------- sidebar ---------- */
function setSideTab(t) {
  $$('#sTabs button').forEach(b => b.classList.toggle('on', b.dataset.s === t));
  $('#sTables').hidden = t !== 'tables'; $('#sHist').hidden = t !== 'hist';
  LS.set('sqlab_stab', t);
}
function setMin(min) { $('#side').classList.toggle('min', min); LS.set('sqlab_min', min ? '1' : '0'); }

/* ---------- dự án ---------- */
const engTag = p => p.engine === 'pg' ? (p.postgis ? ' · PG+GIS' : ' · PG') : '';
function renderProjects() {
  $('#projSel').innerHTML = META.list.map(p => `<option value="${esc(p.id)}" ${p.id === META.cur ? 'selected' : ''}>${esc(p.name)}${engTag(p)}</option>`).join('');
  const p = curProject(), b = $('#engBadge');
  b.textContent = p.engine === 'pg' ? (p.postgis ? 'PostgreSQL + PostGIS' : 'PostgreSQL') : 'SQLite';
  b.className = 'badge ' + (p.engine === 'pg' ? 'pg' : 'lite');
}
function busy(on, text) { $('#busy').hidden = !on; if (text) $('#busyText').textContent = text; }
async function openProject(id, first) {
  const p = META.list.find(x => x.id === id) || META.list[0];
  try {
    if (ENG) {
      if (!first) { await ENG.flush(); clearTimeout(histTimer); try { await idb.set('hist:' + META.cur, HIST); } catch (e) {} }
      await ENG.close();
    }
    ENG = null;
    if (p.engine === 'pg') {
      busy(true, p.postgis ? 'Đang tải PostgreSQL + PostGIS (lần đầu khoảng vài chục MB, sau đó trình duyệt sẽ lưu sẵn)...' : 'Đang tải PostgreSQL (lần đầu khoảng 16 MB, sau đó trình duyệt sẽ lưu sẵn)...');
      const lib = await loadPgLib(p.postgis), eng = makePgEngine(lib, p);
      await eng.open(); ENG = eng;
    } else { await sqliteEngine.open(p); ENG = sqliteEngine; }
  } catch (err) {
    busy(false); toast('Không mở được database: ' + err.message, 'bad');
    if (p.engine !== 'pg') throw err;
    let safe = META.list.find(x => x.engine !== 'pg');
    if (!safe) { safe = { id: newId(), name: 'Database SQLite', engine: 'sqlite' }; META.list.push(safe); }
    return openProject(safe.id, true);
  }
  busy(false);
  META.cur = p.id; saveMeta(); setLang(ENG.kind, ENG.gis);
  try { HIST = (await idb.get('hist:' + p.id)) || []; } catch (e) { HIST = []; }
  editors.script.load('sqlab_script_' + p.id, 'sqlab_script'); editors.query.load('sqlab_query_' + p.id, 'sqlab_query');
  ltabs = []; active = 'script'; expanded.clear(); $('#tFilter').value = '';
  setResults([], 'Chạy một truy vấn để xem kết quả ở đây.', 'mute'); $('#binfo').textContent = '';
  $('#runScript').disabled = $('#runQuery').disabled = false;
  renderProjects(); renderHist(); await refreshSchema();
}
async function addProject(name, opts = {}) {
  const id = newId(), proj = { id, name, engine: opts.engine || 'sqlite', postgis: !!opts.postgis };
  if (opts.bytes) await idb.set('db:' + id, opts.bytes);
  META.list.push(proj); saveMeta();
  await openProject(id);
  return proj;
}
function openNewModal() { $('#npName').value = 'Database ' + (META.list.length + 1); $('#newModal').hidden = false; $('#npName').select(); }
async function createFromModal() {
  const name = $('#npName').value.trim(); if (!name) return $('#npName').focus();
  const kind = $('#npEngine').value; $('#newModal').hidden = true;
  await addProject(name, { engine: kind === 'sqlite' ? 'sqlite' : 'pg', postgis: kind === 'pgis' });
  toast('Đã tạo "' + name + '"', 'ok');
}
function renameProject() {
  const p = curProject(), name = (prompt('Đổi tên database:', p.name) || '').trim(); if (!name) return;
  p.name = name; saveMeta(); renderProjects();
}
async function deleteProject() {
  if (META.list.length < 2) return toast('Cần giữ ít nhất 1 database. Hãy tạo database mới trước.', 'bad');
  const p = curProject(); if (!confirm(`Xóa database "${p.name}" và toàn bộ bảng, dữ liệu, lịch sử của nó? Không thể hoàn tác.`)) return;
  clearTimeout(saveTimer); dirty = false;
  try {
    if (p.engine === 'pg') { await ENG.close(); await ENG.destroy(); ENG = null; } else await idb.del('db:' + p.id);
    await idb.del('hist:' + p.id);
  } catch (e) {}
  LS.del('sqlab_script_' + p.id); LS.del('sqlab_query_' + p.id);
  META.list = META.list.filter(x => x.id !== p.id); META.cur = META.list[0].id; saveMeta();
  await openProject(META.cur, true); toast('Đã xóa "' + p.name + '"', 'ok');
}

/* ---------- sao lưu / khôi phục ---------- */
const safeName = s => s.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'database';
async function importObj(obj, label) {
  const name = (obj.name || label || 'Khôi phục') + ' (khôi phục)';
  if (obj.engine === 'pg') {
    if (!obj.script) throw new Error('thiếu nội dung script');
    await addProject(name, { engine: 'pg', postgis: !!obj.postgis });
    busy(true, 'Đang khôi phục dữ liệu PostgreSQL...');
    try { await ENG.runScript(obj.script); } finally { busy(false); }
    await refreshSchema(); return;
  }
  const d = new SQL.Database();
  try { restoreInto(d, obj); const bytes = d.export(); await addProject(name, { bytes }); } finally { d.close(); }
}
async function makeCode() {
  const code = await toCode(await ENG.dump(curProject().name));
  $('#bkCode').value = code;
  $('#bkInfo').textContent = `${(code.length / 1024).toFixed(1)} KB` + (code.length > 200000 ? ' · khá dài, nên dùng file JSON' : '');
  return code;
}
function initBackup() {
  const close = () => { $('#modal').hidden = true; };
  $('#btnBackup').onclick = () => {
    const pg = ENG && ENG.kind === 'pg';
    $('#bkSqlite').textContent = pg ? 'Tải .sql (dump)' : 'Tải .sqlite'; $('#bkSqliteIn').hidden = pg;
    $('#modal').hidden = false; $('#bkCode').value = ''; $('#bkInfo').textContent = '';
  };
  $('#mClose').onclick = close;
  $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) close(); });
  $('#bkJson').onclick = async () => { try { download(safeName(curProject().name) + '.sqlab.json', JSON.stringify(await ENG.dump(curProject().name)), 'application/json'); toast('Đã tải file JSON', 'ok'); } catch (e) { toast('Không sao lưu được: ' + e.message, 'bad'); } };
  $('#bkJsonIn').onclick = () => $('#fileJson').click();
  $('#fileJson').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { await importObj(JSON.parse(await f.text()), f.name.replace(/\.sqlab\.json$|\.json$/i, '')); close(); toast('Đã khôi phục thành database mới', 'ok'); }
    catch (err) { toast('Không khôi phục được: ' + err.message, 'bad'); }
  };
  $('#bkGen').onclick = async () => { try { await makeCode(); } catch (e) { toast('Không tạo được mã: ' + e.message, 'bad'); } };
  $('#bkCopy').onclick = async () => { try { const c = $('#bkCode').value || await makeCode(); toast(await copyText(c) ? 'Đã copy mã sao lưu' : 'Không copy được, hãy bôi đen và Ctrl+C', 'ok'); } catch (e) { toast(e.message, 'bad'); } };
  $('#bkLink').onclick = async () => {
    try { const c = $('#bkCode').value || await makeCode(), link = location.href.split('#')[0] + '#sqlab=' + c; toast(await copyText(link) ? 'Đã copy liên kết (chỉ dùng được khi app được đặt trên web)' : 'Không copy được', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  };
  $('#bkRestore').onclick = async () => {
    try { await importObj(await fromCode($('#bkPaste').value), 'Từ mã'); $('#bkPaste').value = ''; close(); toast('Đã khôi phục thành database mới', 'ok'); }
    catch (e) { toast('Mã không đúng hoặc bị cắt thiếu: ' + e.message, 'bad'); }
  };
  $('#bkSqlite').onclick = async () => {
    const nm = safeName(curProject().name);
    try { if (ENG.kind === 'pg') download(nm + '.sql', (await ENG.dump(nm)).script, 'text/plain'); else download(nm + '.sqlite', ENG.exportFile(), 'application/octet-stream'); } catch (e) { toast(e.message, 'bad'); }
  };
  $('#bkSqliteIn').onclick = () => $('#fileSqlite').click();
  $('#fileSqlite').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer()), t = new SQL.Database(bytes);
      try { t.exec('SELECT name FROM sqlite_master'); } catch (err) { throw new Error('không phải database SQLite hợp lệ'); } finally { t.close(); }
      await addProject(f.name.replace(/\.[^.]+$/, ''), { bytes }); close(); toast('Đã mở file thành database mới', 'ok');
    } catch (err) { toast('Không mở được: ' + err.message, 'bad'); }
  };
  $('#bkSqlIn').onclick = () => $('#fileSql').click();
  $('#fileSql').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    editors.script.set(await f.text()); openTab('script'); close(); toast('Đã nạp vào khung Script, bấm Chạy để thực thi', 'ok');
  };
}

/* ---------- khởi tạo ---------- */
function drag(el, move) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on'); document.body.classList.add('drag');
    const mv = ev => move(ev), up = () => { el.classList.remove('on'); document.body.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
function initUI() {
  $$('[data-ic]').forEach(el => el.insertAdjacentHTML('afterbegin', ic(el.dataset.ic)));
  editors.script = makeEditor($('#edScript'), { placeholder: '-- Viết CREATE TABLE / INSERT ở đây, rồi bấm Chạy script', onRun: () => run('Script') });
  editors.query = makeEditor($('#edQuery'), { placeholder: '-- Viết truy vấn SELECT ở đây (gõ để có gợi ý bảng, cột)', onRun: () => run('Query') });
  grids.res = makeGrid($('#resGrid')); grids.data = makeGrid($('#dGrid'));
  const root = document.documentElement.style, lw = LS.get('sqlab_lw', ''), bh = LS.get('sqlab_bh', '');
  if (lw) root.setProperty('--lw', lw + 'px'); if (bh) root.setProperty('--bh', bh + 'px');
  drag($('#vres'), e => { const r = $('#top2').getBoundingClientRect(), v = clamp(e.clientX - r.left, 240, r.width - 280); root.setProperty('--lw', v + 'px'); LS.set('sqlab_lw', Math.round(v)); });
  drag($('#hres'), e => { const r = $('.work').getBoundingClientRect(), v = clamp(r.bottom - e.clientY, 90, r.height - 220); root.setProperty('--bh', v + 'px'); LS.set('sqlab_bh', Math.round(v)); });
  $('#atomic').checked = LS.get('sqlab_atomic', '1') === '1';
  $('#atomic').onchange = e => LS.set('sqlab_atomic', e.target.checked ? '1' : '0');
  $('#runScript').onclick = () => run('Script'); $('#runQuery').onclick = () => run('Query');
  setMin(LS.get('sqlab_min', '0') === '1'); setSideTab(LS.get('sqlab_stab', 'tables'));
  $('#sToggle').onclick = () => setMin(!$('#side').classList.contains('min'));
  $('#sTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; setSideTab(b.dataset.s); if ($('#side').classList.contains('min')) setMin(false); };
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setMin(!$('#side').classList.contains('min')); } });
  $('#treeBody').onclick = onTreeClick;
  $('#treeBody').ondblclick = e => { const r = e.target.closest('.tbrow'); if (r && !e.target.closest('button')) openTab(r.closest('.tb').dataset.t); };
  $('#tFilter').oninput = renderTree; $('#hFilter').oninput = renderHist;
  $('#btnRefresh').onclick = () => ENG && refreshSchema();
  $('#histBody').onclick = e => {
    const el = e.target.closest('.hi'); if (!el) return; const h = HIST[+el.dataset.i]; if (!h) return;
    if (h.src === 'Script') { editors.script.set(h.sql); openTab('script'); } else { editors.query.set(h.sql); editors.query.ta.focus(); }
  };
  $('#hClear').onclick = () => { if (HIST.length && confirm('Xóa toàn bộ lịch sử của database này?')) { HIST = []; renderHist(); persistHist(); } };
  $('#lTabs').onclick = e => {
    const x = e.target.closest('[data-x]');
    if (x) { ltabs = ltabs.filter(t => t !== x.dataset.x); if (active === x.dataset.x) active = 'script'; renderTabs(); e.stopPropagation(); return; }
    const b = e.target.closest('[data-l]'); if (b) openTab(b.dataset.l);
  };
  $('#bTabs').onclick = e => { const b = e.target.closest('[data-b]'); if (b) showBottom(b.dataset.b); };
  $('#resChips').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { resIdx = +b.dataset.i; paintResult(); } };
  $('#dReload').onclick = refreshSchema;
  $('#dSelect').onclick = () => editors.query.appendSelect(`SELECT * FROM ${ident(active)} LIMIT 100;`);
  $('#dDrop').onclick = async () => {
    const m = schema.find(x => x.name === active); if (!m) return;
    if (!confirm(`Xóa ${m.type === 'view' ? 'view' : 'bảng'} "${m.name}" và toàn bộ dữ liệu?`)) return;
    try { await ENG.drop(m.name, m.type); log('Script', 'DROP ' + m.name, true, 'Đã xóa ' + m.name, 0); ENG.markDirty(); }
    catch (e) { toast(e.message, 'bad'); }
    await refreshSchema();
  };
  $('#btnCsv').onclick = () => {
    const r = RES[resIdx]; if (!r) return;
    const cell = v => v === null ? '' : /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    download('ket-qua.csv', '\ufeff' + [r.columns.map(cell).join(',')].concat(r.values.map(row => row.map(cell).join(','))).join('\r\n'), 'text/csv;charset=utf-8');
  };
  $('#projSel').onchange = e => openProject(e.target.value);
  $('#pNew').onclick = openNewModal;
  $('#npOk').onclick = createFromModal; $('#npCancel').onclick = () => { $('#newModal').hidden = true; };
  $('#npName').onkeydown = e => { if (e.key === 'Enter') createFromModal(); else if (e.key === 'Escape') $('#newModal').hidden = true; };
  $('#npEngine').onchange = () => { $('#npNote').textContent = { sqlite: 'Nhẹ, chạy ngay, không cần mạng.', pg: 'PostgreSQL thật chạy trong trình duyệt. Lần đầu cần mạng, tải khoảng 16 MB rồi được lưu sẵn.', pgis: 'PostgreSQL + PostGIS (dữ liệu không gian). Lần đầu cần mạng, tải khoảng 35 MB rồi được lưu sẵn. Các bảng hệ thống của PostGIS được ẩn.' }[$('#npEngine').value]; }; $('#pRen').onclick = renameProject; $('#pDel').onclick = deleteProject;
  initBackup();
  document.addEventListener('visibilitychange', () => { if (document.hidden && ENG) ENG.flush(); });
  window.addEventListener('pagehide', () => { if (ENG) ENG.flush(); });
  loadMeta();
  editors.script.load('sqlab_script_' + META.cur, 'sqlab_script'); editors.query.load('sqlab_query_' + META.cur, 'sqlab_query');
  setResults([], 'Chạy một truy vấn để xem kết quả ở đây.', 'mute');
  renderProjects(); renderHist();
}

async function boot() {
  initUI();
  let buf;
  const b64 = window.SQLITE_WASM_B64; window.SQLITE_WASM_B64 = null;
  try { buf = await (await fetch('data:application/wasm;base64,' + b64)).arrayBuffer(); }
  catch (e) { buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; }
  SQL = await initSqlJs({ wasmBinary: buf });
  await openProject(META.cur, true);
  $('#runScript').disabled = $('#runQuery').disabled = false;
  $('#status').textContent = 'Sẵn sàng. Dữ liệu tự lưu trong trình duyệt.'; $('#status').className = 'status ok';
  const m = /^#sqlab=(.+)$/.exec(location.hash);
  if (m && confirm('Phát hiện dữ liệu chia sẻ trong liên kết. Nhập thành database mới?')) {
    try { await importObj(await fromCode(m[1]), 'Từ liên kết'); toast('Đã nhập dữ liệu từ liên kết', 'ok'); } catch (e) { toast('Liên kết không hợp lệ: ' + e.message, 'bad'); }
    history.replaceState(null, '', location.pathname + location.search);
  }
}
boot().catch(e => { $('#status').textContent = 'Không khởi động được SQLite: ' + e.message; $('#status').className = 'status bad'; });
