'use strict';
const LH = 20, PADT = 10, PADL = 54;
const KINDC = { col: 'C', table: 'T', alias: 'A', fn: 'ƒ', kw: 'K', snip: 'S' };
const ORDER = { col: 0, alias: 1, table: 2, fn: 3, kw: 4, snip: 5 };
const ORDER_T = { table: 0, alias: 1, col: 2, fn: 3, kw: 4, snip: 5 };
let _cw = 0;
function charW(el) {
  if (_cw) return _cw;
  const s = document.createElement('span');
  s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:13px/20px var(--mono)';
  s.textContent = 'M'.repeat(100); el.appendChild(s);
  const w = s.getBoundingClientRect().width / 100; s.remove();
  if (w > 3) { _cw = w; return w; }
  return 7.8;
}

function viMsg(m, cols) {
  let x, r = m;
  if (PGMODE) {
    if ((x = /syntax error at or near "([^"]*)"/.exec(m))) { r = `Lỗi cú pháp gần "${x[1]}"`; const k = /^[A-Za-z]+$/.test(x[1]) ? nearest(x[1], KWUP) : null; if (k) r += `. Có phải ý bạn là ${k}?`; }
    else if (/syntax error at end of input/.test(m)) r = 'Câu lệnh chưa hoàn chỉnh (thiếu phần cuối, hoặc thiếu ngoặc/nháy đóng)';
    else if ((x = /relation "([^"]+)" does not exist/.exec(m))) { r = `Không có bảng "${x[1]}"`; const s = nearest(x[1], schema.map(t => t.name)); if (s) r += `. Có phải "${s}"?`; }
    else if ((x = /column (?:"([^"]+)"|(\S+)) does not exist/.exec(m))) { const nm = x[1] || x[2]; r = `Không có cột "${nm}"`; const s = nearest(nm.split('.').pop(), cols); if (s) r += `. Có phải "${s}"?`; }
    else if ((x = /column reference "([^"]+)" is ambiguous/.exec(m))) r = `Tên cột "${x[1]}" không rõ ràng (nhiều bảng cùng có), hãy ghi bảng.cột`;
    else if ((x = /relation "([^"]+)" already exists/.exec(m))) r = `"${x[1]}" đã tồn tại`;
    else if ((x = /function (.+) does not exist/.exec(m))) { r = `Không có hàm ${x[1]}`; if (/^st_/i.test(x[1]) && !GISON) r += ' (hãy dùng database loại PostgreSQL + PostGIS)'; }
    else if ((x = /type "([^"]+)" does not exist/.exec(m))) { r = `Không có kiểu dữ liệu "${x[1]}"`; if (/^geo(metry|graphy)$/i.test(x[1]) && !GISON) r += ' (cần database PostgreSQL + PostGIS)'; }
    else if (/unterminated (quoted|dollar)/.test(m)) r = 'Chuỗi chưa được đóng nháy';
    return r;
  }
  if ((x = /near "([^"]*)": syntax error/.exec(m))) {
    r = x[1] ? `Lỗi cú pháp gần "${x[1]}"` : 'Lỗi cú pháp: câu lệnh bị cắt ngang ở cuối';
    const k = /^[A-Za-z]+$/.test(x[1]) ? nearest(x[1], KWUP) : null;
    if (k) r += `. Có phải ý bạn là ${k}?`;
  } else if (/incomplete input/.test(m)) r = 'Câu lệnh chưa hoàn chỉnh (thiếu phần cuối, hoặc thiếu ngoặc/nháy đóng)';
  else if ((x = /no such table: (.+)/.exec(m))) { r = `Không có bảng "${x[1]}"`; const s = nearest(x[1], schema.map(t => t.name)); if (s) r += `. Có phải "${s}"?`; }
  else if ((x = /no such column: (.+)/.exec(m))) { r = `Không có cột "${x[1]}"`; const s = nearest(x[1].split('.').pop(), cols); if (s) r += `. Có phải "${s}"?`; }
  else if ((x = /ambiguous column name: (.+)/.exec(m))) r = `Tên cột "${x[1]}" không rõ ràng (nhiều bảng cùng có), hãy ghi bảng.cột`;
  else if ((x = /(?:table|index|view) (.+) already exists/.exec(m))) r = `"${x[1]}" đã tồn tại`;
  else if ((x = /unrecognized token: (.+)/.exec(m))) r = `Ký tự/chuỗi không hợp lệ: ${x[1]}`;
  else if ((x = /no such function: (.+)/.exec(m))) r = `Không có hàm "${x[1]}"`;
  else if ((x = /table (.+) has no column named (.+)/.exec(m))) r = `Bảng ${x[1]} không có cột "${x[2]}"`;
  return r;
}

function makeEditor(host, { placeholder, onRun }) {
  host.classList.add('edwrap');
  host.innerHTML = '<div class="ed"><div class="gut"></div><pre class="hl" aria-hidden="true"></pre><pre class="dg" aria-hidden="true"></pre><textarea wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Trình soạn thảo SQL"></textarea><div class="ac" hidden></div><div class="tip" hidden></div></div><button class="prob" hidden></button>';
  const edEl = host.firstChild, prob = host.lastChild;
  const [gut, pre, dg, ta, acEl, tip] = edEl.children;
  ta.placeholder = placeholder;
  let raf = 0, diags = [], gutKey = '', dgTimer = 0, suppress = false;
  const ac = { open: false, items: [], sel: 0, from: 0 };
  const ed = { ta, key: '' };

  const lineStarts = v => { const a = [0]; for (let i = v.indexOf('\n'); i >= 0; i = v.indexOf('\n', i + 1)) a.push(i + 1); return a; };
  const lineOf = (st, off) => { let lo = 0, hi = st.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid] <= off) lo = mid; else hi = mid - 1; } return lo; };
  const sync = () => { pre.scrollTop = dg.scrollTop = gut.scrollTop = ta.scrollTop; pre.scrollLeft = dg.scrollLeft = ta.scrollLeft; };
  function caretXY(pos) {
    const v = ta.value, st = lineStarts(v), line = lineOf(st, pos); let col = 0;
    for (const ch of v.slice(st[line], pos)) col += ch === '\t' ? 2 - (col % 2) : 1;
    return { x: PADL + col * charW(edEl) - ta.scrollLeft, y: PADT + (line + 1) * LH - ta.scrollTop };
  }

  /* ----- vẽ ----- */
  function paintDg() {
    const v = ta.value, st = lineStarts(v); let h = '', p = 0;
    const rs = diags.filter(d => d.from < v.length).sort((a, b) => a.from - b.from), er = new Set();
    for (const d of rs) {
      er.add(lineOf(st, d.from) + 1);
      if (d.from < p) continue;
      const to = Math.min(Math.max(d.to, d.from + 1), v.length);
      h += esc(v.slice(p, d.from)) + '<u class="e">' + esc(v.slice(d.from, to)) + '</u>'; p = to;
    }
    dg.innerHTML = h + esc(v.slice(p)) + '\n ';
    const key = st.length + '|' + [...er].join(',');
    if (key !== gutKey) { gutKey = key; let g = ''; for (let i = 1; i <= st.length; i++) g += er.has(i) ? `<b>${i}</b>\n` : i + '\n'; gut.innerHTML = g; }
    if (rs.length) {
      const d = rs[0], ln = lineOf(st, d.from);
      prob.hidden = false;
      prob.innerHTML = `${ic('warn')}<span>Dòng ${ln + 1}, cột ${d.from - st[ln] + 1}: ${esc(d.msg)}${rs.length > 1 ? ` <em>(+${rs.length - 1} lỗi khác)</em>` : ''}</span>`;
      prob._d = d;
    } else prob.hidden = true;
  }
  const paint = () => { raf = 0; pre.innerHTML = hl(ta.value) + '\n '; paintDg(); sync(); };
  const schedPaint = () => { if (!raf) raf = requestAnimationFrame(paint); };

  /* ----- kiểm tra lỗi (như VSCode): dùng chính SQLite để prepare từng câu ----- */
  let diagTok = 0;
  const lastNon = t => { const n = t.trimEnd().length; return [Math.max(0, n - 1), n]; };
  async function locate(err, s) {
    const t = blankLit(s.text), msg = err.message; let m, r = null;
    if (err.pos != null) {
      if (/at end of input/.test(msg)) r = lastNon(t);
      else { const tk = /^("[^"]*"|\w+|\S)/.exec(s.text.slice(err.pos)); r = [err.pos, err.pos + (tk ? tk[0].length : 1)]; }
    } else {
      const word = (w, from = 0) => {
        const re = new RegExp('(^|[^\\w])(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\w])', 'i'), x = re.exec(t.slice(from));
        return x ? [from + x.index + x[1].length, from + x.index + x[1].length + x[2].length] : null;
      };
      if ((m = /near "([^"]*)"/.exec(msg))) {
        const tok = m[1];
        if (!tok) r = lastNon(t);
        else {
          let i = t.indexOf(tok), first = null;
          while (i >= 0) {
            if (!/\w/.test(tok[0]) || !/\w/.test(t[i - 1] || ' ')) {
              first = first || [i, i + tok.length];
              const e2 = await ENG.validate(t.slice(0, i + tok.length));
              if (e2 && e2.message.includes('near "' + tok + '"')) { r = [i, i + tok.length]; break; }
            }
            i = t.indexOf(tok, i + 1);
          }
          r = r || first;
        }
      } else if (/incomplete input/.test(msg)) r = lastNon(t);
      else if ((m = /no such (?:table|column|index|view|function|trigger): (.+)/.exec(msg))) r = word(m[1].split('.').pop().replace(/^"|"$/g, '')) || word(m[1]);
      else if ((m = /table .+ has no column named (.+)/.exec(msg))) r = word(m[1]);
      else if ((m = /ambiguous column name: (.+)/.exec(msg))) r = word(m[1].split('.').pop());
      else if ((m = /unrecognized token: "?([^"]*)"?/.exec(msg))) { const i = t.indexOf(m[1]); if (i >= 0) r = [i, i + m[1].length]; }
      else if ((m = /(?:table|index|view) (.+) already exists/.exec(msg))) r = word(m[1].replace(/^"|"$/g, ''));
    }
    if (!r) { const lead = t.length - t.trimStart().length, w = /^\w+/.exec(t.slice(lead)); r = [lead, lead + (w ? w[0].length : 1)]; }
    return [s.start + r[0], s.start + r[1]];
  }
  async function runDiag() {
    if (!ENG || !ENG.ready) return;
    const my = ++diagTok, v = ta.value;
    if (v.length > 120000) { diags = []; paintDg(); return; }
    const stms = splitStatements(v).filter(s => blankLit(s.text).trim());
    const hasDDL = stms.some(s => /^\s*(?:create|drop|alter)\b/i.test(blankLit(s.text)));
    const semantic = PGMODE ? /does not exist|already exists/i : /no such (table|column|index|view|trigger)|already exists|has no column named|no such savepoint|cannot (start|commit|rollback)/i;
    const out = [];
    try {
      for (const s of stms.slice(0, PGMODE ? 150 : 400)) {
        const e = await ENG.validate(s.text); if (my !== diagTok) return;
        if (!e || (hasDDL && semantic.test(e.message))) continue;
        const refs = parseTables(s.text), cols = (refs.length ? refs.flatMap(r => r.table.cols) : schema.flatMap(t => t.cols)).map(c => c.n);
        const [from, to] = await locate(e, s); if (my !== diagTok) return;
        out.push({ from, to, msg: viMsg(e.message, cols), raw: e.message });
        if (out.length >= 20) break;
      }
    } catch (err) { return; }
    diags = out; paintDg();
  }
  const schedDiag = () => { clearTimeout(dgTimer); dgTimer = setTimeout(() => idle(runDiag), 350); };

  /* ----- gợi ý như VSCode ----- */
  const score = (label, w) => {
    if (!w) return 5;
    const l = label.toLowerCase(), x = w.toLowerCase();
    if (label.startsWith(w)) return 0; if (l.startsWith(x)) return 1; if (l.includes('_' + x)) return 2; if (l.includes(x)) return 3;
    let i = 0; for (const ch of l) { if (ch === x[i]) i++; if (i === x.length) return 4; }
    return -1;
  };
  const colsOf = (m, tag) => m.cols.map(c => ({ label: c.n, kind: 'col', detail: tag + (c.t ? ' · ' + c.t : '') + (c.pk ? ' · PK' : '') }));
  const tablesList = () => schema.map(m => ({ label: m.name, kind: 'table', detail: m.type === 'view' ? 'view' : m.cols.length + ' cột' }));
  function candidates(v, pos, word) {
    const stm = statementAt(v, pos), wstart = pos - word.length;
    const headB = blankLit(v.slice(stm.start, wstart)), refs = parseTables(stm.text);
    if (v[wstart - 1] === '.') {
      const qm = /("[^"]+"|[A-Za-z_]\w*)\.$/.exec(headB.slice(-80)); if (!qm) return null;
      const qn = qm[1].replace(/"/g, '').toLowerCase();
      const ref = refs.find(r => r.alias && r.alias.toLowerCase() === qn) || refs.find(r => r.table.name.toLowerCase() === qn);
      const tbl = ref ? ref.table : schema.find(m => m.name.toLowerCase() === qn);
      return { items: tbl ? colsOf(tbl, tbl.name) : [], wstart, order: ORDER };
    }
    if (/\b(?:from|join|into|update|table|view)\s*$/i.test(headB)) return { items: tablesList(), wstart, order: ORDER_T };
    const ins = /\binto\s+("[^"]+"|\w+)\s*\([^)]*$/i.exec(headB);
    if (ins) { const tb = schema.find(m => m.name.toLowerCase() === ins[1].replace(/"/g, '').toLowerCase()); if (tb) return { items: colsOf(tb, tb.name), wstart, order: ORDER }; }
    let items = [];
    if (refs.length) refs.forEach(r => { items.push(...colsOf(r.table, r.alias || r.table.name)); items.push({ label: r.alias || r.table.name, kind: 'alias', detail: r.alias ? 'bí danh của ' + r.table.name : 'bảng' }); });
    else schema.forEach(m => items.push(...colsOf(m, m.name)));
    items.push(...tablesList());
    FUNCS.forEach(f => items.push({ label: f, kind: 'fn', detail: 'hàm', ins: f + '(' }));
    KWUP.forEach(k => items.push({ label: k, kind: 'kw', detail: 'từ khóa' }));
    SNIPS.forEach(s => items.push({ label: s.label, kind: 'snip', detail: s.detail, ins: s.ins }));
    return { items, wstart, order: ORDER };
  }
  function closeAc() { ac.open = false; acEl.hidden = true; }
  function suggest(manual, typed) {
    if (!ENG || !ENG.ready || ta.selectionStart !== ta.selectionEnd) return closeAc();
    const v = ta.value, pos = ta.selectionStart;
    const word = (/[A-Za-z_][A-Za-z0-9_]*$/.exec(v.slice(Math.max(0, pos - 60), pos)) || [''])[0];
    if (inLiteral(v, pos)) return closeAc();
    const afterDot = v[pos - word.length - 1] === '.';
    if (!word && !manual && !afterDot) {
      const head = blankLit(v.slice(statementAt(v, pos).start, pos));
      if (!(typed === ' ' && /\b(?:from|join|into|update)\s$/i.test(head))) return closeAc();
    }
    const c = candidates(v, pos, word); if (!c) return closeAc();
    const seen = new Set(), list = [];
    for (const it of c.items) {
      const k = it.kind + '|' + it.label + '|' + it.detail; if (seen.has(k)) continue; seen.add(k);
      const s = score(it.label, word); if (s < 0) continue;
      list.push({ it, r: s * 10 + c.order[it.kind] });
    }
    list.sort((a, b) => a.r - b.r || a.it.label.length - b.it.label.length);
    const items = list.slice(0, 40).map(x => x.it);
    if (!items.length || (items.length === 1 && items[0].label === word)) return closeAc();
    ac.items = items; ac.sel = 0; ac.from = c.wstart; ac.open = true;
    acEl.innerHTML = items.map((it, i) => `<div class="it${i ? '' : ' on'}" data-i="${i}"><span class="k k-${it.kind}">${KINDC[it.kind]}</span><b>${esc(it.label)}</b><em>${esc(it.detail || '')}</em></div>`).join('');
    acEl.hidden = false; acEl.scrollTop = 0;
    const p = caretXY(c.wstart), h = Math.min(items.length, 8) * 24 + 8;
    acEl.style.left = clamp(p.x, 0, Math.max(0, edEl.clientWidth - 280)) + 'px';
    acEl.style.top = (p.y + h > edEl.clientHeight && p.y - LH - h > 0 ? p.y - LH - h : p.y) + 'px';
  }
  function put(text, start, end) {
    suppress = true; ta.focus(); ta.setSelectionRange(start, end);
    let ok = false; try { ok = document.execCommand && document.execCommand('insertText', false, text); } catch (e) {}
    if (!ok) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input')); }
    suppress = false;
  }
  function accept(i) {
    const it = ac.items[i]; if (!it) return;
    let text = it.ins || (it.kind === 'col' || it.kind === 'table' || it.kind === 'alias' ? ident(it.label) : it.label), caret = -1;
    if (it.kind === 'snip') { caret = text.indexOf('$0'); text = text.replace('$0', ''); }
    const from = ac.from, to = ta.selectionStart; closeAc();
    put(text, from, to);
    if (caret >= 0) ta.setSelectionRange(from + caret, from + caret);
    schedPaint(); schedDiag();
  }
  function moveSel(d) {
    ac.sel = (ac.sel + d + ac.items.length) % ac.items.length;
    [...acEl.children].forEach((c, i) => c.classList.toggle('on', i === ac.sel));
    acEl.children[ac.sel].scrollIntoView({ block: 'nearest' });
  }
  acEl.addEventListener('mousedown', e => { e.preventDefault(); const it = e.target.closest('.it'); if (it) accept(+it.dataset.i); });

  /* ----- sự kiện ----- */
  ta.addEventListener('input', e => {
    LS.set(ed.key, ta.value); schedPaint(); schedDiag();
    if (suppress) return;
    if (e.inputType === 'insertText' && e.data && e.data.length === 1) suggest(false, e.data);
    else if (ac.open && e.inputType === 'deleteContentBackward') suggest(false);
    else closeAc();
  });
  ta.addEventListener('scroll', () => { sync(); if (ac.open) closeAc(); });
  ta.addEventListener('mousedown', closeAc);
  ta.addEventListener('blur', () => { closeAc(); tip.hidden = true; });
  ta.addEventListener('focus', () => { lastEd = ed; });
  ta.addEventListener('keydown', e => {
    if (ac.open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(ac.sel); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeAc(); return; }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) closeAc();
    }
    if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); suggest(true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); toggleComment(); return; }
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); put('  ', ta.selectionStart, ta.selectionEnd); }
  });
  function toggleComment() {
    const v = ta.value, s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1; let e = v.indexOf('\n', ta.selectionEnd); if (e < 0) e = v.length;
    const lines = v.slice(s, e).split('\n'), all = lines.every(l => !l.trim() || /^\s*--/.test(l));
    const out = lines.map(l => all ? l.replace(/^(\s*)-- ?/, '$1') : (l.trim() ? l.replace(/^(\s*)/, '$1-- ') : l)).join('\n');
    put(out, s, e); ta.setSelectionRange(s, s + out.length);
  }
  /* tooltip lỗi khi rê chuột */
  let mvRaf = 0;
  ta.addEventListener('mousemove', e => {
    if (!diags.length || mvRaf) return;
    mvRaf = requestAnimationFrame(() => {
      mvRaf = 0;
      const r = ta.getBoundingClientRect(), v = ta.value, st = lineStarts(v);
      const ln = Math.floor((e.clientY - r.top - PADT + ta.scrollTop) / LH);
      if (ln < 0 || ln >= st.length) { tip.hidden = true; return; }
      const col = Math.floor((e.clientX - r.left - 12 + ta.scrollLeft) / charW(edEl)), off = st[ln] + col;
      const d = diags.find(x => off >= x.from && off < Math.max(x.to, x.from + 1));
      if (!d) { tip.hidden = true; return; }
      tip.textContent = d.msg; tip.hidden = false;
      tip.style.left = clamp(e.clientX - r.left - 30, 6, Math.max(6, r.width - 300)) + 'px';
      tip.style.top = (e.clientY - r.top + 18) + 'px';
    });
  });
  ta.addEventListener('mouseleave', () => { tip.hidden = true; });
  prob.addEventListener('click', () => {
    const d = prob._d; if (!d) return;
    const st = lineStarts(ta.value); ta.focus(); ta.setSelectionRange(d.from, Math.max(d.to, d.from + 1));
    ta.scrollTop = Math.max(0, (lineOf(st, d.from) - 3) * LH);
  });

  /* ----- API ----- */
  Object.assign(ed, {
    paint, host,
    load(key, legacy) {
      ed.key = key; let v = LS.get(key, null); if (v === null) v = legacy ? LS.get(legacy, '') : '';
      ta.value = v; ta.scrollTop = ta.scrollLeft = 0; closeAc(); diags = []; paint(); schedDiag();
    },
    sql() { const s = ta.selectionStart, e = ta.selectionEnd; return (e > s ? ta.value.slice(s, e) : ta.value).trim(); },
    insert(t) { put(t, ta.selectionStart, ta.selectionEnd); },
    appendSelect(t) {
      const v = ta.value, gap = v && !v.endsWith('\n') ? '\n\n' : v ? '\n' : '';
      ta.value = v + gap + t; const end = ta.value.length;
      ta.focus(); ta.setSelectionRange(end - t.length, end); ta.scrollTop = ta.scrollHeight;
      LS.set(ed.key, ta.value); paint(); schedDiag();
    },
    set(v) { ta.value = v; LS.set(ed.key, v); paint(); schedDiag(); },
    revalidate: schedDiag,
    getDiags: () => diags, suggest, runDiag
  });
  return ed;
}
