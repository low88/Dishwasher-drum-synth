/* Dishwasher — sound recipes, rhythm generators and wash programs. */
'use strict';
const Kit = (() => {
const R = Math.random, r = (a, b) => a + R() * (b - a), pick = a => a[R() * a.length | 0];
const sel = (k, i) => i / (Engine.PARAMS[k].sel.length - 1);   // option index → normalised value

/* ---------- sound recipes per role (normalised parameters) ---------- */
const ROLES = {
  kick:   { n: 'Cassa', f: () => ({ tLvl: 1, tPitch: r(.13, .25), tBend: r(.45, .95), tBendT: r(.22, .5), tWave: sel('tWave', R() < .8 ? 0 : 1), tDec: r(.6, .84),
            nLvl: R() < .4 ? r(.08, .3) : 0, nType: sel('nType', 0), nFreq: r(.35, .55), nDec: r(.15, .35), click: r(.1, .55), drive: r(0, .55), rev: r(0, .06) }) },
  snare:  { n: 'Rullante', f: () => ({ tLvl: r(.5, .85), tPitch: r(.42, .56), tBend: r(.1, .3), tBendT: r(.25, .4), tDec: r(.33, .5),
            nLvl: r(.8, 1), nType: sel('nType', pick([1, 2])), nFreq: r(.55, .8), nQ: r(.05, .3), nDec: r(.48, .66),
            rLvl: R() < .5 ? r(.2, .5) : 0, rShape: sel('rShape', 6), rFreq: r(.18, .3), rRing: r(.3, .5), click: r(.1, .4), drive: r(0, .4), rev: r(.08, .25) }) },
  clap:   { n: 'Clap', f: () => ({ tLvl: 0, nLvl: 1, nType: sel('nType', 1), nFreq: r(.45, .62), nQ: r(.15, .45), nDec: r(.55, .7),
            nBursts: sel('nBursts', pick([2, 3, 3, 4])), nSpread: r(.18, .45), click: 0, drive: r(0, .3), rev: r(.15, .35), vari: r(.3, .6) }) },
  hatC:   { n: 'Hat chiuso', f: () => ({ tLvl: 0, mLvl: 1, mFreq: r(.45, .6), mSet: sel('mSet', R() < .75 ? 0 : 4), mDisp: r(0, .35), mFm: R() < .3 ? r(.1, .5) : 0,
            mDec: r(.24, .42), mHp: r(.86, .96), nLvl: r(.1, .45), nType: sel('nType', 2), nFreq: r(.82, .92), nDec: r(.25, .4), choke: sel('choke', 1), vari: r(.3, .6), human: r(0, .2), rev: r(0, .1) }) },
  hatO:   { n: 'Hat aperto', f: () => ({ tLvl: 0, mLvl: 1, mFreq: r(.45, .6), mSet: sel('mSet', R() < .75 ? 0 : 4), mDisp: r(0, .35), mFm: R() < .3 ? r(.1, .5) : 0,
            mDec: r(.6, .78), mHp: r(.84, .95), nLvl: r(.1, .4), nType: sel('nType', 2), nFreq: r(.8, .92), nDec: r(.55, .7), choke: sel('choke', 1), rev: r(.05, .2) }) },
  rim:    { n: 'Posate', f: () => ({ tLvl: r(.1, .4), tPitch: r(.55, .7), tBend: r(0, .1), tDec: r(.1, .2), rLvl: 1, rShape: sel('rShape', pick([3, 5, 2])), rFreq: r(.62, .78),
            rRing: r(.22, .42), rExc: r(.8, 1), rBright: r(.5, .9), click: r(.3, .7), rev: r(.05, .2), del: R() < .3 ? r(.2, .5) : 0 }) },
  tom:    { n: 'Pentola', f: () => ({ tLvl: 1, tPitch: r(.33, .56), tBend: r(.1, .3), tBendT: r(.3, .5), tDec: r(.62, .78), rLvl: r(.25, .6), rShape: sel('rShape', pick([6, 7])),
            rFreq: r(.25, .45), rRing: r(.35, .55), rExc: r(.4, .8), click: r(.1, .35), rev: r(.1, .3) }) },
  shaker: { n: 'Shaker', f: () => ({ tLvl: 0, nLvl: 1, nType: sel('nType', pick([1, 2])), nFreq: r(.78, .9), nQ: r(.1, .4), nDec: r(.3, .46), nBursts: sel('nBursts', pick([0, 1])),
            nSpread: r(.3, .6), click: 0, vari: r(.5, .9), human: r(.1, .4), rev: r(.05, .2) }) },
  glass:  { n: 'Tazzina', f: () => ({ tLvl: 0, rLvl: 1, rShape: sel('rShape', pick([0, 1, 2, 1])), rFreq: r(.5, .8), rRing: r(.55, .82), rExc: r(.6, 1), rBright: r(.45, .85),
            click: r(0, .25), vari: r(.2, .5), rev: r(.2, .45), del: R() < .4 ? r(.1, .4) : 0 }) },
  cowbell:{ n: 'Campanaccio', f: () => ({ tLvl: 0, mLvl: 1, mSet: sel('mSet', 3), mFreq: r(.6, .7), mDisp: r(0, .15), mDec: r(.35, .5), mHp: r(.3, .5), rev: r(.05, .2) }) },
  zap:    { n: 'Bolla', f: () => ({ tLvl: 1, tWave: sel('tWave', pick([0, 2, 3, 1])), tPitch: r(.55, .85), tBend: r(.5, 1), tBendT: r(.5, .8), tDec: r(.35, .55),
            bits: R() < .5 ? r(.3, .75) : 0, down: R() < .4 ? r(.2, .6) : 0, drive: r(.1, .6), del: r(.1, .45), rev: r(.1, .3) }) },
  pot:    { n: 'Pentolone', f: () => ({ tLvl: r(0, .5), tPitch: r(.2, .35), tDec: r(.3, .5), rLvl: 1, rShape: sel('rShape', pick([7, 4])), rFreq: r(.2, .42), rRing: r(.5, .75),
            rExc: r(.3, .8), rBright: r(.3, .7), mLvl: R() < .4 ? r(.2, .5) : 0, mFreq: r(.3, .5), mSet: sel('mSet', 1), mDec: r(.5, .7), rev: r(.2, .4) }) },
  wild:   { n: 'Mistero', f: () => {
            const o = {}; for (const k in Engine.PARAMS) { const d = Engine.PARAMS[k]; if (d.live) continue; o[k] = R(); }
            ['tLvl', 'nLvl', 'mLvl', 'rLvl'].forEach(k => o[k] = R() < .55 ? r(.3, 1) : 0);
            if (!o.tLvl && !o.nLvl && !o.mLvl && !o.rLvl) o.tLvl = 1;
            o.sLvl = 0; o.bits = R() < .3 ? R() : 0; o.down = R() < .25 ? R() : 0; o.drive = R() * .6;
            ['tDec', 'nDec', 'mDec'].forEach(k => o[k] = r(.2, .75)); o.rRing = r(.2, .75); o.rev = r(0, .4); o.del = R() < .3 ? R() * .5 : 0;
            return o; } },
};
const ROLE_KEYS = Object.keys(ROLES);
function sound(role) {
  const p = Engine.defaults();
  Object.assign(p, { tLvl: 0 }, ROLES[role].f());
  p.pan = .5 + (R() - .5) * (role === 'kick' || role === 'snare' || role === 'clap' ? 0 : .5);
  return p;
}
function wilder(p, amt) {   // nudge a sound, keeping its character
  const q = Object.assign({}, p);
  for (const k in Engine.PARAMS) { const d = Engine.PARAMS[k]; if (d.live || d.sel || k.endsWith('Lvl')) continue; if (R() < .5) q[k] = Math.max(0, Math.min(1, q[k] + (R() - .5) * amt)); }
  return q;
}

/* ---------- rhythm helpers ---------- */
const blank = () => ({ on: 0, v: .8, p: 1, r: 1, t: 0 });
function emptyTrack(len = 16, rate = 3) { return { len, rate, steps: Array.from({ length: 64 }, blank) }; }
function euclid(k, n, rot = 0) {
  const out = new Array(n).fill(0); if (k <= 0) return out;
  for (let i = 0; i < n; i++) out[(i + rot) % n] = Math.floor((i * k) / n) !== Math.floor(((i - 1) * k) / n) ? 1 : 0;
  return out;
}
function fill(tr, hits, vel = () => .85) { hits.forEach((h, i) => { if (h) { const s = tr.steps[i]; s.on = 1; s.v = vel(i); } }); return tr; }
const at = (n, idx) => { const a = new Array(n).fill(0); idx.forEach(i => a[i % n] = 1); return a; };

/* ---------- programs ---------- */
const PROGRAMS = {
  eco:        { n: 'Eco', d: 'techno minimale', bpm: [122, 130], swing: [0, .12], roles: ['kick', 'clap', 'hatC', 'hatO', 'rim', 'glass', 'shaker', 'zap'],
                fx: { size: .5, tub: .35, dDiv: 5, dFb: .45 } },
  prelavaggio:{ n: 'Prelavaggio', d: 'house con swing', bpm: [118, 124], swing: [.25, .45], roles: ['kick', 'clap', 'hatC', 'hatO', 'shaker', 'cowbell', 'tom', 'glass'],
                fx: { size: .4, tub: .2, dDiv: 3, dFb: .35 } },
  intensivo:  { n: 'Intensivo', d: 'breakbeat e drum & bass', bpm: [168, 176], swing: [0, .1], roles: ['kick', 'snare', 'hatC', 'hatO', 'rim', 'shaker', 'tom', 'zap'],
                fx: { size: .35, tub: .4, dDiv: 2, dFb: .3 } },
  rapido:     { n: 'Rapido', d: 'trap: rullate e hat a raffica', bpm: [136, 148], swing: [0, .05], roles: ['kick', 'clap', 'hatC', 'hatO', 'snare', 'zap', 'rim', 'glass'],
                fx: { size: .55, tub: .3, dDiv: 4, dFb: .4 } },
  delicati:   { n: 'Delicati', d: 'percussioni organiche', bpm: [92, 108], swing: [.1, .3], roles: ['tom', 'rim', 'shaker', 'glass', 'pot', 'cowbell', 'clap', 'kick'],
                fx: { size: .6, tub: .5, dDiv: 2, dFb: .4 } },
  ammollo:    { n: 'Ammollo', d: 'dub lento e spazioso', bpm: [70, 84], swing: [.1, .25], roles: ['kick', 'rim', 'hatC', 'glass', 'pot', 'shaker', 'zap', 'snare'],
                fx: { size: .8, tub: .45, dDiv: 5, dFb: .65 } },
  centrifuga: { n: 'Centrifuga', d: 'caos IDM, poliritmi', bpm: [140, 172], swing: [0, .2], roles: ['kick', 'wild', 'hatC', 'zap', 'glass', 'wild', 'rim', 'wild'],
                fx: { size: .5, tub: .7, dDiv: 2, dFb: .55 } },
};

function rhythm(role, prog) {
  const tr = emptyTrack();
  const hum = () => .55 + R() * .45;
  const P = prog;
  if (P === 'centrifuga') {
    tr.len = pick([5, 7, 9, 11, 12, 13, 15, 16, 16]); tr.rate = pick([3, 3, 4, 5, 2]);
    fill(tr, euclid(1 + (R() * tr.len * .6 | 0), tr.len, R() * tr.len | 0), hum);
    tr.steps.slice(0, tr.len).forEach(s => { if (s.on) { if (R() < .2) s.r = pick([2, 3, 4]); if (R() < .25) s.t = pick([-12, -5, -3, 3, 5, 7, 12]); s.p = R() < .3 ? r(.4, .9) : 1; } });
    if (role === 'kick') { tr.len = 16; tr.rate = 3; tr.steps.forEach(s => s.on = 0); fill(tr, at(16, [0, pick([3, 6, 7]), pick([10, 11]), pick([13, 14])]), () => .9); }
    return tr;
  }
  const T = {
    kick: {
      eco: () => at(16, [0, 4, 8, 12]), prelavaggio: () => at(16, [0, 4, 8, 12]),
      intensivo: () => at(16, [0, pick([6, 7]), 10].concat(R() < .5 ? [13] : [])),
      rapido: () => at(16, [0, pick([3, 6]), pick([7, 10, 11])].concat(R() < .5 ? [14] : [])),
      delicati: () => at(16, [0, pick([7, 10])]), ammollo: () => at(16, [0, pick([7, 10])]),
    },
    snare: { eco: () => at(16, [4, 12]), prelavaggio: () => at(16, [4, 12]), intensivo: () => at(16, [4, 12]), rapido: () => at(16, [8]),
      delicati: () => euclid(3, 16, 2), ammollo: () => at(16, [8]) },
    clap: { eco: () => at(16, [4, 12]), prelavaggio: () => at(16, [4, 12]), intensivo: () => at(16, [4, 12]), rapido: () => at(16, [8]),
      delicati: () => euclid(2, 16, 4), ammollo: () => at(16, [8]) },
    hatC: { eco: () => at(16, [2, 6, 10, 14]).map((x, i) => x || (R() < .35 && i % 2 ? 1 : 0)), prelavaggio: () => new Array(16).fill(1).map((_, i) => i % 2 === 0 || R() < .5 ? 1 : 0),
      intensivo: () => new Array(16).fill(0).map((_, i) => i % 2 === 0 || R() < .4 ? 1 : 0), rapido: () => new Array(16).fill(1), delicati: () => euclid(7, 16, 1), ammollo: () => euclid(4, 16, 2) },
    hatO: { eco: () => at(16, [2, 6, 10, 14]), prelavaggio: () => at(16, [2, 6, 10, 14]), intensivo: () => at(16, [pick([6, 14])]), rapido: () => at(16, [pick([6, 14])]),
      delicati: () => euclid(2, 16, 6), ammollo: () => at(16, [14]) },
  };
  const t = T[role] && T[role][P];
  let hits = t ? t() : euclid(pick([2, 3, 3, 4, 5, 5, 7]), 16, R() * 16 | 0);
  if (!t && P === 'ammollo') hits = euclid(pick([1, 2, 3]), 16, R() * 16 | 0);
  fill(tr, hits, i => (role === 'hatC' || role === 'shaker') ? (i % 4 === 0 ? .95 : i % 2 === 0 ? .7 : .5 + R() * .2) : hum());
  // program flavours
  if (P === 'rapido' && role === 'hatC') { tr.steps.slice(0, 16).forEach(s => { if (R() < .22) s.r = pick([2, 3, 4]); }); }
  if (P === 'intensivo' && role === 'snare') { for (let i = 0; i < 16; i++) if (!tr.steps[i].on && R() < .15) { tr.steps[i].on = 1; tr.steps[i].v = .3; } }
  if (P === 'delicati' && !['kick'].includes(role)) { tr.steps.slice(0, 16).forEach(s => { if (s.on) s.p = r(.55, 1); }); if (R() < .4) { tr.len = pick([12, 14, 15]); } if (R() < .25) tr.rate = 4; }
  if (P === 'eco' && (role === 'glass' || role === 'rim')) tr.len = pick([12, 14, 16, 16]);
  if (role === 'zap' || role === 'glass') tr.steps.slice(0, 16).forEach(s => { if (s.on) { s.p = r(.4, .9); if (R() < .3) s.t = pick([-5, 7, 12, -12, 3]); } });
  return tr;
}

/* ---------- evolution ("usura") ---------- */
function wear(pattern, tracks, amt) {
  pattern.tracks.forEach((tr, i) => {
    if (tracks[i].mute || R() > amt * .7) return;
    const n = tr.len, s = tr.steps[R() * n | 0], on = tr.steps.slice(0, n).filter(x => x.on).length;
    const op = R();
    if (op < .35) { if (s.on && (on / n > .3 || R() < .3) && !(tracks[i].role === 'kick' && R() < .7)) s.on = 0; else if (!s.on) { s.on = 1; s.v = .4 + R() * .5; } }
    else if (op < .55) { if (s.on) s.v = Math.max(.2, Math.min(1, s.v + (R() - .5) * .5)); }
    else if (op < .7) { if (s.on) s.r = R() < .6 ? 1 : pick([2, 3, 4]); }
    else if (op < .82) { if (s.on) s.p = R() < .5 ? 1 : .5 + R() * .5; }
    else if (op < .92) { if (s.on) s.t = R() < .5 ? 0 : pick([-12, -5, -2, 2, 5, 7, 12]); }
    else if (tracks[i].role !== 'kick') { const st = tr.steps.slice(0, n); st.unshift(st.pop()); st.forEach((x, k) => tr.steps[k] = x); }
  });
}

return { ROLES, ROLE_KEYS, PROGRAMS, sound, wilder, emptyTrack, euclid, rhythm, wear, blank };
})();
