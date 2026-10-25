/* Dishwasher — percussion engine.
   Every track's sound is rendered offline from 5 layers (body, noise, metal, ceramic resonator, sample)
   into a few round-robin buffers, then played sample-accurately through a live channel strip. */
'use strict';
const Engine = (() => {
const R = Math.random, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SR = 44100;

/* ================= parameter table ================= */
const ms = s => s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s';
const hz = f => f < 1000 ? Math.round(f) + ' Hz' : (f / 1000).toFixed(f < 10000 ? 2 : 1) + ' k';
const pc = v => Math.round(v * 100) + '%';
const PARAMS = {
  // CORPO — pitched body with pitch drop
  tLvl:   { g: 'corpo', l: 'Livello', d: 1, fmt: pc },
  tPitch: { g: 'corpo', l: 'Altezza', d: .28, map: v => 20 * Math.pow(100, v), fmt: hz },
  tBend:  { g: 'corpo', l: 'Caduta', d: .6, map: v => v * 48, fmt: v => '+' + Math.round(v) + ' st' },
  tBendT: { g: 'corpo', l: 'Rapidità', d: .35, map: v => .002 * Math.pow(150, v), fmt: ms },
  tWave:  { g: 'corpo', l: 'Onda', d: 0, sel: ['Sinus', 'Triang', 'Quadra', 'Dente'] },
  tDec:   { g: 'corpo', l: 'Coda', d: .6, map: v => .01 * Math.pow(300, v), fmt: ms },
  // RUMORE — filtered noise, multi-burst for claps
  nLvl:   { g: 'rumore', l: 'Livello', d: 0, fmt: pc },
  nType:  { g: 'rumore', l: 'Filtro', d: 1, sel: ['Basso', 'Banda', 'Alto'] },
  nFreq:  { g: 'rumore', l: 'Frequenza', d: .6, map: v => 60 * Math.pow(300, v), fmt: hz },
  nQ:     { g: 'rumore', l: 'Risonanza', d: .2, map: v => .3 * Math.pow(60, v), fmt: v => v.toFixed(1) },
  nDec:   { g: 'rumore', l: 'Coda', d: .4, map: v => .005 * Math.pow(400, v), fmt: ms },
  nBursts:{ g: 'rumore', l: 'Colpi', d: 0, sel: ['1', '2', '3', '4', '5', '6'] },
  nSpread:{ g: 'rumore', l: 'Spazio', d: .3, map: v => .002 + v * .03, fmt: ms },
  // METALLO — inharmonic square bank + FM
  mLvl:   { g: 'metallo', l: 'Livello', d: 0, fmt: pc },
  mFreq:  { g: 'metallo', l: 'Base', d: .45, map: v => 60 * Math.pow(30, v), fmt: hz },
  mSet:   { g: 'metallo', l: 'Serie', d: 0, sel: ['808', 'Campana', 'Armon.', 'Campan.', 'Caos'] },
  mDisp:  { g: 'metallo', l: 'Dispers.', d: .2, fmt: pc },
  mFm:    { g: 'metallo', l: 'FM', d: 0, fmt: pc },
  mDec:   { g: 'metallo', l: 'Coda', d: .3, map: v => .01 * Math.pow(200, v), fmt: ms },
  mHp:    { g: 'metallo', l: 'Passa‑alto', d: .7, map: v => 200 * Math.pow(60, v), fmt: hz },
  // CERAMICA — modal resonator bank (dishes, cups, glass, bars)
  rLvl:   { g: 'ceramica', l: 'Livello', d: 0, fmt: pc },
  rFreq:  { g: 'ceramica', l: 'Frequenza', d: .55, map: v => 80 * Math.pow(100, v), fmt: hz },
  rShape: { g: 'ceramica', l: 'Forma', d: 1, sel: ['Piatto', 'Tazza', 'Vetro', 'Barra', 'Gong', 'Legno', 'Pelle', 'Pentola'] },
  rRing:  { g: 'ceramica', l: 'Risonanza', d: .5, map: v => 4 * Math.pow(100, v), fmt: v => 'Q ' + Math.round(v) },
  rExc:   { g: 'ceramica', l: 'Colpo', d: .6, fmt: v => v < .5 ? 'spazzola' : 'bacchetta' },
  rBright:{ g: 'ceramica', l: 'Brillanza', d: .5, fmt: pc },
  // CAMPIONE — recorded or loaded audio
  sLvl:   { g: 'campione', l: 'Livello', d: 0, fmt: pc },
  sStart: { g: 'campione', l: 'Inizio', d: 0, fmt: pc },
  sLen:   { g: 'campione', l: 'Durata', d: 1, fmt: pc },
  sPitch: { g: 'campione', l: 'Tono', d: .5, map: v => Math.round((v - .5) * 48), fmt: v => (v > 0 ? '+' : '') + v + ' st' },
  sDec:   { g: 'campione', l: 'Coda', d: 1, map: v => v > .98 ? 99 : .01 * Math.pow(300, v), fmt: v => v > 90 ? 'intera' : ms(v) },
  sRev:   { g: 'campione', l: 'Verso', d: 0, sel: ['Avanti', 'Indietro'] },
  // COLORE — baked character
  click:  { g: 'colore', l: 'Click', d: .15, fmt: pc },
  drive:  { g: 'colore', l: 'Drive', d: .15, fmt: pc },
  bits:   { g: 'colore', l: 'Bit', d: 0, map: v => Math.round(16 - v * 14), fmt: v => v + ' bit' },
  down:   { g: 'colore', l: 'Riduci', d: 0, map: v => 1 + Math.round(v * v * 39), fmt: v => v === 1 ? 'off' : '÷' + v },
  vari:   { g: 'colore', l: 'Variazione', d: .2, fmt: pc },
  human:  { g: 'colore', l: 'Umano', d: 0, map: v => v * .025, fmt: ms },
  // MIX — live channel strip
  vol:    { g: 'mix', l: 'Volume', d: .75, fmt: pc, live: true },
  pan:    { g: 'mix', l: 'Pan', d: .5, fmt: v => v < .48 ? 'S ' + Math.round((.5 - v) * 200) : v > .52 ? 'D ' + Math.round((v - .5) * 200) : 'centro', live: true },
  cut:    { g: 'mix', l: 'Filtro', d: .5, fmt: v => v < .48 ? 'LP' : v > .52 ? 'HP' : 'aperto', live: true },
  res:    { g: 'mix', l: 'Risonanza', d: .1, fmt: pc, live: true },
  rev:    { g: 'mix', l: 'Vasca', d: .12, fmt: pc, live: true },
  del:    { g: 'mix', l: 'Eco', d: 0, fmt: pc, live: true },
  choke:  { g: 'mix', l: 'Choke', d: 0, sel: ['—', 'A', 'B', 'C'], live: true },
};
const GROUPS = ['corpo', 'rumore', 'metallo', 'ceramica', 'campione', 'colore', 'mix'];
const val = (p, k) => { const d = PARAMS[k]; const v = p[k] == null ? d.d : p[k]; return d.sel ? Math.round(v * (d.sel.length - 1)) : d.map ? d.map(v) : v; };
function display(k, v) { const d = PARAMS[k]; if (d.sel) return d.sel[Math.round(v * (d.sel.length - 1))]; const x = d.map ? d.map(v) : v; return d.fmt ? d.fmt(x) : String(x); }
function defaults() { const o = {}; for (const k in PARAMS) o[k] = PARAMS[k].d; return o; }

const METAL = [
  [1, 1.483, 1.8, 2.546, 2.63, 3.897],
  [1, 1.64, 2.12, 3.05, 3.57, 4.9],
  [1, 2, 3, 4, 5, 6],
  [1, 1.4818],
  null,
];
const MODES = [
  [1, 2.08, 3.41, 3.89, 5.0, 5.95],          // piatto (circular plate)
  [1, 2.32, 4.25, 6.63, 9.38],               // tazza
  [1, 2.756, 5.404, 8.933],                  // vetro (free bar, glassy)
  [1, 3.93, 9.61],                           // barra (marimba-ish)
  [1, 1.13, 1.42, 1.67, 2.2, 2.6, 3.1, 3.7], // gong
  [1, 2.57, 4.2],                            // legno
  [1, 1.59, 2.14, 2.3, 2.65, 2.92],          // pelle (membrane)
  [1, 1.5, 1.98, 2.44, 2.9, 3.6, 4.1],       // pentola
];
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ================= offline render of one hit ================= */
function noiseBuffer(oc, sec) {
  const b = oc.createBuffer(1, Math.max(1, Math.ceil(oc.sampleRate * sec)), oc.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1;
  return b;
}
function envDecay(g, t0, peak, dec, att = .0015) {
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + att);
  g.gain.exponentialRampToValueAtTime(Math.max(peak * .0005, 1e-5), t0 + att + dec);
  g.gain.linearRampToValueAtTime(0, t0 + att + dec + .01);
}
const reversedCache = new WeakMap();
function reversed(buf) {
  if (reversedCache.has(buf)) return reversedCache.get(buf);
  const r = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) { const s = buf.getChannelData(c), d = r.getChannelData(c); for (let i = 0; i < s.length; i++) d[i] = s[s.length - 1 - i]; }
  reversedCache.set(buf, r); return r;
}

async function renderHit(track, variation) {
  const P = Object.assign(defaults(), track.p);
  const vx = P.vari * (variation ? 1 : 0);
  const jit = (k, a) => { if (!vx) return P[k]; P[k] = clamp(P[k] + (R() - .5) * a * vx, 0, 1); return P[k]; };
  ['tPitch', 'nFreq', 'mFreq', 'rFreq'].forEach(k => jit(k, .03));
  ['tDec', 'nDec', 'mDec', 'rRing', 'tBend', 'nQ', 'rBright', 'mFm'].forEach(k => jit(k, .1));
  const v = k => val(P, k);

  const tl = P.tLvl, nl = P.nLvl, ml = P.mLvl, rl = P.rLvl, sl = track.sample ? P.sLvl : 0;
  const sDecS = v('sDec'), sRate = Math.pow(2, v('sPitch') / 12);
  let sDur = 0;
  if (sl) { const bd = track.sample.duration, st = P.sStart * bd; sDur = Math.min(Math.max(.01, P.sLen * (bd - st)) / sRate, sDecS * 1.2 + .02); }
  const rQ = v('rRing'), rF = v('rFreq');
  let dur = Math.max(.03,
    tl > 0 ? v('tDec') + .01 : 0,
    nl > 0 ? v('nDec') + v('nSpread') * v('nBursts') + .01 : 0,
    ml > 0 ? v('mDec') + .01 : 0,
    rl > 0 ? Math.min(3.5, rQ / (Math.PI * rF) * 7 + .03) : 0,
    sl > 0 ? sDur : 0) + .03;
  dur = Math.min(dur, 6);
  const oc = new OfflineAudioContext(1, Math.ceil(SR * dur), SR);
  const sum = oc.createGain();
  const drive = P.drive, sh = oc.createWaveShaper();
  { const k = 1 + drive * drive * 30, n = 2048, c = new Float32Array(n), nk = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / nk; }
    sh.curve = c; sh.oversample = '4x'; }
  sum.connect(sh); sh.connect(oc.destination);

  // CORPO
  if (tl > 0) {
    const f = v('tPitch'), bend = v('tBend'), bt = v('tBendT'), w = ['sine', 'triangle', 'square', 'sawtooth'][v('tWave')];
    const o = oc.createOscillator(); o.type = w;
    o.frequency.setValueAtTime(Math.min(20000, f * Math.pow(2, bend / 12)), 0);
    o.frequency.setTargetAtTime(f, 0, bt / 3);
    const g = oc.createGain(); envDecay(g, 0, tl * tl, v('tDec'), .0008);
    let tail = o;
    if (w !== 'sine') { const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(18000, f * 10 + 500); o.connect(lp); tail = lp; }
    tail.connect(g); g.connect(sum); o.start(0); o.stop(dur);
  }
  // RUMORE
  if (nl > 0) {
    const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, dur);
    const fl = oc.createBiquadFilter(); fl.type = ['lowpass', 'bandpass', 'highpass'][v('nType')];
    fl.frequency.value = Math.min(18000, v('nFreq')); fl.Q.value = v('nQ');
    const g = oc.createGain(), bursts = v('nBursts') + 1, sp = v('nSpread'), lvl = nl * nl * (fl.type === 'bandpass' ? 1.6 : 1);
    g.gain.setValueAtTime(0, 0);
    for (let b = 0; b < bursts; b++) {
      const t = b * sp * (1 + (R() - .5) * .3), last = b === bursts - 1;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl * (last ? 1 : .85), t + .0008);
      if (last) g.gain.exponentialRampToValueAtTime(lvl * .0005 + 1e-5, t + .0008 + v('nDec'));
      else g.gain.exponentialRampToValueAtTime(lvl * .05 + 1e-5, t + sp * .9);
    }
    src.connect(fl); fl.connect(g); g.connect(sum); src.start(0);
  }
  // METALLO
  if (ml > 0) {
    const base = v('mFreq'), set = v('mSet');
    const ratios = METAL[set] || [0, 1, 2, 3, 4, 5].map(i => 1 + i * .37 + hash(i + Math.round(P.mFreq * 50)) * 1.6);
    const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = v('mHp'); hp.Q.value = .7;
    const bp = oc.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = Math.min(16000, base * 8); bp.gain.value = 6; bp.Q.value = 1;
    const g = oc.createGain(); envDecay(g, 0, ml * ml * .35, v('mDec'), .0005);
    hp.connect(bp); bp.connect(g); g.connect(sum);
    let fm = null;
    if (P.mFm > .01) { fm = oc.createOscillator(); fm.frequency.value = base * (1.41 + P.mDisp * 2.3); const fg = oc.createGain(); fg.gain.value = P.mFm * P.mFm * base * 6; fm.connect(fg); fm.start(0); fm.stop(dur); fm = fg; }
    ratios.forEach((r, i) => {
      const o = oc.createOscillator(); o.type = 'square';
      o.frequency.value = Math.min(18000, base * r * (1 + (hash(i * 7.3 + 1) - .5) * P.mDisp * .6));
      if (fm) fm.connect(o.frequency);
      const og = oc.createGain(); og.gain.value = 1 / ratios.length * 2;
      o.connect(og); og.connect(hp); o.start(0); o.stop(dur);
    });
  }
  // CERAMICA
  if (rl > 0) {
    const modes = MODES[v('rShape')], exc = P.rExc;
    const eLen = .0004 + (1 - exc) * .025;
    const eb = oc.createBuffer(1, Math.ceil(SR * eLen) + 2, SR), ed = eb.getChannelData(0);
    for (let i = 0; i < ed.length; i++) { const k = i / ed.length; ed[i] = (exc > .5 && i < 3 ? (i === 0 ? 1 : -.5) : (R() * 2 - 1)) * Math.pow(1 - k, 2); }
    const src = oc.createBufferSource(); src.buffer = eb;
    const tone = oc.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 800 + P.rBright * P.rBright * 17000;
    src.connect(tone);
    const out = oc.createGain(); out.gain.value = rl * rl * Math.sqrt(rQ) * .9; out.connect(sum);
    modes.forEach((m, i) => {
      const f = rF * m; if (f > 19000) return;
      const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (1 + (R() - .5) * .004 * (1 + vx * 4)); bp.Q.value = rQ * (1 - i * .06);
      const g = oc.createGain(); g.gain.value = Math.pow(i + 1, -(1.6 - P.rBright * 1.4));
      tone.connect(bp); bp.connect(g); g.connect(out);
    });
    src.start(0);
  }
  // CAMPIONE
  if (sl > 0) {
    const buf = P.sRev > .5 ? reversed(track.sample) : track.sample, bd = buf.duration, st = P.sStart * bd;
    const src = oc.createBufferSource(); src.buffer = buf; src.playbackRate.value = sRate;
    const g = oc.createGain(); g.gain.setValueAtTime(sl * sl, 0);
    if (sDecS < 90) g.gain.setTargetAtTime(0, .003, sDecS / 4);
    const len = Math.max(.01, P.sLen * (bd - st));
    src.connect(g); g.connect(sum); src.start(0, st, len);
  }
  // CLICK
  if (P.click > .01) {
    const b = oc.createBuffer(1, 96, SR), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (i === 0 ? 1 : (R() * 2 - 1) * .6) * Math.exp(-i / 9);
    const s = oc.createBufferSource(); s.buffer = b; const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const g = oc.createGain(); g.gain.value = P.click * P.click * 1.4; s.connect(hp); hp.connect(g); g.connect(sum); s.start(0);
  }

  const out = await oc.startRendering();
  const d = out.getChannelData(0);
  // bitcrush + sample-rate reduction
  const bits = v('bits'), down = v('down');
  if (bits < 16 || down > 1) {
    const q = Math.pow(2, bits - 1); let hold = 0;
    for (let i = 0; i < d.length; i++) { if (i % down === 0) hold = bits < 16 ? Math.round(d[i] * q) / q : d[i]; d[i] = hold; }
  }
  // normalise and de-click the tail
  let pk = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
  if (pk > 1e-4) { const k = .92 / pk; for (let i = 0; i < d.length; i++) d[i] *= k; }
  const fo = Math.min(d.length, 220); for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  return out;
}
async function render(track) {
  const n = track.p.vari > .02 ? 4 : 1, bufs = [];
  for (let i = 0; i < n; i++) bufs.push(await renderHit(track, i > 0));
  return bufs;
}

/* ================= live graph ================= */
let ctx = null, bus, mDrive, djF, comp, limiter, outG, analyser, streamDest;
let revIn, conv, revPre, revRet, delIn, dL, dR, fbL, fbR, dTone, delRet, dSat, wowG;
const FX = { size: .45, damp: .5, pre: .1, tub: .35, revLvl: .8, dDiv: 3, dFb: .45, dTone: .55, dWow: .2, dPing: 1, delLvl: .7,
  press: .35, sat: .2, dj: .5, master: .85 };
const DIVS = [['1/32', .125], ['1/16', .25], ['1/16T', 1 / 6], ['1/8', .5], ['1/8T', 1 / 3], ['3/16', .75], ['1/4', 1], ['3/8', 1.5], ['1/2', 2]];
const channels = [];

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  bus = ctx.createGain();
  mDrive = ctx.createWaveShaper(); mDrive.oversample = '2x';
  djF = ctx.createBiquadFilter(); djF.type = 'lowpass'; djF.frequency.value = 22000;
  comp = ctx.createDynamicsCompressor(); comp.knee.value = 8; comp.attack.value = .006; comp.release.value = .12;
  const makeup = ctx.createGain(); makeup.gain.value = 1;
  limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .001; limiter.release.value = .06;
  outG = ctx.createGain();
  analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = .6;
  bus.connect(mDrive); mDrive.connect(djF); djF.connect(comp); comp.connect(makeup); makeup.connect(limiter); limiter.connect(outG);
  outG.connect(ctx.destination); outG.connect(analyser);
  try { streamDest = ctx.createMediaStreamDestination(); outG.connect(streamDest); } catch (e) {}
  FX.makeup = makeup;

  // VASCA (reverb)
  revIn = ctx.createGain(); revPre = ctx.createDelay(.5); conv = ctx.createConvolver(); revRet = ctx.createGain();
  revIn.connect(revPre); revPre.connect(conv); conv.connect(revRet); revRet.connect(bus);
  // ECO (ping-pong delay)
  delIn = ctx.createGain(); dL = ctx.createDelay(4); dR = ctx.createDelay(4); fbL = ctx.createGain(); fbR = ctx.createGain();
  dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; dSat = ctx.createWaveShaper(); dSat.curve = tanhCurve(1.6);
  const hpD = ctx.createBiquadFilter(); hpD.type = 'highpass'; hpD.frequency.value = 120;
  const merge = ctx.createChannelMerger(2); delRet = ctx.createGain();
  delIn.connect(dTone); dTone.connect(hpD); hpD.connect(dL);
  dL.connect(fbL); fbL.connect(dSat); dSat.connect(dR); dR.connect(fbR); fbR.connect(dTone);
  dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(delRet); delRet.connect(bus);
  const wow = ctx.createOscillator(); wow.frequency.value = .6; wowG = ctx.createGain(); wow.connect(wowG); wowG.connect(dL.delayTime); wowG.connect(dR.delayTime); wow.start();
  applyFX(true);
  return ctx;
}
function tanhCurve(k) { const n = 1024, c = new Float32Array(n), nk = Math.tanh(k); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / nk; } return c; }
function makeIR() {
  const sec = .25 + FX.size * FX.size * 7.5, n = Math.ceil(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  const tubF = [], tubN = 7; for (let i = 0; i < tubN; i++) tubF.push(300 + R() * 4200);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let y = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n, a = clamp(1 - FX.damp * (.3 + k * .7), .03, 1);
      y += a * ((R() * 2 - 1) - y);
      let s = y * Math.pow(1 - k, 1.6 + FX.damp);
      if (FX.tub > .01) { let m = 0; const t = i / ctx.sampleRate; for (let j = 0; j < tubN; j++) m += Math.sin(t * tubF[j] * 6.2832 + c * j) * Math.exp(-t * (3 + j * 1.3 + (1 - FX.size) * 8)); s += m * FX.tub * .06 * (R() * .5 + .5); }
      d[i] = s * (i < 64 ? i / 64 : 1);
    }
  }
  return b;
}
let irT = 0;
function applyFX(rebuildIR) {
  if (!ctx) return; const t = ctx.currentTime;
  if (rebuildIR) { clearTimeout(irT); irT = setTimeout(() => { conv.buffer = makeIR(); }, 120); }
  revPre.delayTime.setTargetAtTime(FX.pre * .15, t, .05); revRet.gain.setTargetAtTime(FX.revLvl * 1.4, t, .05);
  const dt = Math.min(3.9, DIVS[FX.dDiv][1] * 60 / S.bpm);
  dL.delayTime.setTargetAtTime(dt, t, .05); dR.delayTime.setTargetAtTime(FX.dPing ? dt : .0001, t, .05);
  fbL.gain.setTargetAtTime(FX.dPing ? 1 : FX.dFb * .95, t, .05); fbR.gain.setTargetAtTime(FX.dFb * .95, t, .05);
  dTone.frequency.setTargetAtTime(300 * Math.pow(50, FX.dTone), t, .05); wowG.gain.setTargetAtTime(FX.dWow * .004, t, .1);
  delRet.gain.setTargetAtTime(FX.delLvl * 1.2, t, .05);
  comp.threshold.setTargetAtTime(-6 - FX.press * 30, t, .05); comp.ratio.setTargetAtTime(1.5 + FX.press * 8, t, .05);
  FX.makeup.gain.setTargetAtTime(1 + FX.press * 1.6, t, .05);
  mDrive.curve = tanhCurve(.6 + FX.sat * FX.sat * 8);
  const dj = FX.dj;
  if (dj < .48) { djF.type = 'lowpass'; djF.frequency.setTargetAtTime(80 * Math.pow(270, dj / .48), t, .03); djF.Q.value = 3; }
  else if (dj > .52) { djF.type = 'highpass'; djF.frequency.setTargetAtTime(20 * Math.pow(250, (dj - .52) / .48), t, .03); djF.Q.value = 3; }
  else { djF.type = 'lowpass'; djF.frequency.setTargetAtTime(22000, t, .03); djF.Q.value = .5; }
  outG.gain.setTargetAtTime(FX.master, t, .05);
}

class Channel {
  constructor() {
    this.in = ctx.createGain(); this.f = ctx.createBiquadFilter(); this.v = ctx.createGain();
    this.pan = ctx.createStereoPanner(); this.rs = ctx.createGain(); this.ds = ctx.createGain();
    this.in.connect(this.f); this.f.connect(this.v); this.v.connect(this.pan); this.pan.connect(bus);
    this.v.connect(this.rs); this.rs.connect(revIn); this.v.connect(this.ds); this.ds.connect(delIn);
    this.an = ctx.createAnalyser(); this.an.fftSize = 256; this.v.connect(this.an); this.buf = new Float32Array(256);
    this.active = []; this.bufs = []; this.rr = 0; this.gate = 1;
  }
  apply(p, gate) {
    const t = ctx.currentTime, g = val(p, 'vol'); this.gate = gate;
    this.v.gain.setTargetAtTime(g * g * 1.2 * gate, t, .02);
    this.pan.pan.setTargetAtTime((p.pan - .5) * 2, t, .02);
    this.rs.gain.setTargetAtTime(p.rev * p.rev * 1.5, t, .02); this.ds.gain.setTargetAtTime(p.del * p.del * 1.4, t, .02);
    const c = p.cut, q = .5 + p.res * 14;
    if (c < .48) { this.f.type = 'lowpass'; this.f.frequency.setTargetAtTime(60 * Math.pow(330, c / .48), t, .02); }
    else if (c > .52) { this.f.type = 'highpass'; this.f.frequency.setTargetAtTime(20 * Math.pow(500, (c - .52) / .48), t, .02); }
    else { this.f.type = 'lowpass'; this.f.frequency.setTargetAtTime(22000, t, .02); }
    this.f.Q.setTargetAtTime(c > .48 && c < .52 ? .5 : q, t, .02);
  }
  level() { this.an.getFloatTimeDomainData(this.buf); let m = 0; for (let i = 0; i < this.buf.length; i++) m = Math.max(m, Math.abs(this.buf[i])); return m; }
  play(time, vel, semis, human) {
    if (!this.bufs.length) return;
    const b = this.bufs[this.rr++ % this.bufs.length];
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = Math.pow(2, (semis || 0) / 12);
    const g = ctx.createGain(); g.gain.value = Math.pow(clamp(vel, 0, 1.2), 1.6);
    s.connect(g); g.connect(this.in);
    const t = Math.max(ctx.currentTime, time + (human ? (R() - .5) * human * 2 : 0));
    s.start(t);
    const node = { s, g, end: t + b.duration / s.playbackRate.value };
    this.active.push(node); s.onended = () => { const i = this.active.indexOf(node); if (i >= 0) this.active.splice(i, 1); g.disconnect(); };
  }
  choke(time) {
    for (const n of this.active) if (n.end > time) { try { n.g.gain.setTargetAtTime(0, Math.max(time, ctx.currentTime), .006); n.s.stop(Math.max(time, ctx.currentTime) + .06); } catch (e) {} }
  }
}
function channel(i) { init(); while (channels.length <= i) channels.push(new Channel()); return channels[i]; }

/* ================= clock ================= */
const RATES = [['1/4', 1], ['1/8', 2], ['1/8T', 3], ['1/16', 4], ['1/16T', 6], ['1/32', 8]];
const S = { bpm: 124, swing: 0, playing: false };
let timer = null, nextT = [], stepN = [], barNext = 0, barN = 0, cb = null;
const events = [];
function start(callbacks) {
  init(); ctx.resume(); cb = callbacks;
  if (S.playing) return; S.playing = true;
  const t0 = ctx.currentTime + .06;
  nextT = new Array(16).fill(t0); stepN = new Array(16).fill(0); barNext = t0; barN = 0;
  timer = setInterval(tick, 20); tick();
}
function stop() {
  S.playing = false; clearInterval(timer); timer = null; events.length = 0;
  channels.forEach(c => c.choke(ctx.currentTime));
}
function resetTracks(t) { for (let i = 0; i < nextT.length; i++) { nextT[i] = t; stepN[i] = 0; } }
function tick() {
  if (!S.playing || ctx.state !== 'running') return;
  const ahead = ctx.currentTime + .12;
  if (barNext < ctx.currentTime - .25) { const t = ctx.currentTime + .05; barNext = t; resetTracks(t); }   // recover after a stall
  for (let guard = 0; guard < 8; guard++) {
    const limit = Math.min(ahead, barNext);
    const pat = cb.pattern();
    for (let i = 0; i < pat.tracks.length; i++) {
      const tr = pat.tracks[i], div = RATES[tr.rate][1], sd = 60 / S.bpm / div;
      while (nextT[i] < limit) {
        const n = stepN[i] % tr.len, st = tr.steps[n];
        let t = nextT[i];
        if ((div === 4 || div === 2) && n % 2 === 1) t += S.swing * sd * .5;
        if (st.on) cb.step(i, n, t, sd, st);
        events.push({ t, i, n, on: st.on });
        stepN[i]++; nextT[i] += sd;
      }
    }
    if (barNext < ahead) {
      const changed = cb.bar(barN, barNext);
      if (changed) resetTracks(barNext);
      barN++; barNext += 4 * 60 / S.bpm;
    } else break;
  }
}
function setBpm(b) { S.bpm = clamp(b, 30, 300); if (ctx) applyFX(false); }

/* ================= mic + files ================= */
async function decodeFile(file) { init(); const ab = await file.arrayBuffer(); return trimNormalize(await ctx.decodeAudioData(ab), 12); }
function trimNormalize(buf, maxSec) {
  const ch = buf.numberOfChannels, n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(mono[i]));
  const th = pk * .06; let a = 0, b = n - 1;
  while (a < n && Math.abs(mono[a]) < th) a++; while (b > a && Math.abs(mono[b]) < th * .3) b--;
  a = Math.max(0, a - Math.round(buf.sampleRate * .004)); b = Math.min(n - 1, b + Math.round(buf.sampleRate * .05), a + Math.round(buf.sampleRate * maxSec));
  const len = Math.max(64, b - a), out = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: buf.sampleRate }), d = out.getChannelData(0);
  const k = pk > 1e-4 ? .95 / pk : 1;
  for (let i = 0; i < len; i++) d[i] = mono[a + i] * k;
  const fo = Math.min(len, Math.round(buf.sampleRate * .01)); for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
  return out;
}
let mic = null;
async function recStart() {
  init(); await ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
  const mr = new MediaRecorder(stream), chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  mic = { stream, an, mr, chunks, t0: performance.now(), buf: new Float32Array(512) };
  mr.start();
  return mic;
}
function micLevel() { if (!mic) return 0; mic.an.getFloatTimeDomainData(mic.buf); let m = 0; for (const x of mic.buf) m = Math.max(m, Math.abs(x)); return m; }
function recStop() {
  return new Promise((res, rej) => {
    if (!mic) return rej(new Error('no mic'));
    const m = mic; mic = null;
    m.mr.onstop = async () => {
      m.stream.getTracks().forEach(t => t.stop());
      try { const ab = await new Blob(m.chunks, { type: m.mr.mimeType }).arrayBuffer(); res(trimNormalize(await ctx.decodeAudioData(ab), 8)); }
      catch (e) { rej(e); }
    };
    m.mr.stop();
  });
}

/* ================= mix recorder ================= */
let mixRec = null;
function mixStart() {
  if (!streamDest || !window.MediaRecorder) return false;
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  const type = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(streamDest.stream, type ? { mimeType: type, audioBitsPerSecond: 256000 } : undefined), chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data); mr.start(250);
  mixRec = { mr, chunks, t0: performance.now() }; return true;
}
function mixStop() {
  return new Promise(res => {
    if (!mixRec) return res(null); const m = mixRec; mixRec = null;
    m.mr.onstop = () => { const type = m.mr.mimeType || 'audio/webm'; res({ blob: new Blob(m.chunks, { type }), ext: type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm', secs: (performance.now() - m.t0) / 1000 }); };
    m.mr.stop();
  });
}

function masterLevel() {
  if (!analyser) return 0; const b = masterLevel.b || (masterLevel.b = new Float32Array(1024)); analyser.getFloatTimeDomainData(b);
  let m = 0; for (let i = 0; i < b.length; i += 2) m = Math.max(m, Math.abs(b[i])); return m;
}

return { PARAMS, GROUPS, DIVS, RATES, FX, S, val, display, defaults, init, render, channel, channels, applyFX, start, stop, setBpm,
  decodeFile, recStart, recStop, micLevel, mixStart, mixStop, masterLevel, events, resetTracks,
  get ctx() { return ctx; }, get recording() { return !!mixRec; }, get mixT0() { return mixRec ? mixRec.t0 : 0; } };
})();
