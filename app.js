/* dishwasher — app: state, sequencer callbacks, rack, ceramic knobs, sheets, storage. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const R = Math.random, pick = a => a[R() * a.length | 0], clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NT = 8, LETTERS = 'ABCDEFGH';
const COLORS = ['#e9789f', '#f1c232', '#21a88e', '#eee5d1', '#93dcc8', '#f29a78', '#b7a2e6', '#aab6b8'];
const P = Engine.PARAMS;

/* ================= state ================= */
let st;
const samples = new Array(NT).fill(null);
function freshState() {
  return { tracks: [], patterns: Array.from({ length: 8 }, () => ({ tracks: Array.from({ length: NT }, () => Kit.emptyTrack()) })),
    pat: 0, queued: null, sel: 0, mode: 'on', page: 0, tab: 'corpo', prog: 'eco',
    wear: { on: false, amt: .4, every: 2, sounds: false }, bpm: 124, swing: 0, fx: Object.assign({}, Engine.FX) };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem('dishwasher') || 'null');
    if (s && s.tracks && s.tracks.length === NT) {
      st = Object.assign(freshState(), s);
      st.tracks.forEach(t => t.p = Object.assign(Engine.defaults(), t.p));
      return true;
    }
  } catch (e) {}
  return false;
}
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem('dishwasher', JSON.stringify(Object.assign({}, st, { queued: null }))); } catch (e) {} }, 500);
}
// samples live in IndexedDB
const DB = {
  open() { return this.p || (this.p = new Promise((res, rej) => { const r = indexedDB.open('dishwasher', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async put(k, v) { const db = await this.open(); return new Promise(r => { const tx = db.transaction('s', 'readwrite'); v == null ? tx.objectStore('s').delete(k) : tx.objectStore('s').put(v, k); tx.oncomplete = r; tx.onerror = r; }); },
  async get(k) { const db = await this.open(); return new Promise(r => { const q = db.transaction('s').objectStore('s').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); },
};
async function storeSample(i, buf) {
  try { await DB.put('t' + i, buf ? { sr: buf.sampleRate, d: buf.getChannelData(0).slice() } : null); } catch (e) {}
}
async function restoreSamples() {
  for (let i = 0; i < NT; i++) {
    try { const o = await DB.get('t' + i); if (o && o.d) { const b = new AudioBuffer({ length: o.d.length, numberOfChannels: 1, sampleRate: o.sr }); b.copyToChannel(o.d, 0); samples[i] = b; } } catch (e) {}
  }
}

/* ================= programs ================= */
function applyProgram(key, opts = {}) {
  const pr = Kit.PROGRAMS[key]; st.prog = key;
  if (!opts.keepSounds) pr.roles.forEach((role, i) => {
    const old = st.tracks[i];
    st.tracks[i] = { name: Kit.ROLES[role].n, role, color: COLORS[i], p: Kit.sound(role), mute: false, solo: false, sampleName: old && old.sampleName };
    if (old && samples[i]) Object.assign(st.tracks[i].p, { sLvl: old.p.sLvl, sStart: old.p.sStart, sLen: old.p.sLen, sPitch: old.p.sPitch, sDec: old.p.sDec, sRev: old.p.sRev });
  });
  if (!opts.keepRhythm) st.patterns[st.pat].tracks = st.tracks.map(t => Kit.rhythm(t.role, key));
  if (!opts.keepTempo) {
    st.bpm = Math.round(pr.bpm[0] + R() * (pr.bpm[1] - pr.bpm[0]));
    st.swing = +(pr.swing[0] + R() * (pr.swing[1] - pr.swing[0])).toFixed(2);
    Object.assign(st.fx, pr.fx); Object.assign(Engine.FX, st.fx);
    Engine.setBpm(st.bpm); Engine.S.swing = st.swing; Engine.applyFX(true);
  }
  if (Engine.ctx) for (let i = 0; i < NT; i++) { applyMix(i); renderTrack(i, true); }
  save(); renderAll();
}

/* ================= audio glue ================= */
const renderTok = new Array(NT).fill(0), renderTimers = [];
function renderTrack(i, now) {
  if (!Engine.ctx) return;
  clearTimeout(renderTimers[i]);
  const go = async () => {
    const tok = ++renderTok[i];
    const tr = st.tracks[i], bufs = await Engine.render({ p: tr.p, sample: samples[i] });
    if (tok === renderTok[i]) Engine.channel(i).bufs = bufs;
  };
  if (now) go(); else renderTimers[i] = setTimeout(go, 90);
}
function gateOf(i) { const anySolo = st.tracks.some(t => t.solo); const t = st.tracks[i]; return t.mute || (anySolo && !t.solo) ? 0 : 1; }
function applyMix(i) { if (Engine.ctx) Engine.channel(i).apply(st.tracks[i].p, gateOf(i)); }
function audition(i, vel = .9) { boot(); const c = Engine.channel(i); c.play(Engine.ctx.currentTime + .01, vel, 0, 0); flashPlate(i); }

let booted = false;
function boot() {
  if (booted) { Engine.ctx.resume(); return; }
  booted = true; Engine.init(); Engine.ctx.resume();
  Object.assign(Engine.FX, st.fx); Engine.setBpm(st.bpm); Engine.S.swing = st.swing; Engine.applyFX(true);
  for (let i = 0; i < NT; i++) { applyMix(i); renderTrack(i, true); }
}
const seqCallbacks = {
  pattern: () => st.patterns[st.pat],
  step(i, n, t, sd, s) {
    const tr = st.tracks[i]; if (gateOf(i) === 0) return;
    if (s.p < 1 && R() > s.p) return;
    const ch = Engine.channel(i), g = Engine.val(tr.p, 'choke'), human = Engine.val(tr.p, 'human');
    const rr = s.r || 1;
    for (let k = 0; k < rr; k++) {
      const tt = t + k * sd / rr;
      if (g > 0) st.tracks.forEach((o, j) => { if (j !== i && Engine.val(o.p, 'choke') === g) Engine.channel(j).choke(tt); });
      ch.play(tt, s.v * (k ? .78 : 1), s.t, human);
    }
  },
  bar(n) {
    let changed = false;
    if (st.queued != null) { st.pat = st.queued; st.queued = null; changed = true; uiDirty.pats = uiDirty.rack = true; }
    if (st.wear.on && n > 0 && n % st.wear.every === 0) {
      Kit.wear(st.patterns[st.pat], st.tracks, st.wear.amt); uiDirty.rack = true;
      if (st.wear.sounds && R() < st.wear.amt * .6) {
        const i = R() * NT | 0; st.tracks[i].p = Kit.wilder(st.tracks[i].p, .15 * st.wear.amt); renderTrack(i, true);
        if (i === st.sel) uiDirty.editor = true;
      }
      save();
    }
    return changed;
  },
};
const uiDirty = { rack: false, pats: false, editor: false };

/* ================= transport ================= */
function play() {
  boot();
  if (Engine.S.playing) { Engine.stop(); $('playBtn').classList.remove('on'); clearCursor(); return; }
  Engine.start(seqCallbacks); $('playBtn').classList.add('on');
}
$('playBtn').onclick = play;
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); play(); }
  const n = '12345678'.indexOf(e.key); if (n >= 0) audition(n);
});

/* ================= pattern buttons ================= */
function renderPats() {
  const host = $('pats'); host.innerHTML = '';
  for (let k = 0; k < 8; k++) {
    const b = document.createElement('button'); b.className = 'pat'; b.textContent = LETTERS[k];
    const has = st.patterns[k].tracks.some(t => t.steps.some(s => s.on));
    b.classList.toggle('cur', k === st.pat); b.classList.toggle('queued', k === st.queued); b.classList.toggle('has', has);
    b.setAttribute('aria-label', 'Pattern ' + LETTERS[k]);
    b.onclick = () => {
      if (k === st.pat) return;
      if (Engine.S.playing) { st.queued = k; toast('Pattern ' + LETTERS[k] + ' alla prossima battuta'); }
      else { st.pat = k; renderRack(); }
      renderPats(); save();
    };
    host.appendChild(b);
  }
}

/* ================= rack ================= */
const MODES = [['on', 'Accendi'], ['v', 'Forza'], ['p', 'Probab.'], ['r', 'Ripeti'], ['t', 'Tono']];
function renderModes() {
  const h = $('modes'); h.innerHTML = '';
  MODES.forEach(([k, n]) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = n; b.setAttribute('aria-pressed', st.mode === k);
    b.onclick = () => { st.mode = k; renderModes(); renderRack(); }; h.appendChild(b); });
  const pg = $('pages'); pg.innerHTML = '';
  const maxLen = Math.max(...st.patterns[st.pat].tracks.map(t => t.len));
  for (let k = 0; k < 4; k++) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = (k * 16 + 1) + '–' + (k * 16 + 16);
    b.disabled = maxLen <= k * 16; b.setAttribute('aria-pressed', st.page === k);
    b.onclick = () => { st.page = k; renderModes(); renderRack(); }; pg.appendChild(b); }
  if (st.page > 0 && maxLen <= st.page * 16) { st.page = 0; renderModes(); }
}
let cells = [], plates = [];
function renderRack() {
  const host = $('rack'); host.innerHTML = ''; cells = []; plates = [];
  const pat = st.patterns[st.pat];
  for (let i = 0; i < NT; i++) {
    const tr = st.tracks[i], pt = pat.tracks[i];
    const row = document.createElement('div'); row.className = 'row';
    const pl = document.createElement('button'); pl.className = 'tplate'; pl.style.setProperty('--c', tr.color);
    pl.textContent = tr.name.slice(0, 3).toUpperCase(); pl.dataset.i = i;
    pl.classList.toggle('sel', i === st.sel); pl.classList.toggle('muted', gateOf(i) === 0);
    pl.setAttribute('aria-label', tr.name + (tr.mute ? ' (muto)' : ''));
    row.appendChild(pl); plates.push(pl);
    const steps = document.createElement('div'); steps.className = 'steps'; steps.style.setProperty('--c', tr.color);
    const rowCells = [];
    for (let k = 0; k < 16; k++) {
      const n = st.page * 16 + k, s = pt.steps[n];
      const c = document.createElement('button'); c.className = 'step' + (k % 4 === 0 ? ' beat' : '') + (n >= pt.len ? ' off-len' : '');
      c.dataset.i = i; c.dataset.n = n; c.setAttribute('aria-label', `${tr.name} step ${n + 1}${s.on ? ' acceso' : ''}`);
      c.innerHTML = '<span class="tine"></span>' + stepInner(s);
      steps.appendChild(c); rowCells.push(c);
    }
    cells.push(rowCells); row.appendChild(steps); host.appendChild(row);
  }
  renderModes();
}
function stepInner(s) {
  if (!s.on) return '';
  const h = 40 + s.v * 52, op = .35 + s.p * .65;
  let x = `<span class="dish" style="height:${h}%;opacity:${op}"></span>`;
  if (s.r > 1) x += `<span class="rat">${'<i></i>'.repeat(s.r)}</span>`;
  const m = st.mode;
  if (m === 'v') x += `<span class="val">${Math.round(s.v * 100)}</span>`;
  else if (m === 'p') x += `<span class="val">${Math.round(s.p * 100)}</span>`;
  else if (m === 't' || s.t) x += `<span class="val">${s.t > 0 ? '+' : ''}${s.t || (m === 't' ? '0' : '')}</span>`;
  return x;
}
function updateCell(i, n) {
  const k = n - st.page * 16; if (k < 0 || k > 15) return;
  const c = cells[i][k], s = st.patterns[st.pat].tracks[i].steps[n];
  c.innerHTML = '<span class="tine"></span>' + stepInner(s);
}

// step gestures
let drag = null;
$('rack').addEventListener('pointerdown', ev => {
  const pl = ev.target.closest('.tplate');
  if (pl) {
    const i = +pl.dataset.i; ev.preventDefault();
    const t0 = performance.now();
    const lp = setTimeout(() => { st.tracks[i].mute = !st.tracks[i].mute; applyMix(i); renderRack(); if (i === st.sel) renderEditor(); toast(st.tracks[i].name + (st.tracks[i].mute ? ' muto' : ' attivo')); save(); pl.dataset.lp = 1; }, 480);
    pl.onpointerup = pl.onpointerleave = () => { clearTimeout(lp); if (!pl.dataset.lp && performance.now() - t0 < 480) { selectTrack(i); audition(i); } delete pl.dataset.lp; pl.onpointerup = pl.onpointerleave = null; };
    return;
  }
  const c = ev.target.closest('.step'); if (!c) return;
  ev.preventDefault(); boot();
  const i = +c.dataset.i, n = +c.dataset.n, s = st.patterns[st.pat].tracks[i].steps[n];
  $('rack').setPointerCapture(ev.pointerId);
  drag = { i, n, y: ev.clientY, moved: false, start: { v: s.v, p: s.p, t: s.t } };
  if (st.mode === 'on') { s.on = s.on ? 0 : 1; if (s.on) { s.v = s.v || .8; if (!Engine.S.playing) audition(i, s.v); } drag.paint = s.on; updateCell(i, n); }
  if (st.mode === 'r') { if (!s.on) s.on = 1; else s.r = s.r >= 4 ? 1 : s.r + 1; updateCell(i, n); }
  if (st.selOnStep !== false && i !== st.sel) selectTrack(i, true);
});
$('rack').addEventListener('pointermove', ev => {
  if (!drag) return;
  const pat = st.patterns[st.pat];
  if (st.mode === 'on') {
    const el = document.elementFromPoint(ev.clientX, ev.clientY), c = el && el.closest('.step');
    if (c && +c.dataset.i === drag.i) { const n = +c.dataset.n, s = pat.tracks[drag.i].steps[n]; if (s.on !== drag.paint) { s.on = drag.paint; updateCell(drag.i, n); } }
    return;
  }
  const dy = (drag.y - ev.clientY); if (Math.abs(dy) > 4) drag.moved = true; if (!drag.moved) return;
  const s = pat.tracks[drag.i].steps[drag.n]; s.on = 1;
  if (st.mode === 'v') s.v = clamp(drag.start.v + dy / 120, .05, 1);
  if (st.mode === 'p') s.p = clamp(drag.start.p + dy / 120, .05, 1);
  if (st.mode === 't') s.t = clamp(Math.round(drag.start.t + dy / 10), -24, 24);
  updateCell(drag.i, drag.n);
});
const endDrag = () => {
  if (!drag) return;
  const s = st.patterns[st.pat].tracks[drag.i].steps[drag.n];
  if (!drag.moved) {
    const cyc = (v, list) => { const k = list.findIndex(x => Math.abs(x - v) < .01); return list[(k + 1) % list.length]; };
    if (st.mode === 'v') { if (!s.on) s.on = 1; else s.v = cyc(s.v, [1, .75, .5, .25]); }
    if (st.mode === 'p') { if (!s.on) s.on = 1; else s.p = cyc(s.p, [1, .75, .5, .25]); }
    if (st.mode === 't') { if (!s.on) s.on = 1; else s.t = 0; }
    updateCell(drag.i, drag.n);
  }
  if (st.mode === 't' && drag.moved && !Engine.S.playing) { Engine.channel(drag.i).play(Engine.ctx.currentTime + .01, s.v, s.t, 0); }
  drag = null; renderPats(); save();
};
$('rack').addEventListener('pointerup', endDrag); $('rack').addEventListener('pointercancel', endDrag);

/* cursor */
const cur = new Array(NT).fill(-1);
function clearCursor() { cells.flat().forEach(c => c.classList.remove('now')); cur.fill(-1); }
function flashPlate(i) { const p = plates[i]; if (!p) return; p.classList.add('hit'); clearTimeout(p._t); p._t = setTimeout(() => p.classList.remove('hit'), 90); }

/* ================= ceramic knobs ================= */
document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8fafa"/><stop offset=".45" stop-color="#a9b2b4"/><stop offset=".55" stop-color="#e3e8e8"/><stop offset="1" stop-color="#666f72"/></linearGradient>
  <radialGradient id="shine" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".35" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>
  <pattern id="spk" width="7" height="6" patternUnits="userSpaceOnUse"><circle cx="1.4" cy="1.6" r=".55" fill="#4a3a2c" fill-opacity=".6"/><circle cx="5.1" cy="4.2" r=".4" fill="#4a3a2c" fill-opacity=".45"/></pattern>
</defs></svg>`);
const A0 = 135, SW = 270;
function arcD(a0, a1, r = 29) {
  const p = a => [32 + r * Math.cos(a * Math.PI / 180), 32 + r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
// opts: label, get(), set(v), fmt(v), def, steps (n options), color, dim
function knob(o) {
  const w = document.createElement('div'); w.className = 'knob' + (o.dim ? ' dim' : '');
  w.style.setProperty('--c', o.color || st.tracks[st.sel].color);
  w.setAttribute('role', 'slider'); w.tabIndex = 0; w.setAttribute('aria-label', o.label);
  w.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="${arcD(A0, A0 + SW)}" fill="none" stroke="rgba(30,25,15,.28)" stroke-width="4" stroke-linecap="round"/>
    <path class="arc" fill="none" stroke="#46ff6e" stroke-width="4" stroke-linecap="round"/>
    <circle cx="32" cy="32" r="23.5" fill="url(#chrome)"/>
    <circle cx="32" cy="32" r="21.5" style="fill:var(--c)"/>
    <circle cx="32" cy="32" r="21.5" fill="url(#spk)"/>
    <circle cx="32" cy="32" r="13" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="2.2"/>
    <circle cx="32" cy="32" r="21.5" fill="url(#shine)"/>
    <g class="ptr"><line x1="32" y1="12.5" x2="32" y2="20.5" stroke="#1d1a14" stroke-width="3.2" stroke-linecap="round"/></g>
  </svg><span class="kl">${o.label}</span><span class="kv"></span>`;
  const arc = w.querySelector('.arc'), ptr = w.querySelector('.ptr'), kv = w.querySelector('.kv');
  const q = v => o.steps ? Math.round(v * (o.steps - 1)) / (o.steps - 1) : v;
  const draw = () => {
    const v = q(o.get()), a = A0 + SW * v;
    arc.setAttribute('d', v > .003 ? arcD(A0, a) : ''); ptr.setAttribute('transform', `rotate(${a + 90} 32 32)`);
    kv.textContent = o.fmt(v); w.setAttribute('aria-valuetext', o.fmt(v)); w.setAttribute('aria-valuenow', Math.round(v * 100));
  };
  const set = v => { v = q(clamp(v, 0, 1)); if (v === q(o.get())) return; o.set(v); draw(); };
  let y0 = 0, x0 = 0, v0 = 0, lastTap = 0, moved = false;
  w.addEventListener('pointerdown', e => {
    e.preventDefault(); w.setPointerCapture(e.pointerId); w.classList.add('drag'); y0 = e.clientY; x0 = e.clientX; v0 = o.get(); moved = false;
    const now = performance.now(); if (now - lastTap < 280 && o.def != null) { set(o.def); lastTap = 0; } else lastTap = now;
  });
  w.addEventListener('pointermove', e => {
    if (!w.hasPointerCapture(e.pointerId)) return;
    const dist = (y0 - e.clientY) + (e.clientX - x0) * .6;
    const d = o.steps ? dist / (clamp(160 / (o.steps - 1), 5, 28) * (o.steps - 1)) : dist / 180;
    if (Math.abs(y0 - e.clientY) + Math.abs(e.clientX - x0) > 3) moved = true;
    set(v0 + d);
  });
  const up = () => { w.classList.remove('drag'); if (o.steps && !moved && o.steps <= 8 && performance.now() - lastTap < 250) { /* tap cycles a switch */ const n = o.steps - 1; set(((Math.round(o.get() * n) + 1) % o.steps) / n); } if (o.done) o.done(); };
  w.addEventListener('pointerup', up); w.addEventListener('pointercancel', () => w.classList.remove('drag'));
  w.addEventListener('keydown', e => {
    const s = o.steps ? 1 / (o.steps - 1) : (e.shiftKey ? .1 : .02);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(o.get() + s); e.preventDefault(); if (o.done) o.done(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(o.get() - s); e.preventDefault(); if (o.done) o.done(); }
  });
  draw(); w.redraw = draw;
  return w;
}
function paramKnob(i, k) {
  const d = P[k], tr = st.tracks[i];
  return knob({ label: d.l, def: d.d, steps: d.sel ? d.sel.length : 0, color: tr.color,
    get: () => tr.p[k], fmt: v => Engine.display(k, v),
    set: v => { tr.p[k] = v; if (d.live) applyMix(i); else renderTrack(i); if (k.endsWith('Lvl')) renderTabs(); },
    done: () => { save(); if (!d.live && !Engine.S.playing) setTimeout(() => audition(i, .85), 130); } });
}

/* ================= editor ================= */
const TABS = [['corpo', 'Corpo', 'tLvl'], ['rumore', 'Rumore', 'nLvl'], ['metallo', 'Metallo', 'mLvl'], ['ceramica', 'Ceramica', 'rLvl'],
  ['campione', 'Campione', 'sLvl'], ['colore', 'Colore'], ['mix', 'Mix'], ['ritmo', 'Ritmo']];
function selectTrack(i, quiet) { st.sel = i; plates.forEach((p, k) => p.classList.toggle('sel', k === i)); renderEditor(); if (!quiet) save(); }
function renderTabs() {
  const h = $('tabs'), tr = st.tracks[st.sel], sl = h.scrollLeft; h.innerHTML = '';
  TABS.forEach(([k, n, lv]) => {
    const b = document.createElement('button'); b.className = 'tab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', st.tab === k);
    const on = lv ? (tr.p[lv] > .01 && (k !== 'campione' || samples[st.sel])) : false;
    b.innerHTML = (lv ? `<i class="${on ? 'on' : ''}"></i>` : '') + n;
    b.onclick = () => { st.tab = k; renderTabs(); renderBody(); save(); };
    h.appendChild(b);
  });
  h.scrollLeft = sl;
  const cur = h.querySelector('[aria-selected="true"]');
  if (cur && (cur.offsetLeft < h.scrollLeft || cur.offsetLeft + cur.offsetWidth > h.scrollLeft + h.clientWidth)) h.scrollLeft = cur.offsetLeft - 8;
}
function renderEditor() {
  const i = st.sel, tr = st.tracks[i];
  $('editor').style.setProperty('--c', tr.color);
  $('edPlate').style.setProperty('--c', tr.color);
  $('edName').value = tr.name;
  const role = $('edRole');
  role.innerHTML = '<select id="roleSel" aria-label="Ricetta">' + Kit.ROLE_KEYS.map(k => `<option value="${k}" ${k === tr.role ? 'selected' : ''}>ricetta: ${Kit.ROLES[k].n}</option>`).join('') + '</select>';
  $('roleSel').onchange = e => { tr.role = e.target.value; lava(i, true); };
  $('muteBtn').setAttribute('aria-pressed', !!tr.mute); $('soloBtn').setAttribute('aria-pressed', !!tr.solo);
  renderTabs(); renderBody();
}
$('edName').oninput = e => { st.tracks[st.sel].name = e.target.value || '—'; plates[st.sel].textContent = st.tracks[st.sel].name.slice(0, 3).toUpperCase(); save(); };
$('edPlate').onclick = () => audition(st.sel);
$('muteBtn').onclick = () => { const t = st.tracks[st.sel]; t.mute = !t.mute; for (let k = 0; k < NT; k++) applyMix(k); renderRack(); renderEditor(); save(); };
$('soloBtn').onclick = () => { const t = st.tracks[st.sel]; t.solo = !t.solo; for (let k = 0; k < NT; k++) applyMix(k); renderRack(); renderEditor(); save(); };
function lava(i, rename) {
  const tr = st.tracks[i], keep = { vol: tr.p.vol, pan: tr.p.pan, choke: tr.p.choke, cut: tr.p.cut };
  const sm = samples[i] ? { sLvl: tr.p.sLvl, sStart: tr.p.sStart, sLen: tr.p.sLen, sPitch: tr.p.sPitch, sDec: tr.p.sDec, sRev: tr.p.sRev } : {};
  tr.p = Object.assign(Kit.sound(tr.role), keep, sm);
  if (rename) tr.name = Kit.ROLES[tr.role].n;
  applyMix(i); renderTrack(i, true); renderEditor(); renderRack(); save();
  setTimeout(() => audition(i), 160);
}
$('lavaBtn').onclick = () => { boot(); lava(st.sel); toast('Lavato: nuovo ' + st.tracks[st.sel].name.toLowerCase()); };

function grid(keys) { const g = document.createElement('div'); g.className = 'kgrid'; keys.forEach(k => g.appendChild(paramKnob(st.sel, k))); return g; }
function btnEl(txt, on, cls) { const b = document.createElement('button'); b.className = 'enamel sm' + (cls ? ' ' + cls : ''); b.textContent = txt; b.onclick = on; return b; }
function noteEl(t) { const p = document.createElement('p'); p.className = 'note'; p.textContent = t; return p; }
function renderBody() {
  const body = $('edBody'); body.innerHTML = ''; const i = st.sel, tr = st.tracks[i];
  const keys = g => Object.keys(P).filter(k => P[k].g === g);
  switch (st.tab) {
    case 'corpo': body.append(grid(keys('corpo')), noteEl('Il corpo è un oscillatore che cade di intonazione: cassa, tom, zap.')); break;
    case 'rumore': body.append(grid(keys('rumore')), noteEl('Rumore filtrato. Più colpi ravvicinati fanno un clap.')); break;
    case 'metallo': body.append(grid(keys('metallo')), noteEl('Banco di oscillatori metallici: hi‑hat, piatti, campanacci.')); break;
    case 'ceramica': body.append(grid(keys('ceramica')), noteEl('Risuonatori che vibrano come stoviglie: piatti, tazze, vetro, pentole.')); break;
    case 'campione': renderSampleTab(body); break;
    case 'colore': body.append(grid(keys('colore')), noteEl('Variazione rende ogni colpo leggermente diverso. Umano sposta i colpi nel tempo.')); break;
    case 'mix': body.append(grid(keys('mix')), noteEl('Vasca ed Eco mandano il suono al riverbero e al delay. Choke: i suoni dello stesso gruppo si zittiscono a vicenda.')); break;
    case 'ritmo': renderRhythmTab(body); break;
  }
}

/* sample tab: record / load */
let recState = null;
function renderSampleTab(body) {
  const i = st.sel, tr = st.tracks[i];
  const cv = document.createElement('canvas'); cv.className = 'wave'; body.appendChild(cv);
  const meter = document.createElement('div'); meter.className = 'meter'; meter.innerHTML = '<i></i>'; meter.hidden = !recState; body.appendChild(meter);
  const b = document.createElement('div'); b.className = 'btns'; body.appendChild(b);
  const rec = btnEl(recState ? '■ Stop' : '● Registra', async () => {
    boot();
    if (recState) {
      const target = recState.i; recState = null;
      try { const buf = await Engine.recStop(); setSample(target, buf, 'Microfono'); toast('Registrato: ' + buf.duration.toFixed(2) + ' s'); }
      catch (e) { toast('Registrazione non riuscita'); }
      renderBody(); return;
    }
    try { await Engine.recStart(); recState = { i, t0: performance.now() }; renderBody(); }
    catch (e) { toast(location.protocol === 'https:' ? 'Microfono non consentito: abilitalo nelle impostazioni del browser.' : 'Il microfono funziona solo da https.'); }
  }, recState ? 'slime' : '');
  b.appendChild(rec);
  const lab = document.createElement('label'); lab.className = 'enamel sm'; lab.textContent = 'Carica file'; lab.style.position = 'relative'; lab.style.overflow = 'hidden';
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.style.cssText = 'position:absolute;inset:0;opacity:0';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { const buf = await Engine.decodeFile(f); setSample(i, buf, f.name.replace(/\.[^.]+$/, '').slice(0, 20)); toast('Caricato: ' + f.name); } catch (e) { toast('Formato audio non supportato'); } };
  lab.appendChild(inp); b.appendChild(lab);
  if (samples[i]) b.appendChild(btnEl('Togli', () => { setSample(i, null); }));
  body.appendChild(grid(Object.keys(P).filter(k => P[k].g === 'campione')));
  body.appendChild(noteEl(samples[i] ? `Campione: ${tr.sampleName || 'senza nome'} · ${samples[i].duration.toFixed(2)} s. Si mescola con gli altri strati: alza o abbassa i loro livelli.` :
    'Registra un suono col microfono (pentole, bicchieri, la tua voce) o carica un file audio. Il silenzio iniziale viene tagliato da solo.'));
  drawWave(cv, i);
}
function setSample(i, buf, name) {
  samples[i] = buf; const tr = st.tracks[i]; tr.sampleName = buf ? name : null;
  if (buf) { tr.p.sLvl = 1; tr.p.sStart = 0; tr.p.sLen = 1; tr.p.sDec = 1; tr.p.tLvl *= .3; tr.p.nLvl *= .3; tr.p.mLvl *= .3; tr.p.rLvl *= .3; tr.p.vari = Math.min(tr.p.vari, .15); }
  else tr.p.sLvl = 0;
  storeSample(i, buf); renderTrack(i, true); save();
  if (st.sel === i) { renderEditor(); setTimeout(() => audition(i), 200); }
}
function drawWave(cv, i) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth || 300, h = cv.clientHeight || 70;
  cv.width = w * dpr; cv.height = h * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
  c.clearRect(0, 0, w, h);
  const b = samples[i];
  if (recState && recState.i === i) { c.fillStyle = '#e3ff48'; c.font = '14px "Share Tech Mono",monospace'; c.fillText('REC ' + ((performance.now() - recState.t0) / 1000).toFixed(1) + ' s', 10, 24); return; }
  if (!b) { c.fillStyle = 'rgba(227,255,72,.35)'; c.font = '13px "Share Tech Mono",monospace'; c.fillText('nessun campione', 10, h / 2 + 4); return; }
  const d = b.getChannelData(0), p = st.tracks[i].p;
  const s0 = p.sStart * w, s1 = s0 + p.sLen * (w - s0);
  c.fillStyle = 'rgba(70,255,110,.12)'; c.fillRect(s0, 0, s1 - s0, h);
  c.strokeStyle = '#e3ff48'; c.beginPath();
  for (let x = 0; x < w; x++) { const a = Math.floor(x / w * d.length), e = Math.floor((x + 1) / w * d.length); let m = 0; for (let k = a; k < e; k++) m = Math.max(m, Math.abs(d[k])); c.moveTo(x + .5, h / 2 - m * h * .45); c.lineTo(x + .5, h / 2 + m * h * .45); }
  c.stroke(); c.fillStyle = '#46ff6e'; c.fillRect(s0, 0, 2, h);
}

/* rhythm tab */
const euc = { k: 4, rot: 0 };
function renderRhythmTab(body) {
  const i = st.sel, pt = () => st.patterns[st.pat].tracks[i], tr = st.tracks[i];
  const g = document.createElement('div'); g.className = 'kgrid'; body.appendChild(g);
  g.appendChild(knob({ label: 'Lunghezza', steps: 64, color: tr.color, get: () => (pt().len - 1) / 63, fmt: v => Math.round(v * 63 + 1) + ' step',
    set: v => { pt().len = Math.round(v * 63 + 1); renderRack(); }, done: save, def: 15 / 63 }));
  g.appendChild(knob({ label: 'Velocità', steps: Engine.RATES.length, color: tr.color, get: () => pt().rate / (Engine.RATES.length - 1), fmt: v => Engine.RATES[Math.round(v * (Engine.RATES.length - 1))][0],
    set: v => { pt().rate = Math.round(v * (Engine.RATES.length - 1)); }, done: save, def: 3 / 5 }));
  g.appendChild(knob({ label: 'Colpi', steps: 33, color: tr.color, get: () => euc.k / 32, fmt: v => Math.round(v * 32) + '', set: v => { euc.k = Math.round(v * 32); } }));
  g.appendChild(knob({ label: 'Rotazione', steps: 32, color: tr.color, get: () => euc.rot / 31, fmt: v => Math.round(v * 31) + '', set: v => { euc.rot = Math.round(v * 31); } }));
  const b = document.createElement('div'); b.className = 'btns'; body.appendChild(b);
  const apply = fn => { fn(pt()); renderRack(); renderPats(); save(); };
  b.append(
    btnEl('Euclideo', () => apply(t => { const e = Kit.euclid(Math.min(euc.k, t.len), t.len, euc.rot); t.steps.forEach((s, n) => { if (n < t.len) { s.on = e[n]; if (s.on) { s.v = s.v || .8; } } }); })),
    btnEl('Genera', () => { const t = Kit.rhythm(tr.role, st.prog); st.patterns[st.pat].tracks[i] = t; renderRack(); renderPats(); renderBody(); save(); }, 'slime'),
    btnEl('Casuale', () => apply(t => t.steps.forEach((s, n) => { if (n < t.len) { s.on = R() < .3 ? 1 : 0; s.v = .4 + R() * .6; s.p = R() < .2 ? .5 + R() * .5 : 1; s.r = R() < .08 ? pick([2, 3, 4]) : 1; } }))),
    btnEl('← Sposta', () => apply(t => { const a = t.steps.slice(0, t.len); a.push(a.shift()); a.forEach((s, n) => t.steps[n] = s); })),
    btnEl('Sposta →', () => apply(t => { const a = t.steps.slice(0, t.len); a.unshift(a.pop()); a.forEach((s, n) => t.steps[n] = s); })),
    btnEl('Umanizza', () => apply(t => t.steps.forEach(s => { if (s.on) s.v = clamp(s.v + (R() - .5) * .35, .2, 1); }))),
    btnEl('Svuota', () => apply(t => t.steps.forEach(s => Object.assign(s, Kit.blank())))),
  );
  body.appendChild(noteEl('Ogni traccia può avere lunghezza e velocità diverse: le battute si sfasano e si ricompongono (poliritmi). Euclideo distribuisce i colpi nel modo più uniforme possibile.'));
}

/* ================= sheets ================= */
function openSheet(title, build) { $('sheetTitle').textContent = title; const b = $('sheetBody'); b.innerHTML = ''; build(b); $('sheet').hidden = false; }
function closeSheet() { $('sheet').hidden = true; }
$('sheetClose').onclick = closeSheet;
$('sheet').addEventListener('pointerdown', e => { if (e.target === $('sheet')) closeSheet(); });
function secEl(t) { const s = document.createElement('div'); s.className = 'sec'; s.textContent = t; return s; }
function fxKnob(label, key, fmt, steps, rebuild) {
  return knob({ label, steps, color: '#eee5d1', def: Engine.FX[key], get: () => st.fx[key], fmt,
    set: v => { st.fx[key] = v; Engine.FX[key] = v; Engine.applyFX(!!rebuild); }, done: save });
}
const pc = v => Math.round(v * 100) + '%';

$('progBtn').onclick = () => openSheet('Programmi di lavaggio', body => {
  body.appendChild(secEl('Scegli un ciclo'));
  const g = document.createElement('div'); g.className = 'progs'; body.appendChild(g);
  Object.entries(Kit.PROGRAMS).forEach(([k, p], idx) => {
    const b = document.createElement('button'); b.className = 'prog' + (k === st.prog ? ' cur' : ''); b.style.setProperty('--a', (20 + idx * 12) + '%');
    b.innerHTML = `<span class="dial"></span><b>${p.n}</b><small>${p.d} · ${p.bpm[0]}–${p.bpm[1]} bpm</small>`;
    b.onclick = () => { boot(); applyProgram(k); closeSheet(); toast('Ciclo ' + p.n + ': nuovo kit e nuovo ritmo nel pattern ' + LETTERS[st.pat]); };
    g.appendChild(b);
  });
  const bt = document.createElement('div'); bt.className = 'btns'; body.appendChild(bt);
  bt.append(
    btnEl('Lava tutti i suoni', () => { boot(); applyProgram(st.prog, { keepRhythm: true, keepTempo: true }); toast('Kit rinnovato'); }, 'slime'),
    btnEl('Nuovo ritmo', () => { boot(); applyProgram(st.prog, { keepSounds: true, keepTempo: true }); toast('Ritmo rigenerato'); }),
    btnEl('Svuota pattern', () => { st.patterns[st.pat].tracks = st.tracks.map(() => Kit.emptyTrack()); renderAll(); save(); }),
  );
  body.appendChild(secEl('Copia il pattern ' + LETTERS[st.pat] + ' in…'));
  const cp = document.createElement('div'); cp.className = 'btns'; body.appendChild(cp);
  for (let k = 0; k < 8; k++) if (k !== st.pat) cp.appendChild(btnEl(LETTERS[k], () => { st.patterns[k] = JSON.parse(JSON.stringify(st.patterns[st.pat])); renderPats(); save(); toast('Copiato in ' + LETTERS[k]); }));
  body.appendChild(secEl('Usura generativa'));
  const kg = document.createElement('div'); kg.className = 'kgrid'; body.appendChild(kg);
  kg.append(
    knob({ label: 'Attiva', steps: 2, color: '#93dcc8', get: () => st.wear.on ? 1 : 0, fmt: v => v ? 'sì' : 'no', set: v => { st.wear.on = !!v; renderWear(); }, done: save }),
    knob({ label: 'Intensità', color: '#93dcc8', def: .4, get: () => st.wear.amt, fmt: pc, set: v => { st.wear.amt = v; }, done: save }),
    knob({ label: 'Ogni', steps: 4, color: '#93dcc8', get: () => [1, 2, 4, 8].indexOf(st.wear.every) / 3, fmt: v => [1, 2, 4, 8][Math.round(v * 3)] + ' batt.', set: v => { st.wear.every = [1, 2, 4, 8][Math.round(v * 3)]; }, done: save }),
    knob({ label: 'Suoni', steps: 2, color: '#93dcc8', get: () => st.wear.sounds ? 1 : 0, fmt: v => v ? 'consuma' : 'fermi', set: v => { st.wear.sounds = !!v; }, done: save }),
  );
  body.appendChild(noteEl('Con l’usura attiva il ritmo cambia un poco ogni poche battute: colpi che appaiono e spariscono, ripetizioni, accenti. Con “Suoni” anche i timbri si consumano lentamente.'));
});
function renderWear() { $('wearBtn').setAttribute('aria-pressed', !!st.wear.on); }
$('wearBtn').onclick = () => { st.wear.on = !st.wear.on; renderWear(); save(); toast(st.wear.on ? 'Usura attiva: il ritmo evolverà da solo' : 'Usura spenta'); };

$('tubBtn').onclick = () => openSheet('Vasca ed effetti', body => {
  body.appendChild(secEl('Vasca · riverbero'));
  const a = document.createElement('div'); a.className = 'kgrid'; body.appendChild(a);
  a.append(fxKnob('Dimensione', 'size', v => (.25 + v * v * 7.5).toFixed(1) + ' s', 0, true), fxKnob('Smorzam.', 'damp', pc, 0, true),
    fxKnob('Pre‑delay', 'pre', v => Math.round(v * 150) + ' ms'), fxKnob('Metallo', 'tub', pc, 0, true), fxKnob('Livello', 'revLvl', pc));
  body.appendChild(secEl('Eco · delay'));
  const b = document.createElement('div'); b.className = 'kgrid'; body.appendChild(b);
  const nd = Engine.DIVS.length;
  b.append(
    knob({ label: 'Tempo', steps: nd, color: '#eee5d1', get: () => st.fx.dDiv / (nd - 1), fmt: v => Engine.DIVS[Math.round(v * (nd - 1))][0], set: v => { st.fx.dDiv = Engine.FX.dDiv = Math.round(v * (nd - 1)); Engine.applyFX(); }, done: save }),
    fxKnob('Ripetiz.', 'dFb', pc), fxKnob('Tono', 'dTone', pc), fxKnob('Nastro', 'dWow', pc),
    knob({ label: 'Ping‑pong', steps: 2, color: '#eee5d1', get: () => st.fx.dPing ? 1 : 0, fmt: v => v ? 'sì' : 'no', set: v => { st.fx.dPing = Engine.FX.dPing = v ? 1 : 0; Engine.applyFX(); }, done: save }),
    fxKnob('Livello', 'delLvl', pc));
  body.appendChild(secEl('Uscita'));
  const c = document.createElement('div'); c.className = 'kgrid'; body.appendChild(c);
  c.append(fxKnob('Pressione', 'press', pc), fxKnob('Saturaz.', 'sat', pc),
    fxKnob('Filtro DJ', 'dj', v => v < .48 ? 'LP ' + Math.round((.48 - v) / .48 * 100) : v > .52 ? 'HP ' + Math.round((v - .52) / .48 * 100) : 'aperto'), fxKnob('Volume', 'master', pc));
  body.appendChild(noteEl('Ogni suono manda quanto vuole alla vasca e all’eco dalla scheda Mix della traccia. Doppio tocco su una manopola la riporta al valore iniziale.'));
});

$('lcd').onclick = () => openSheet('Tempo', body => {
  const f = document.createElement('label'); f.className = 'field'; f.innerHTML = 'BPM esatti<input id="bpmIn" type="number" inputmode="decimal" min="30" max="300" step="0.01">'; body.appendChild(f);
  const inp = f.querySelector('input'); inp.value = st.bpm.toFixed(2);
  const setB = b => { st.bpm = +clamp(b, 30, 300).toFixed(2); Engine.setBpm(st.bpm); inp.value = st.bpm.toFixed(2); renderLcd(); save(); };
  inp.onchange = () => setB(parseFloat(inp.value.replace(',', '.')) || st.bpm);
  const b = document.createElement('div'); b.className = 'btns'; body.appendChild(b);
  [-1, -.1, -.01, .01, .1, 1].forEach(d => b.appendChild(btnEl((d > 0 ? '+' : '−') + Math.abs(d), () => setB(st.bpm + d))));
  b.appendChild(btnEl('Tap', tap, 'slime'));
  const g = document.createElement('div'); g.className = 'kgrid'; body.appendChild(g);
  g.appendChild(knob({ label: 'Swing', color: '#f1c232', def: 0, get: () => st.swing, fmt: v => Math.round(50 + v * 25) + '%', set: v => { st.swing = v; Engine.S.swing = v; }, done: save }));
  g.appendChild(knob({ label: 'Grosso', color: '#f1c232', get: () => (st.bpm - 30) / 270, fmt: () => st.bpm.toFixed(2), set: v => setB(Math.round(30 + v * 270)) }));
  body.appendChild(noteEl('Il tempo è calcolato sull’orologio audio: i BPM sono esatti fino al centesimo.'));
});
let taps = [];
function tap() {
  const now = performance.now(); taps = taps.filter(t => now - t < 2500); taps.push(now);
  if (taps.length >= 3) { const iv = []; for (let k = 1; k < taps.length; k++) iv.push(taps[k] - taps[k - 1]);
    st.bpm = +(60000 / (iv.reduce((a, b) => a + b) / iv.length)).toFixed(2); Engine.setBpm(st.bpm); renderLcd(); save();
    const inp = $('bpmIn'); if (inp) inp.value = st.bpm.toFixed(2); }
}
$('tapBtn').onclick = () => { tap(); toast(taps.length >= 3 ? st.bpm.toFixed(2) + ' bpm' : 'Tocca a tempo… (' + taps.length + '/3)', 1200); };

/* mix recording */
$('recBtn').onclick = async () => {
  boot();
  if (Engine.recording) {
    const r = await Engine.mixStop(); $('recBtn').setAttribute('aria-pressed', 'false'); if (!r) return;
    const url = URL.createObjectURL(r.blob), name = 'dishwasher-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.' + r.ext;
    openSheet('Registrazione', body => {
      const au = document.createElement('audio'); au.controls = true; au.src = url; body.appendChild(au);
      body.appendChild(noteEl(r.secs.toFixed(1) + ' s · ' + (r.blob.size / 1048576).toFixed(1) + ' MB · ' + r.ext.toUpperCase()));
      const b = document.createElement('div'); b.className = 'btns'; body.appendChild(b);
      b.appendChild(btnEl('Condividi / Salva', async () => {
        const file = new File([r.blob], name, { type: r.blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'dishwasher' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      }, 'slime'));
      const a = document.createElement('a'); a.className = 'enamel sm'; a.href = url; a.download = name; a.textContent = 'Scarica file'; b.appendChild(a);
    });
    return;
  }
  if (!Engine.mixStart()) { toast('Questo browser non può registrare l’uscita audio'); return; }
  $('recBtn').setAttribute('aria-pressed', 'true'); toast('Registrazione del mix avviata');
  if (!Engine.S.playing) play();
};

/* ================= LCD + animation loop ================= */
function renderLcd() {
  $('lcdBpm').textContent = st.bpm.toFixed(2);
  $('lcdProg').textContent = (Kit.PROGRAMS[st.prog] ? Kit.PROGRAMS[st.prog].n : '').toUpperCase() + ' · ' + LETTERS[st.pat];
}
const bars = [...document.querySelectorAll('#lcdBars i')];
let beatT0 = 0;
function frame() {
  requestAnimationFrame(frame);
  if (Engine.ctx) {
    const now = Engine.ctx.currentTime, ev = Engine.events;
    let k = 0;
    while (k < ev.length && ev[k].t <= now) {
      const e = ev[k++];
      if (e.i >= NT) continue;
      if (cur[e.i] !== e.n) {
        const pk = cur[e.i] - st.page * 16; if (pk >= 0 && pk < 16 && cells[e.i]) cells[e.i][pk].classList.remove('now');
        cur[e.i] = e.n; const nk = e.n - st.page * 16; if (nk >= 0 && nk < 16 && cells[e.i]) cells[e.i][nk].classList.add('now');
      }
      if (e.on) flashPlate(e.i);
      if (e.i === 0 && e.n % 4 === 0) beatT0 = e.t;
    }
    if (k) ev.splice(0, k);
    if (ev.length > 4000) ev.splice(0, ev.length - 1000);
    const lv = Engine.masterLevel(); bars.forEach((b, j) => b.classList.toggle('on', lv > (j + 1) / 7));
    if (Engine.S.playing && cur[0] >= 0) { const n = cur[0]; $('lcdPos').textContent = ((n / 16 | 0) + 1) + '.' + ((n % 16 / 4 | 0) + 1) + '.' + (n % 4 + 1); }
    if (Engine.recording) $('lcdPos').textContent = 'REC ' + ((performance.now() - Engine.mixT0) / 1000).toFixed(0) + 's';
  }
  if (uiDirty.rack) { uiDirty.rack = false; renderRack(); clearCursor(); }
  if (uiDirty.pats) { uiDirty.pats = false; renderPats(); renderLcd(); }
  if (uiDirty.editor) { uiDirty.editor = false; if (!document.querySelector('.knob.drag')) renderBody(); }
  if (recState) {
    const m = document.querySelector('.meter i'); if (m) m.style.width = Math.min(100, Engine.micLevel() * 140) + '%';
    const cv = document.querySelector('.wave'); if (cv && performance.now() % 200 < 20) drawWave(cv, st.sel);
    if (performance.now() - recState.t0 > 8000) { const b = [...document.querySelectorAll('#edBody .enamel')].find(x => x.textContent.includes('Stop')); if (b) b.click(); }
  }
}
function renderAll() { renderPats(); renderRack(); renderEditor(); renderLcd(); renderWear(); }

/* ================= boot ================= */
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
(async () => {
  if (!load()) {
    st = freshState();
    const pr = Kit.PROGRAMS.eco;
    st.tracks = pr.roles.map((role, i) => ({ name: Kit.ROLES[role].n, role, color: COLORS[i], p: Kit.sound(role), mute: false, solo: false }));
    st.patterns[0].tracks = st.tracks.map(t => Kit.rhythm(t.role, 'eco'));
    st.bpm = 124; st.swing = .06; Object.assign(st.fx, pr.fx);
  }
  Object.assign(Engine.FX, st.fx); Engine.S.bpm = st.bpm; Engine.S.swing = st.swing;
  renderAll();
  requestAnimationFrame(frame);
  await restoreSamples();
  // first touch anywhere starts audio (mobile policy)
  const unlock = () => { boot(); window.removeEventListener('pointerdown', unlock, true); };
  window.addEventListener('pointerdown', unlock, true);
})();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Engine.ctx) Engine.ctx.resume(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
