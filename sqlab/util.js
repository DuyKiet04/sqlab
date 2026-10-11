'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const q = n => '"' + String(n).replace(/"/g, '""') + '"';
const RESERVED = new Set('select from where order group by table user limit offset all and or not null default primary references check unique column constraint end case when then else join left right on as in is like desc asc union having distinct into values set update delete insert create drop alter index view trigger'.split(' '));
const ident = n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !(typeof PGMODE !== 'undefined' && PGMODE && /[A-Z]/.test(n)) && !RESERVED.has(n.toLowerCase()) ? n : q(n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const idb = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('sqlab', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => { p = null; rej(r.error); };
  }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('kv', mode), r = fn(t.objectStore('kv'));
      t.oncomplete = () => res(r && r.result); t.onerror = t.onabort = () => rej(t.error);
    });
  };
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
})();

const ICONS = {
  table: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M6.5 6.5V13"/>',
  col: '<rect x="5" y="2.5" width="6" height="11" rx="1.3"/>',
  play: '<path d="M5 3.5v9l7-4.5z" fill="currentColor"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5"/>',
  insert: '<path d="M3 8h7M7.5 4.5L11 8l-3.5 3.5M13.5 3v10"/>',
  chev: '<path d="M6 4l4 4-4 4"/>',
  history: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  edit: '<path d="M3 13l.6-2.6 7-7a1.4 1.4 0 0 1 2 2l-7 7z"/>',
  trash: '<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"/>',
  save: '<path d="M3 3h8l2 2v8H3z"/><path d="M5.5 3v3h4V3M5.5 13V9h5v4"/>',
  side: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M6.5 3v10"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  db: '<ellipse cx="8" cy="4.5" rx="5" ry="2"/><path d="M3 4.5v7c0 1.1 2.2 2 5 2s5-.9 5-2v-7M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
  warn: '<path d="M8 2.5l6 10.5H2zM8 7v3M8 11.6v.1"/>',
  cloud: '<path d="M4.5 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.6 1 2.5 2.5 0 0 1-.3 5z"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>'
};
const ic = n => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${ICONS[n] || ''}</svg>`;

function toast(msg, cls) {
  const box = $('#toasts'); if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (cls || ''); t.textContent = msg; box.appendChild(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, cls === 'bad' ? 4500 : 2000);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
  try {
    const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return !!ok;
  } catch (e) { return false; }
}
function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const c = [i];
    for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[n];
}
function nearest(s, list) {
  s = String(s || '').toLowerCase(); if (s.length < 2) return null;
  let best = null, bd = s.length <= 3 ? 1 : 2;
  for (const x of list) { const l = x.toLowerCase(); if (l === s) return null; const d = lev(s, l); if (d <= bd && (best === null || d < bd)) { best = x; bd = d; } }
  return best;
}
const idle = window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 900 }) : f => setTimeout(f, 0);
