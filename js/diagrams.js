/* Symvolo diagrams — Feynman diagrams, electrical circuits and quantum circuits.
   A diagram is plain data. render() draws it as SVG with KaTeX labels, latex() writes
   TikZ-Feynman, CircuiTikZ or quantikz source, and open() runs the graphical editor.
   Coordinates are in grid units; one unit is 1.25em (24 px at the default note size). */
(function () {
'use strict';
let H = null;                       // host helpers: { tex, esc, icon, toast, loadMathLive }
const UEM = 1.25, SW = .052, CM = .6; // unit in em, stroke width, unit in cm for LaTeX
const uid = () => Math.random().toString(36).slice(2, 9);
const r3 = v => Math.round(v * 1000) / 1000;
const r2 = v => Math.round(v * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- label measurement ---------- */
const mcache = new Map(); let mbox = null;
function measure(t) {
  if (!t) return { w: 0, h: 0 };
  const hit = mcache.get(t); if (hit) return hit;
  if (!mbox) { mbox = document.createElement('div'); mbox.setAttribute('aria-hidden', 'true'); mbox.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;font:19px KaTeX_Main,serif;white-space:nowrap;line-height:1'; document.body.append(mbox); }
  mbox.innerHTML = `<span class="dl" style="position:static;display:inline-block">${H.tex(t, false)}</span>`;
  const s = mbox.firstChild, m = { w: s.offsetWidth / (19 * UEM), h: s.offsetHeight / (19 * UEM) };
  if (!document.fonts || document.fonts.status === 'loaded') mcache.set(t, m);
  return m;
}
document.fonts?.addEventListener?.('loadingdone', () => mcache.clear());

/* ---------- small geometry helpers ---------- */
function BB() {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  b.add = (x, y, r = 0) => { b.x0 = Math.min(b.x0, x - r); b.y0 = Math.min(b.y0, y - r); b.x1 = Math.max(b.x1, x + r); b.y1 = Math.max(b.y1, y + r); };
  b.lab = l => { const m = measure(l.t); b.add(l.x - l.ax * m.w, l.y - l.ay * m.h); b.add(l.x + (1 - l.ax) * m.w, l.y + (1 - l.ay) * m.h); };
  return b;
}
// a label next to a point, pushed away along (nx, ny) on screen
const lab = (x, y, t, nx, ny) => ({ x, y, t, ax: nx > .38 ? 0 : nx < -.38 ? 1 : .5, ay: ny > .38 ? 0 : ny < -.38 ? 1 : .5 });
const P = pts => 'M' + pts.map(p => r3(p.x) + ' ' + r3(p.y)).join('L');
const line = (d, col, o = {}) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${r3(o.w ?? SW)}" stroke-linecap="${o.cap || 'round'}" stroke-linejoin="round"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}${o.op ? ` opacity="${o.op}"` : ''}/>`;
function arrowHead(x, y, tx, ty, col, s = 1) {
  const L = .15 * s, W = .12 * s, nx = ty, ny = -tx;
  return `<path d="${P([{ x: x + tx * L, y: y + ty * L }, { x: x - tx * L + nx * W, y: y - ty * L + ny * W }, { x: x - tx * L * .55, y: y - ty * L * .55 }, { x: x - tx * L - nx * W, y: y - ty * L - ny * W }])}Z" fill="${col}" stroke="${col}" stroke-width="${SW * .6}" stroke-linejoin="round"/>`;
}
// TikZ "bend left=θ" path from A to B, sampled by arc length (bend > 0 bulges to the left of A→B)
function curve(A, B, bend) {
  const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6, an = Math.atan2(dy, dx);
  let C = null;
  if (bend) { const th = -bend * Math.PI / 180, k = .3915 * d; C = [{ x: A.x + k * Math.cos(an + th), y: A.y + k * Math.sin(an + th) }, { x: B.x + k * Math.cos(an + Math.PI - th), y: B.y + k * Math.sin(an + Math.PI - th) }]; }
  const N = C ? 80 : 1, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push(C ? { x: u * u * u * A.x + 3 * u * u * t * C[0].x + 3 * u * t * t * C[1].x + t * t * t * B.x, y: u * u * u * A.y + 3 * u * u * t * C[0].y + 3 * u * t * t * C[1].y + t * t * t * B.y } : { x: A.x + dx * t, y: A.y + dy * t });
  }
  const cum = [0]; for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = cum[N] || 1e-6;
  const at = s => {
    if (s < 0) { const q = at(0); return { ...q, x: q.x + q.tx * s, y: q.y + q.ty * s }; }
    if (s > L) { const q = at(L); return { ...q, x: q.x + q.tx * (s - L), y: q.y + q.ty * (s - L) }; }
    let i = 1; while (i < N && cum[i] < s) i++;
    const p = pts[i - 1], q = pts[i], sl = (cum[i] - cum[i - 1]) || 1e-9, f = (s - cum[i - 1]) / sl, tx = (q.x - p.x) / sl, ty = (q.y - p.y) / sl;
    return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, tx, ty };
  };
  const d0 = C ? `M${r3(A.x)} ${r3(A.y)}C${r3(C[0].x)} ${r3(C[0].y)} ${r3(C[1].x)} ${r3(C[1].y)} ${r3(B.x)} ${r3(B.y)}` : P([A, B]);
  return { L, at, d: d0, C, A, B };
}
function photonPath(c) {
  const n = Math.max(2, Math.round(c.L / .16)), a = .1, st = n * 10, pts = [];
  for (let i = 0; i <= st; i++) { const q = c.at(c.L * i / st), o = a * Math.sin(Math.PI * n * i / st); pts.push({ x: q.x + q.ty * o, y: q.y - q.tx * o }); }
  return P(pts);
}
function gluonPath(c) {
  const n = Math.max(2, Math.round(c.L / .27)), T = 2 * Math.PI * n, v = c.L / T, R = .12, k = .1, st = n * 28, pts = [];
  for (let i = 0; i <= st; i++) { const th = T * i / st, q = c.at(v * th + k * (1 - Math.cos(th)) * Math.min(1, Math.min(th, T - th) / 1.2)), o = R * Math.sin(th); pts.push({ x: q.x + q.ty * o, y: q.y - q.tx * o }); }
  return P(pts);
}
// TikZ anchor for a label whose box hangs off the point at (ax, ay)
const anchorOf = l => ({ '0,0': 'north west', '0.5,0': 'north', '1,0': 'north east', '0,0.5': 'west', '0.5,0.5': 'center', '1,0.5': 'east', '0,1': 'south west', '0.5,1': 'south', '1,1': 'south east' })[`${l.ax},${l.ay}`];
const tz = (x, y, o) => `(${r2((x - o.x) * 1)},${r2(-(y - o.y))})`;

/* =====================================================================
   FEYNMAN DIAGRAMS
   { type:'feynman', v:[{id,x,y,style,label,lpos}], e:[{id,a,b,t,bend,label,side,mom}] }
   ===================================================================== */
const FT = {
  fermion:     { n: 'Fermion',        tz: 'fermion',        line: 'solid',  arrow: 1,  k: '1' },
  antifermion: { n: 'Antifermion',    tz: 'anti fermion',   line: 'solid',  arrow: -1, k: '2' },
  photon:      { n: 'Photon',         tz: 'photon',         line: 'photon',            k: '3' },
  gluon:       { n: 'Gluon',          tz: 'gluon',          line: 'gluon',             k: '4' },
  wboson:      { n: 'W boson',        tz: 'charged boson',  line: 'photon', arrow: 1,  k: '5' },
  scalar:      { n: 'Scalar (Higgs)', tz: 'scalar',         line: 'dash',              k: '6' },
  chscalar:    { n: 'Charged scalar', tz: 'charged scalar', line: 'dash',   arrow: 1,  k: '7' },
  ghost:       { n: 'Ghost',          tz: 'ghost',          line: 'dot',    arrow: 1,  k: '8' },
  plain:       { n: 'Plain line',     tz: 'plain',          line: 'solid',             k: '9' },
};
const VSTYLE = [['none', 'None'], ['dot', 'Dot'], ['blob', 'Blob'], ['cross', 'Cross'], ['empty', 'Ring']];
const vRad = v => v.style === 'blob' ? .42 : v.style === 'cross' ? .17 : v.style === 'empty' ? .11 : v.style === 'dot' ? .09 : 0;

function edgeGeo(d, e) {
  const A = d.v.find(v => v.id === e.a), B = d.v.find(v => v.id === e.b);
  if (!A || !B || (A.x === B.x && A.y === B.y)) return null;
  return curve(A, B, e.bend || 0);
}
function vertexAngle(d, v) {
  if (v.lpos != null && v.lpos !== 'auto') return +v.lpos;
  let mx = 0, my = 0;
  for (const e of d.e) {
    if (e.a !== v.id && e.b !== v.id) continue;
    const c = edgeGeo(d, e); if (!c) continue;
    const q = e.a === v.id ? c.at(.01) : c.at(c.L - .01), s = e.a === v.id ? 1 : -1;
    mx += q.tx * s; my += q.ty * s;
  }
  if (Math.hypot(mx, my) < .05) return 90;
  return Math.round(Math.atan2(my, -mx) / (Math.PI / 4)) * 45;   // away from the lines, snapped to 45°
}
function renderFeynman(d, o) {
  const ink = o.ink, bb = BB(), svg = [], hit = [], top = [], labels = [];
  for (const e of d.e) {
    const c = edgeGeo(d, e); if (!c) continue;
    const ty = FT[e.t] || FT.plain, col = o.sel === e.id ? o.accent : ink;
    const pd = ty.line === 'photon' ? photonPath(c) : ty.line === 'gluon' ? gluonPath(c) : c.d;
    svg.push(line(pd, col, ty.line === 'dash' ? { dash: '.22 .13', cap: 'butt' } : ty.line === 'dot' ? { dash: '.001 .13', w: SW * 1.5 } : {}));
    const m = c.at(c.L / 2);
    if (ty.arrow) { const s = ty.arrow; svg.push(arrowHead(m.x, m.y, m.tx * s, m.ty * s, col)); }
    const side = e.side || 1, nx = m.ty * side, ny = -m.tx * side, amp = ty.line === 'photon' || ty.line === 'gluon' ? .16 : .06;
    if (e.label) labels.push(lab(m.x + nx * (amp + .16), m.y + ny * (amp + .16), e.label, nx, ny));
    if (e.mom) {
      const off = -(amp + .3), pts = [];
      for (let i = 0; i <= 16; i++) { const q = c.at(c.L * (.3 + .4 * i / 16)); pts.push({ x: q.x + q.ty * side * off, y: q.y - q.tx * side * off }); }
      const q = c.at(c.L * .7);
      svg.push(line(P(pts.slice(0, -2)), col, { w: SW * .8 }), arrowHead(pts.at(-1).x - q.tx * .08, pts.at(-1).y - q.ty * .08, q.tx, q.ty, col, .8));
      labels.push(lab(m.x - nx * (amp + .48), m.y - ny * (amp + .48), e.mom, -nx, -ny));
      bb.add(m.x - nx * (amp + .4), m.y - ny * (amp + .4));
    }
    for (let i = 0; i <= 8; i++) { const q = c.at(c.L * i / 8); bb.add(q.x, q.y, amp + .05); }
    if (o.edit) {
      hit.push(`<path d="${c.d}" fill="none" stroke="transparent" stroke-width=".6" data-e="${e.id}" class="dhit"/>`);
      if (o.sel === e.id) top.push(`<circle cx="${r3(m.x)}" cy="${r3(m.y)}" r=".19" fill="${o.bg}" stroke="${o.accent}" stroke-width="${SW}" data-h="${e.id}" class="dhandle"><title>Drag to curve the line</title></circle>`);
    }
  }
  for (const v of d.v) {
    const col = o.sel === v.id ? o.accent : ink, r = vRad(v);
    if (v.style === 'dot') svg.push(`<circle cx="${v.x}" cy="${v.y}" r="${r}" fill="${col}"/>`);
    else if (v.style === 'empty') svg.push(`<circle cx="${v.x}" cy="${v.y}" r="${r}" fill="${o.bg}" stroke="${col}" stroke-width="${SW}"/>`);
    else if (v.style === 'blob') {
      const hatch = []; for (let k = -4; k <= 4; k++) { const t = k * .1; hatch.push(`M${r3(v.x + t - .6)} ${r3(v.y + .6)}L${r3(v.x + t + .6)} ${r3(v.y - .6)}`); }
      const cid = 'c' + (o.idp || '') + v.id;
      svg.push(`<clipPath id="${cid}"><circle cx="${v.x}" cy="${v.y}" r="${r}"/></clipPath><circle cx="${v.x}" cy="${v.y}" r="${r}" fill="${o.bg}"/><path d="${hatch.join('')}" stroke="${col}" stroke-width="${SW * .7}" clip-path="url(#${cid})"/><circle cx="${v.x}" cy="${v.y}" r="${r}" fill="none" stroke="${col}" stroke-width="${SW}"/>`);
    } else if (v.style === 'cross') {
      const a = r * .7071;
      svg.push(`<circle cx="${v.x}" cy="${v.y}" r="${r}" fill="${o.bg}" stroke="${col}" stroke-width="${SW}"/><path d="M${r3(v.x - a)} ${r3(v.y - a)}L${r3(v.x + a)} ${r3(v.y + a)}M${r3(v.x - a)} ${r3(v.y + a)}L${r3(v.x + a)} ${r3(v.y - a)}" stroke="${col}" stroke-width="${SW}"/>`);
    } else if (o.edit) svg.push(`<circle cx="${v.x}" cy="${v.y}" r=".075" fill="${o.sel === v.id ? o.accent : o.faint}"/>`);
    bb.add(v.x, v.y, r);
    if (v.label) {
      const a = vertexAngle(d, v) * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a), dist = r + .2;
      labels.push(lab(v.x + ux * dist, v.y + uy * dist, v.label, ux, uy));
    }
    if (o.edit) {
      if (o.sel === v.id) top.push(`<circle cx="${v.x}" cy="${v.y}" r="${Math.max(r + .1, .2)}" fill="none" stroke="${o.accent}" stroke-width="${SW}" stroke-dasharray=".08 .06"/>`);
      hit.push(`<circle cx="${v.x}" cy="${v.y}" r="${Math.max(r, .36)}" fill="transparent" data-v="${v.id}" class="dhit"/>`);
    }
  }
  labels.forEach(l => bb.lab(l));
  return { svg: svg.join(''), hit: hit.join('') + top.join(''), labels, bb };
}
function latexFeynman(d) {
  const ids = new Map(d.v.map((v, i) => [v.id, 'v' + (i + 1)]));
  const xs = d.v.map(v => v.x), ys = d.v.map(v => v.y), o = { x: Math.min(...xs), y: Math.min(...ys) };
  const st = { dot: 'dot', blob: 'blob', cross: 'crossed dot', empty: 'empty dot' };
  const out = [`\\begin{tikzpicture}[x=${CM}cm,y=${CM}cm]`, '\\begin{feynman}'];
  for (const v of d.v) {
    const opt = [];
    if (st[v.style]) opt.push(st[v.style]);
    if (v.label) opt.push(`label={${vertexAngle(d, v)}:\\(${v.label}\\)}`);
    out.push(`  \\vertex${opt.length ? ` [${opt.join(', ')}]` : ''} (${ids.get(v.id)}) at ${tz(v.x, v.y, o)}${st[v.style] ? ' {}' : ''};`);
  }
  const es = d.e.filter(e => edgeGeo(d, e));
  if (es.length) {
    out.push('  \\diagram* {');
    es.forEach((e, i) => {
      const ty = FT[e.t] || FT.plain, opt = [ty.tz], side = e.side || 1;
      if (e.bend) opt.push(`bend ${e.bend > 0 ? 'left' : 'right'}=${Math.abs(Math.round(e.bend))}`);
      if (e.label) opt.push(`edge label${side > 0 ? '' : "'"}={\\(${e.label}\\)}`);
      if (e.mom) opt.push(`momentum${side > 0 ? "'" : ''}={\\(${e.mom}\\)}`);
      out.push(`    (${ids.get(e.a)}) -- [${opt.join(', ')}] (${ids.get(e.b)})${i < es.length - 1 ? ',' : ''}`);
    });
    out.push('  };');
  }
  out.push('\\end{feynman}', '\\end{tikzpicture}');
  return out.join('\n');
}

/* =====================================================================
   ELECTRICAL CIRCUITS
   { type:'circuit', rstyle:'american'|'european', el:[{id,t,a:{x,y},b:{x,y},label,side,i}], pt:[{id,t,x,y,label,lpos}] }
   ===================================================================== */
const CT = {
  wire: { n: 'Wire',           len: 0,   h: .05, tz: 'short',  k: 'w' },
  R:    { n: 'Resistor',       len: 1.5, h: .24, tz: s => s === 'european' ? 'european resistor' : 'american resistor', k: 'r' },
  C:    { n: 'Capacitor',      len: .36, h: .52, tz: 'capacitor', k: 'c' },
  L:    { n: 'Inductor',       len: 1.6, h: .24, tz: s => s === 'european' ? 'european inductor' : 'american inductor', k: 'l' },
  V:    { n: 'Voltage source', len: 1.14, h: .57, tz: 'american voltage source', k: 'u' },
  I:    { n: 'Current source', len: 1.14, h: .57, tz: 'american current source', k: 'i' },
  bat:  { n: 'Battery',        len: .2,  h: .37, tz: 'battery1', k: 'b' },
  D:    { n: 'Diode',          len: .74, h: .42, tz: 'full diode', k: 'd' },
  led:  { n: 'LED',            len: .74, h: .62, tz: 'full led', k: 'e' },
  sw:   { n: 'Switch',         len: 1,   h: .4,  tz: 'nos', k: 's' },
  lamp: { n: 'Lamp',           len: 1.1, h: .55, tz: 'lamp', k: 'p' },
  A:    { n: 'Ammeter',        len: 1.1, h: .55, tz: 'ammeter', k: 'a' },
  Vm:   { n: 'Voltmeter',      len: 1.1, h: .55, tz: 'voltmeter', k: 'v' },
};
const CPT = { ground: { n: 'Ground', tz: 'ground', k: 'g' }, dot: { n: 'Junction', tz: 'circ', k: 'j' }, term: { n: 'Terminal', tz: 'ocirc', k: 't' } };
// symbol in its own frame: centred at 0, running along +x, stroke width sw
function sym(t, style, col, bg, sw) {
  const L = (d, w = sw, cap = 'round') => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${r3(w)}" stroke-linecap="${cap}" stroke-linejoin="round"/>`;
  const circ = r => `<circle r="${r}" fill="${bg}" stroke="${col}" stroke-width="${sw}"/>`;
  switch (t) {
    case 'R': return style === 'european' ? `<rect x="-.72" y="-.22" width="1.44" height=".44" fill="${bg}" stroke="${col}" stroke-width="${sw}"/>` : L('M-.75 0L-.625 -.24L-.375 .24L-.125 -.24L.125 .24L.375 -.24L.625 .24L.75 0');
    case 'C': return L('M-.18 -.52V.52M.18 -.52V.52');
    case 'L': return style === 'european' ? `<rect x="-.75" y="-.2" width="1.5" height=".4" fill="${col}"/>` : L('M-.8 0A.2 .2 0 0 1 -.4 0A.2 .2 0 0 1 0 0A.2 .2 0 0 1 .4 0A.2 .2 0 0 1 .8 0');
    case 'V': return circ(.57) + L('M.15 0H.41M.28 -.13V.13M-.28 -.12V.12');
    case 'I': return circ(.57) + L('M-.32 0H.22') + `<path d="M.36 0L.16 -.12L.16 .12Z" fill="${col}"/>`;
    case 'bat': return L('M.1 -.37V.37') + L('M-.1 -.19V.19', sw * 2.4, 'butt');
    case 'D': return `<path d="M-.37 -.42L-.37 .42L.37 0Z" fill="${col}" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round"/>` + L('M.37 -.42V.42');
    case 'led': return sym('D', style, col, bg, sw) + L('M0 -.48L.22 -.72M.22 -.48L.44 -.72') + `<path d="M.29 -.8L.15 -.74L.26 -.64ZM.51 -.8L.37 -.74L.48 -.64Z" fill="${col}"/>`;
    case 'sw': return L('M-.5 0L.42 -.36');
    case 'lamp': return circ(.55) + L('M-.39 -.39L.39 .39M-.39 .39L.39 -.39');
    case 'A': case 'Vm': return circ(.55) + L('M-.45 .45L.36 -.36') + `<path d="M.45 -.45L.25 -.37L.37 -.25Z" fill="${col}"/>`;
    default: return '';
  }
}
const meterLetter = (t, col, sw) => `<path d="${t === 'A' ? 'M-.16 .22L0 -.22L.16 .22M-.1 .07H.1' : 'M-.16 -.22L0 .22L.16 -.22'}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ckey = p => `${r2(p.x)},${r2(p.y)}`;
function junctions(d) {
  const n = new Map();
  for (const e of d.el) for (const p of [e.a, e.b]) n.set(ckey(p), (n.get(ckey(p)) || 0) + 1);
  const out = [];
  for (const [k, c] of n) {
    const [x, y] = k.split(',').map(Number);
    let cnt = c;
    for (const w of d.el) {                       // an end landing in the middle of a wire is a T-junction
      if (w.t !== 'wire') continue;
      const ax = w.a.x, ay = w.a.y, bx = w.b.x, by = w.b.y, cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax), dot = (x - ax) * (bx - ax) + (y - ay) * (by - ay), l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (Math.abs(cr) < 1e-6 && dot > 1e-6 && dot < l2 - 1e-6) cnt += 2;
    }
    if (cnt >= 3 && !d.pt.some(p => p.t === 'dot' && ckey(p) === k)) out.push({ x, y });
  }
  return out;
}
function defSide(a, b) { const dx = b.x - a.x, dy = b.y - a.y; return (Math.abs(dx) > .01 ? dx > 0 : dy < 0) ? 1 : -1; }
function elGeo(e) {
  const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, D = Math.hypot(dx, dy);
  return { dx, dy, D, ux: dx / (D || 1), uy: dy / (D || 1), ang: Math.atan2(dy, dx) * 180 / Math.PI, mx: (e.a.x + e.b.x) / 2, my: (e.a.y + e.b.y) / 2 };
}
function elLabels(e) {
  const t = CT[e.t] || CT.wire, g = elGeo(e), side = e.side || defSide(e.a, e.b), nx = g.uy * side, ny = -g.ux * side, out = [];
  const s = t.len ? Math.min(1, g.D / (t.len + .3)) : 1, h = t.h * s + .18;
  if (e.label) out.push(lab(g.mx + nx * h, g.my + ny * h, e.label, nx, ny));
  if (e.i) {
    const at = t.len ? (t.len * s / 2 + g.D / 2) / 2 : g.D * .25, x = g.mx + g.ux * at, y = g.my + g.uy * at;
    out.push({ ...lab(x + nx * .26, y + ny * .26, e.i, nx, ny), arrow: { x, y, tx: g.ux, ty: g.uy } });
  }
  return out;
}
function ptLabel(p) {
  if (!p.label) return null;
  const a = (p.lpos == null || p.lpos === 'auto' ? (p.t === 'ground' ? 0 : 180) : +p.lpos) * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a);
  const dist = p.t === 'ground' ? .55 : .2, cy = p.t === 'ground' ? p.y + .35 : p.y;
  return lab(p.x + ux * dist, cy + uy * (p.t === 'ground' ? .3 : dist), p.label, ux, uy);
}
function renderCircuit(d, o) {
  const bb = BB(), svg = [], hit = [], top = [], labels = [], style = d.rstyle || 'american';
  for (const e of d.el) {
    const t = CT[e.t] || CT.wire, g = elGeo(e); if (g.D < 1e-6) continue;
    const col = o.sel === e.id ? o.accent : o.ink;
    if (!t.len) svg.push(line(P([e.a, e.b]), col));
    else {
      const s = Math.min(1, g.D / (t.len + .3)), hl = t.len * s / 2;
      let inner = sym(e.t, style, col, o.bg, SW / s);
      if (e.t === 'A' || e.t === 'Vm') inner += `<g transform="rotate(${r2(-g.ang)})">${meterLetter(e.t, col, SW / s)}</g>`;
      svg.push(`<g transform="translate(${r3(g.mx)} ${r3(g.my)}) rotate(${r2(g.ang)})">${line(`M${r3(-g.D / 2)} 0H${r3(-hl)}M${r3(hl)} 0H${r3(g.D / 2)}`, col)}<g transform="scale(${r3(s)})">${inner}</g></g>`);
    }
    for (const l of elLabels(e)) { labels.push(l); if (l.arrow) svg.push(arrowHead(l.arrow.x, l.arrow.y, l.arrow.tx, l.arrow.ty, col, .9)); }
    const s = t.len ? Math.min(1, g.D / (t.len + .3)) : 1;
    bb.add(e.a.x, e.a.y, .1); bb.add(e.b.x, e.b.y, .1); bb.add(g.mx + g.uy * t.h * s, g.my - g.ux * t.h * s); bb.add(g.mx - g.uy * t.h * s, g.my + g.ux * t.h * s);
    if (e.t === 'led') bb.add(g.mx, g.my, .85);
    if (o.edit) {
      hit.push(`<path d="${P([e.a, e.b])}" stroke="transparent" stroke-width="${Math.max(.6, t.h * 2)}" data-e="${e.id}" class="dhit"/>`);
      if (o.sel === e.id && o.handles) for (const k of ['a', 'b']) top.push(`<circle cx="${e[k].x}" cy="${e[k].y}" r=".17" fill="${o.bg}" stroke="${o.accent}" stroke-width="${SW}" data-end="${k}" class="dhandle"><title>Drag to move this end</title></circle>`);
    }
  }
  if (o.edit) { const ends = new Set(); for (const e of d.el) for (const p of [e.a, e.b]) ends.add(ckey(p)); for (const k of ends) { const [x, y] = k.split(',').map(Number); svg.push(`<circle cx="${x}" cy="${y}" r=".06" fill="${o.faint}"/>`); } }
  for (const j of junctions(d)) svg.push(`<circle cx="${j.x}" cy="${j.y}" r=".1" fill="${o.ink}"/>`);
  for (const p of d.pt) {
    const col = o.sel === p.id ? o.accent : o.ink;
    if (p.t === 'ground') { svg.push(line(`M${p.x} ${p.y}V${p.y + .3}M${p.x - .32} ${p.y + .3}H${p.x + .32}M${p.x - .2} ${p.y + .42}H${p.x + .2}M${p.x - .08} ${p.y + .54}H${p.x + .08}`, col)); bb.add(p.x, p.y + .3, .35); }
    else if (p.t === 'dot') { svg.push(`<circle cx="${p.x}" cy="${p.y}" r=".1" fill="${col}"/>`); bb.add(p.x, p.y, .1); }
    else { svg.push(`<circle cx="${p.x}" cy="${p.y}" r=".11" fill="${o.bg}" stroke="${col}" stroke-width="${SW}"/>`); bb.add(p.x, p.y, .12); }
    const l = ptLabel(p); if (l) labels.push(l);
    if (o.edit) {
      if (o.sel === p.id) top.push(`<circle cx="${p.x}" cy="${p.y}" r=".24" fill="none" stroke="${o.accent}" stroke-width="${SW}" stroke-dasharray=".08 .06"/>`);
      hit.push(`<circle cx="${p.x}" cy="${p.t === 'ground' ? p.y + .2 : p.y}" r=".4" fill="transparent" data-p="${p.id}" class="dhit"/>`);
    }
  }
  labels.forEach(l => bb.lab(l));
  return { svg: svg.join(''), hit: hit.join('') + top.join(''), labels, bb };
}
function latexCircuit(d) {
  const all = [...d.el.flatMap(e => [e.a, e.b]), ...d.pt]; if (!all.length) return '';
  const o = { x: Math.min(...all.map(p => p.x)), y: Math.min(...all.map(p => p.y)) }, style = d.rstyle || 'american';
  const out = [`\\begin{circuitikz}[x=${CM}cm,y=${CM}cm]`, '  \\ctikzset{bipoles/length=1.1cm}'];
  for (const e of d.el) {
    if (elGeo(e).D < 1e-6) continue;
    const t = CT[e.t] || CT.wire, name = typeof t.tz === 'function' ? t.tz(style) : t.tz;
    const [p, q] = e.t === 'V' || e.t === 'bat' ? [e.b, e.a] : [e.a, e.b];   // CircuiTikZ puts + at the start of the path; Symvolo at the end
    out.push(`  \\draw ${tz(p.x, p.y, o)} to[${name}] ${tz(q.x, q.y, o)};`);
  }
  for (const j of junctions(d)) out.push(`  \\draw ${tz(j.x, j.y, o)} node[circ]{};`);
  for (const p of d.pt) out.push(`  \\draw ${tz(p.x, p.y, o)} node[${CPT[p.t].tz}]{};`);
  const labels = [...d.el.flatMap(elLabels), ...d.pt.map(ptLabel).filter(Boolean)];
  for (const e of d.el) for (const l of elLabels(e)) if (l.arrow) { const a = l.arrow; out.push(`  \\draw[-{Latex[length=1.8mm]}] ${tz(a.x - a.tx * .2, a.y - a.ty * .2, o)} -- ${tz(a.x + a.tx * .15, a.y + a.ty * .15, o)};`); }
  for (const l of labels) out.push(`  \\node[anchor=${anchorOf(l)}, inner sep=1pt] at ${tz(l.x, l.y, o)} {$${l.t}$};`);
  out.push('\\end{circuitikz}');
  return out.join('\n');
}

/* =====================================================================
   QUANTUM CIRCUITS
   { type:'quantum', n, inL:[], outL:[], g:[{id,r,c,t,p,span}], bar:[c...] }
   ===================================================================== */
const QT = {
  H:    { n: 'Hadamard', lbl: () => 'H', k: 'h' },
  X:    { n: 'Pauli X', lbl: () => 'X', k: 'x' },
  Y:    { n: 'Pauli Y', lbl: () => 'Y', k: 'y' },
  Z:    { n: 'Pauli Z', lbl: () => 'Z', k: 'z' },
  S:    { n: 'Phase S', lbl: () => 'S', k: 's' },
  T:    { n: 'T gate', lbl: () => 'T', k: 't' },
  Sdg:  { n: 'S dagger', lbl: () => 'S^\\dagger' },
  Tdg:  { n: 'T dagger', lbl: () => 'T^\\dagger' },
  Rx:   { n: 'Rotation X', lbl: p => `R_x(${p || '\\theta'})`, param: '\\theta' },
  Ry:   { n: 'Rotation Y', lbl: p => `R_y(${p || '\\theta'})`, param: '\\theta' },
  Rz:   { n: 'Rotation Z', lbl: p => `R_z(${p || '\\theta'})`, param: '\\theta' },
  P:    { n: 'Phase P', lbl: p => `P(${p || '\\varphi'})`, param: '\\varphi' },
  U:    { n: 'Custom gate', lbl: p => p || 'U', custom: true, k: 'u' },
  box:  { n: 'Multi-qubit gate', lbl: p => p || 'U', custom: true, multi: true, k: 'b' },
  meas: { n: 'Measure', k: 'm' },
  ctrl: { n: 'Control', k: 'c' },
  octrl:{ n: 'Open control', k: 'o' },
  targ: { n: 'Target ⊕', k: 'n' },
  swap: { n: 'Swap', k: 'w' },
  bar:  { n: 'Barrier', k: 'r' },
};
const isBox = t => !!QT[t]?.lbl;
const qLabel = g => QT[g.t].lbl(g.p);
function qLayout(d, cols) {
  const lw = Math.max(0, ...d.inL.map(t => measure(t).w)), xs = lw ? lw + .55 : .4;
  const used = Math.max(-1, ...d.g.map(g => g.c), ...d.bar) + 1, nc = Math.max(cols || 0, used);
  const colW = Array.from({ length: nc }, () => .9);
  for (const g of d.g) { const w = isBox(g.t) ? Math.max(.9, measure(qLabel(g)).w + .45) : g.t === 'meas' ? 1 : g.t === 'targ' ? .5 : .4; colW[g.c] = Math.max(colW[g.c], w); }
  const cx = []; let x = xs + .25;
  for (let c = 0; c < nc; c++) { const w = colW[c] + .45; cx.push(x + w / 2); colW[c] = w; x += w; }
  const rowY = Array.from({ length: d.n }, (_, r) => .75 + r * 1.35);
  return { xs, xe: x + .3, cx, colW, rowY, nc, lw };
}
function covering(d, r, c) { return d.g.find(g => g.c === c && r >= g.r && r < g.r + (g.t === 'box' ? g.span || 2 : 1)); }
function renderQuantum(d, o) {
  const Lo = qLayout(d, o.cols), { cx, colW, rowY, xs, xe } = Lo, ink = o.ink, svg = [], over = [], hit = [], labels = [], bb = BB();
  // wires (double after a measurement)
  for (let r = 0; r < d.n; r++) {
    const y = rowY[r], m = d.g.filter(g => g.t === 'meas' && g.r === r).sort((a, b) => a.c - b.c)[0], xm = m ? cx[m.c] : xe;
    svg.push(line(`M${r3(xs)} ${y}H${r3(xm)}`, ink));
    if (m) svg.push(line(`M${r3(xm)} ${r3(y - .05)}H${r3(xe)}M${r3(xm)} ${r3(y + .05)}H${r3(xe)}`, ink, { w: SW * .8 }));
    if (d.inL[r]) labels.push({ x: xs - .2, y, t: d.inL[r], ax: 1, ay: .5 });
    if (d.outL[r]) labels.push({ x: xe + .2, y, t: d.outL[r], ax: 0, ay: .5 });
    bb.add(xs, y - .5); bb.add(xe, y + .5);
  }
  // vertical connections per column
  for (let c = 0; c < Lo.nc; c++) {
    const items = d.g.filter(g => g.c === c); if (items.length < 2) continue;
    const ctl = items.some(g => g.t === 'ctrl' || g.t === 'octrl'), sw = items.filter(g => g.t === 'swap');
    if (!ctl && sw.length < 2) continue;
    const rows = items.flatMap(g => g.t === 'box' ? [g.r, g.r + (g.span || 2) - 1] : [g.r]);
    svg.push(line(`M${r3(cx[c])} ${rowY[Math.min(...rows)]}V${rowY[Math.max(...rows)]}`, items.some(g => o.sel === g.id) ? o.accent : ink));
  }
  for (const c of d.bar) if (c < Lo.nc) { const x = cx[c] + colW[c] / 2; svg.push(line(`M${r3(x)} ${r3(rowY[0] - .6)}V${r3(rowY.at(-1) + .6)}`, o.sel === 'bar' + c ? o.accent : ink, { dash: '.16 .11', w: SW * .9, op: .75 })); }
  for (const g of d.g) {
    if (g.c >= Lo.nc) continue;
    const x = cx[g.c], y = rowY[g.r], col = o.sel === g.id ? o.accent : ink;
    if (isBox(g.t)) {
      const span = g.t === 'box' ? clamp(g.span || 2, 1, d.n - g.r) : 1, y1 = rowY[g.r + span - 1], w = Math.max(.9, measure(qLabel(g)).w + .45);
      over.push(`<rect x="${r3(x - w / 2)}" y="${r3(y - .45)}" width="${r3(w)}" height="${r3(y1 - y + .9)}" rx=".06" fill="${o.bg}" stroke="${col}" stroke-width="${SW}"/>`);
      labels.push({ x, y: (y + y1) / 2, t: qLabel(g), ax: .5, ay: .5, col: o.sel === g.id ? o.accent : null });
    } else if (g.t === 'meas') {
      over.push(`<rect x="${r3(x - .5)}" y="${r3(y - .42)}" width="1" height=".84" rx=".06" fill="${o.bg}" stroke="${col}" stroke-width="${SW}"/>` + line(`M${r3(x - .3)} ${r3(y + .2)}A.3 .3 0 0 1 ${r3(x + .3)} ${r3(y + .2)}M${r3(x)} ${r3(y + .22)}L${r3(x + .24)} ${r3(y - .24)}`, col));
    } else if (g.t === 'ctrl') over.push(`<circle cx="${r3(x)}" cy="${y}" r=".11" fill="${col}"/>`);
    else if (g.t === 'octrl') over.push(`<circle cx="${r3(x)}" cy="${y}" r=".11" fill="${o.bg}" stroke="${col}" stroke-width="${SW}"/>`);
    else if (g.t === 'targ') over.push(`<circle cx="${r3(x)}" cy="${y}" r=".22" fill="${o.bg}" stroke="${col}" stroke-width="${SW}"/>` + line(`M${r3(x - .22)} ${y}H${r3(x + .22)}M${r3(x)} ${r3(y - .22)}V${r3(y + .22)}`, col));
    else if (g.t === 'swap') over.push(line(`M${r3(x - .14)} ${r3(y - .14)}L${r3(x + .14)} ${r3(y + .14)}M${r3(x - .14)} ${r3(y + .14)}L${r3(x + .14)} ${r3(y - .14)}`, col));
  }
  if (o.edit) {
    if (o.hover) { const { r, c, span = 1 } = o.hover; if (c >= 0 && c < Lo.nc) hit.push(`<rect x="${r3(cx[c] - colW[c] / 2 + .06)}" y="${r3(rowY[r] - .6)}" width="${r3(colW[c] - .12)}" height="${r3(rowY[Math.min(d.n - 1, r + span - 1)] - rowY[r] + 1.2)}" rx=".12" fill="${o.accent}" fill-opacity=".1" stroke="${o.accent}" stroke-width="${SW * .8}" stroke-dasharray=".1 .08"/>`); }
    if (typeof o.sel === 'string' && o.sel.startsWith('row')) { const r = +o.sel.slice(3); hit.push(`<rect x="${r3(Math.max(.05, xs - Lo.lw - .4))}" y="${r3(rowY[r] - .55)}" width="${r3(xe - xs + Lo.lw + .45)}" height="1.1" rx=".14" fill="none" stroke="${o.accent}" stroke-width="${SW}" stroke-dasharray=".1 .08"/>`); }
  }
  labels.forEach(l => bb.lab(l));
  return { svg: svg.join('') + over.join(''), hit: hit.join(''), labels, bb, layout: Lo };
}
function latexQuantum(d) {
  const used = Math.max(-1, ...d.g.map(g => g.c), ...d.bar) + 1, anyOut = d.outL.some(Boolean), rows = [];
  for (let r = 0; r < d.n; r++) {
    const cells = [d.inL[r] ? `\\lstick{$${d.inL[r]}$}` : '\\qw']; let meas = false;
    for (let c = 0; c < used; c++) {
      const g = d.g.find(g => g.c === c && g.r === r), cov = !g && covering(d, r, c);
      let s;
      if (g) {
        const col = d.g.filter(x => x.c === c && x !== g), far = col.length ? col.reduce((a, b) => Math.abs(b.r - r) > Math.abs(a.r - r) ? b : a) : null;
        if (isBox(g.t)) s = g.t === 'box' && (g.span || 2) > 1 ? `\\gate[wires=${clamp(g.span || 2, 1, d.n - r)}]{${qLabel(g)}}` : `\\gate{${qLabel(g)}}`;
        else if (g.t === 'meas') { s = '\\meter{}'; meas = true; }
        else if (g.t === 'ctrl' || g.t === 'octrl') s = far ? `\\${g.t}{${far.r - r}}` : `\\${g.t === 'ctrl' ? 'ctrl' : 'octrl'}{0}`;
        else if (g.t === 'targ') s = '\\targ{}';
        else if (g.t === 'swap') { const o = col.find(x => x.t === 'swap'); s = o && o.r > r ? `\\swap{${o.r - r}}` : o ? '\\targX{}' : '\\qw'; }
      } else s = cov ? '\\qw' : meas ? '\\cw' : '\\qw';
      if (r === 0 && d.bar.includes(c)) s += ' \\slice{}';
      cells.push(s);
    }
    cells.push((meas ? '\\cw' : '\\qw') + (anyOut && d.outL[r] ? ` \\rstick{$${d.outL[r]}$}` : ''));
    rows.push('  ' + cells.join(' & '));
  }
  return `\\begin{quantikz}\n${rows.join(' \\\\\n')}\n\\end{quantikz}`;
}

/* ---------- public: render / html / latex ---------- */
const TYPES = {
  feynman: { name: 'Feynman diagram', render: renderFeynman, latex: latexFeynman, pkg: 'feynman' },
  circuit: { name: 'Electrical circuit', render: renderCircuit, latex: latexCircuit, pkg: 'circuit' },
  quantum: { name: 'Quantum circuit', render: renderQuantum, latex: latexQuantum, pkg: 'quantum' },
};
function blank(type) {
  if (type === 'feynman') return { type, v: [], e: [] };
  if (type === 'circuit') return { type, rstyle: 'american', el: [], pt: [] };
  return { type: 'quantum', n: 3, inL: ['\\ket{0}', '\\ket{0}', '\\ket{0}'], outL: ['', '', ''], g: [], bar: [] };
}
function isEmpty(d) { return d.type === 'feynman' ? !d.e.length && !d.v.some(v => v.label || v.style !== 'none') : d.type === 'circuit' ? !d.el.length && !d.pt.length : !d.g.length; }
function labelsHTML(labels, ox, oy, ink) {
  return labels.map(l => `<span class="dl" style="left:${r3((l.x - ox) * UEM)}em;top:${r3((l.y - oy) * UEM)}em;transform:translate(${-l.ax * 100}%,${-l.ay * 100}%);color:${l.col || ink}">${H.tex(l.t, false)}</span>`).join('');
}
let idn = 0;
function html(d, o) {
  const T = TYPES[d.type]; if (!T) return '';
  const r = T.render(d, { ink: o.ink, bg: o.bg, idp: 'b' + (idn++) + '_' });
  let { x0, y0, x1, y1 } = r.bb;
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 4; y1 = 2; }
  const pad = .25; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const w = x1 - x0, h = y1 - y0;
  return `<div class="dia" role="img" aria-label="${esc(T.name)}" style="width:${r3(w * UEM)}em;height:${r3(h * UEM)}em"><svg viewBox="${r3(x0)} ${r3(y0)} ${r3(w)} ${r3(h)}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" overflow="visible">${r.svg}</svg>${labelsHTML(r.labels, x0, y0, o.ink)}</div>`;
}
function latex(d) { const T = TYPES[d.type]; return T ? { code: T.latex(d), pkg: T.pkg } : { code: '', pkg: null }; }
function preamble(pkgs) {
  const out = [];
  if (pkgs.size) out.push('\\usepackage{tikz}');
  if (pkgs.has('feynman')) out.push('\\usepackage[compat=1.1.0]{tikz-feynman}', '\\tikzfeynmanset{warn luatex=false}');
  if (pkgs.has('circuit')) out.push('\\usepackage{circuitikz}', '\\usetikzlibrary{arrows.meta}');
  if (pkgs.has('quantum')) out.push('\\usepackage{quantikz}');
  return out.join('\n');
}

/* ---------- examples ---------- */
const V = (id, x, y, label = '', style = 'none', lpos = 'auto') => ({ id, x, y, label, style, lpos });
const E = (a, b, t, label = '', o = {}) => ({ id: uid(), a, b, t, bend: 0, label, side: 1, mom: '', ...o });
const EXAMPLES = {
  feynman: [
    ['e⁺e⁻ → μ⁺μ⁻', () => ({ type: 'feynman', v: [V('a', 0, 0, 'e^-'), V('b', 0, 4, 'e^+'), V('c', 2, 2), V('d', 5, 2), V('f', 7, 0, '\\mu^-'), V('g', 7, 4, '\\mu^+')],
      e: [E('a', 'c', 'fermion'), E('c', 'b', 'fermion'), E('c', 'd', 'photon', '\\gamma'), E('g', 'd', 'fermion'), E('d', 'f', 'fermion')] })],
    ['Compton scattering', () => ({ type: 'feynman', v: [V('a', 0, 4, 'e^-'), V('b', 0, 0, '\\gamma'), V('c', 2, 2), V('d', 5, 2), V('f', 7, 4, 'e^-'), V('g', 7, 0, '\\gamma')],
      e: [E('a', 'c', 'fermion'), E('b', 'c', 'photon'), E('c', 'd', 'fermion', 'e^-'), E('d', 'f', 'fermion'), E('d', 'g', 'photon')] })],
    ['Electron self-energy', () => ({ type: 'feynman', v: [V('a', 0, 2), V('b', 2, 2), V('c', 5, 2), V('d', 7, 2)],
      e: [E('a', 'b', 'fermion', 'p'), E('b', 'c', 'fermion', 'p-k', { side: -1 }), E('c', 'd', 'fermion', 'p'), E('b', 'c', 'photon', 'k', { bend: 90 })] })],
    ['Vacuum polarisation', () => ({ type: 'feynman', v: [V('a', 0, 2), V('b', 2, 2, '', 'dot'), V('c', 5, 2, '', 'dot'), V('d', 7, 2)],
      e: [E('a', 'b', 'photon', 'q'), E('b', 'c', 'fermion', '', { bend: 80 }), E('c', 'b', 'fermion', '', { bend: 80 }), E('c', 'd', 'photon', 'q')] })],
    ['Gluon exchange', () => ({ type: 'feynman', v: [V('a', 0, 0, 'q'), V('b', 3, 0), V('c', 6, 0, 'q'), V('d', 0, 4, '\\bar q'), V('e', 3, 4), V('f', 6, 4, '\\bar q')],
      e: [E('a', 'b', 'fermion'), E('b', 'c', 'fermion'), E('e', 'd', 'fermion'), E('f', 'e', 'fermion'), E('b', 'e', 'gluon', 'g')] })],
  ],
  circuit: [
    ['RC low-pass filter', () => { const W = (ax, ay, bx, by, t = 'wire', label = '', side) => ({ id: uid(), t, a: { x: ax, y: ay }, b: { x: bx, y: by }, label, side: side ?? defSide({ x: ax, y: ay }, { x: bx, y: by }), i: '' });
      return { type: 'circuit', rstyle: 'american', el: [W(0, 0, 4, 0, 'R', 'R'), W(4, 0, 7, 0), W(4, 0, 4, 3, 'C', 'C', -1), W(0, 3, 7, 3)], pt: [{ id: uid(), t: 'term', x: 0, y: 0, label: 'U_\\text{in}', lpos: 'auto' }, { id: uid(), t: 'term', x: 7, y: 0, label: 'U_\\text{out}', lpos: 0 }, { id: uid(), t: 'term', x: 0, y: 3, label: '', lpos: 'auto' }, { id: uid(), t: 'term', x: 7, y: 3, label: '', lpos: 'auto' }] }; }],
    ['Voltage divider', () => { const W = (ax, ay, bx, by, t = 'wire', label = '', side) => ({ id: uid(), t, a: { x: ax, y: ay }, b: { x: bx, y: by }, label, side: side ?? defSide({ x: ax, y: ay }, { x: bx, y: by }), i: '' });
      return { type: 'circuit', rstyle: 'american', el: [W(0, 5, 0, 0, 'V', 'U_0'), W(0, 0, 4, 0), W(4, 0, 4, 2.5, 'R', 'R_1', -1), W(4, 2.5, 4, 5, 'R', 'R_2', -1), W(4, 5, 0, 5), W(4, 2.5, 6, 2.5)], pt: [{ id: uid(), t: 'term', x: 6, y: 2.5, label: 'U_2', lpos: 0 }] }; }],
    ['RLC series circuit', () => { const W = (ax, ay, bx, by, t = 'wire', label = '', side, i = '') => ({ id: uid(), t, a: { x: ax, y: ay }, b: { x: bx, y: by }, label, side: side ?? defSide({ x: ax, y: ay }, { x: bx, y: by }), i });
      return { type: 'circuit', rstyle: 'american', el: [W(0, 4, 0, 0, 'V', 'U(t)'), W(0, 0, 4, 0, 'R', 'R', undefined, 'I'), W(4, 0, 8, 0, 'L', 'L'), W(8, 0, 8, 4, 'C', 'C', -1), W(8, 4, 0, 4)], pt: [] }; }],
  ],
  quantum: [
    ['Bell state', () => ({ type: 'quantum', n: 2, inL: ['\\ket{0}', '\\ket{0}'], outL: ['', ''], bar: [], g: [{ id: uid(), r: 0, c: 0, t: 'H' }, { id: uid(), r: 0, c: 1, t: 'ctrl' }, { id: uid(), r: 1, c: 1, t: 'targ' }, { id: uid(), r: 0, c: 2, t: 'meas' }, { id: uid(), r: 1, c: 2, t: 'meas' }] })],
    ['GHZ state', () => ({ type: 'quantum', n: 3, inL: ['\\ket{0}', '\\ket{0}', '\\ket{0}'], outL: ['', '', ''], bar: [], g: [{ id: uid(), r: 0, c: 0, t: 'H' }, { id: uid(), r: 0, c: 1, t: 'ctrl' }, { id: uid(), r: 1, c: 1, t: 'targ' }, { id: uid(), r: 1, c: 2, t: 'ctrl' }, { id: uid(), r: 2, c: 2, t: 'targ' }] })],
    ['Teleportation', () => ({ type: 'quantum', n: 3, inL: ['\\ket{\\psi}', '\\ket{0}', '\\ket{0}'], outL: ['', '', '\\ket{\\psi}'], bar: [2],
      g: [{ id: uid(), r: 1, c: 0, t: 'H' }, { id: uid(), r: 1, c: 1, t: 'ctrl' }, { id: uid(), r: 2, c: 1, t: 'targ' }, { id: uid(), r: 0, c: 2, t: 'ctrl' }, { id: uid(), r: 1, c: 2, t: 'targ' }, { id: uid(), r: 0, c: 3, t: 'H' },
        { id: uid(), r: 0, c: 4, t: 'meas' }, { id: uid(), r: 1, c: 4, t: 'meas' }, { id: uid(), r: 1, c: 5, t: 'ctrl' }, { id: uid(), r: 2, c: 5, t: 'X' }, { id: uid(), r: 0, c: 6, t: 'ctrl' }, { id: uid(), r: 2, c: 6, t: 'Z' }] })],
    ['Quantum Fourier transform (3)', () => ({ type: 'quantum', n: 3, inL: ['q_0', 'q_1', 'q_2'], outL: ['', '', ''], bar: [],
      g: [{ id: uid(), r: 0, c: 0, t: 'H' }, { id: uid(), r: 0, c: 1, t: 'P', p: '\\tfrac{\\pi}{2}' }, { id: uid(), r: 1, c: 1, t: 'ctrl' }, { id: uid(), r: 0, c: 2, t: 'P', p: '\\tfrac{\\pi}{4}' }, { id: uid(), r: 2, c: 2, t: 'ctrl' },
        { id: uid(), r: 1, c: 3, t: 'H' }, { id: uid(), r: 1, c: 4, t: 'P', p: '\\tfrac{\\pi}{2}' }, { id: uid(), r: 2, c: 4, t: 'ctrl' }, { id: uid(), r: 2, c: 5, t: 'H' }, { id: uid(), r: 0, c: 6, t: 'swap' }, { id: uid(), r: 2, c: 6, t: 'swap' }] })],
  ],
};

/* =====================================================================
   EDITOR
   ===================================================================== */
const CSS = `
.dov{position:fixed;inset:0;z-index:70;background:rgba(10,12,18,.42);display:grid;place-items:center;padding:14px}
.dwin{width:min(1240px,100%);height:min(820px,100%);background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden;color:var(--fg)}
.dhd{display:flex;align-items:center;gap:6px;padding:10px 10px 10px 16px;border-bottom:1px solid var(--line)}
.dhd h2{margin:0;font-size:16.5px;font-weight:650;letter-spacing:-.01em;display:flex;align-items:center;gap:9px}
.dhd h2 svg{color:var(--accent)}
.dmain{flex:1;display:flex;min-height:0}
.dpal{width:208px;flex:none;overflow:auto;padding:10px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:3px;overscroll-behavior:contain}
.dpal .lbl{font-size:12px;color:var(--subtle);padding:8px 6px 3px}
.dpi{display:flex;align-items:center;gap:10px;width:100%;min-height:38px;padding:4px 8px;border:1px solid transparent;border-radius:9px;background:none;color:var(--fg);cursor:pointer;text-align:left;font-size:13.5px;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.dpi:hover{background:var(--panel-2)}
.dpi[aria-pressed=true]{background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 35%,transparent);color:var(--accent)}
.dpi .ico{width:46px;height:26px;flex:none;display:grid;place-items:center;color:var(--fg)}
.dpi[aria-pressed=true] .ico{color:var(--accent)}
.dpi .ico svg{width:46px;height:26px;overflow:visible}
.dpi .ico svg.i{width:18px;height:18px}
.dpi .qg{min-width:30px;height:24px;padding:0 5px;border:1.5px solid currentColor;border-radius:4px;display:grid;place-items:center;font:14px KaTeX_Main,serif;background:var(--panel)}
.dpi kbd{margin-left:auto;font:500 11px var(--mono);color:var(--subtle)}
.dpgrid{display:grid;grid-template-columns:1fr 1fr;gap:3px}
.dpgrid .dpi{flex-direction:column;gap:3px;padding:6px 4px;font-size:12px;text-align:center;justify-content:center}
.dpgrid .dpi kbd{display:none}
.dcol{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.dcv{flex:1;position:relative;overflow:hidden;background-color:var(--surface);background-image:var(--pad-cross);touch-action:none;cursor:crosshair;min-height:200px}
.dcv[data-tool=select]{cursor:default}.dcv[data-tool=erase]{cursor:not-allowed}
.dcv svg.dsv{position:absolute;left:0;top:0;overflow:visible}
.dcv .dlab{position:absolute;inset:0;pointer-events:none;font-family:KaTeX_Main,serif}
.dcv .dhit{cursor:pointer}.dcv[data-tool=erase] .dhit{cursor:not-allowed}
.dcv .dhandle{cursor:grab}
.dempty{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;color:var(--subtle);font-size:14.5px;text-align:center;padding:20px;line-height:1.6}
.dempty>div{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 18px;box-shadow:var(--shadow)}
.dempty b{color:var(--fg);font-weight:600}
.dtex{border-top:1px solid var(--line);padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--panel)}
.dtex textarea{min-height:120px;max-height:30vh}
.dprops{width:272px;flex:none;overflow:auto;padding:14px;border-left:1px solid var(--line);display:flex;flex-direction:column;gap:14px;overscroll-behavior:contain}
.dprops .sec{display:flex;flex-direction:column;gap:8px}
.dprops h4{margin:0;font-size:12.5px;font-weight:600;color:var(--muted)}
.dprops .chips{display:flex;flex-wrap:wrap;gap:5px}
.dprops .chips button{height:28px;padding:0 9px;border:1px solid var(--line);border-radius:7px;background:var(--panel-2);cursor:pointer;font:14px KaTeX_Main,serif;color:var(--fg)}
.dprops .chips button:hover{border-color:var(--accent)}
.dprops .dmf{display:block;width:100%;font-size:20px;padding:6px 8px;border:1px solid var(--line);border-radius:9px;background:var(--panel-2);color:var(--fg);--caret-color:var(--accent);--selection-background-color:var(--accent-soft);--primary:var(--accent);min-height:42px}
.dprops .dmf:focus-within{border-color:var(--accent);outline:none}
.dprops input.field{height:38px;font-size:14px}
.dprops .tgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.dprops .tgrid button{height:auto;min-height:34px;padding:4px;border:1px solid var(--line);border-radius:8px;background:var(--panel);cursor:pointer;color:var(--fg);font-size:11.5px;display:flex;flex-direction:column;align-items:center;gap:2px}
.dprops .tgrid button svg{width:40px;height:16px;overflow:visible}
.dprops .tgrid button[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
.dprops .compass{display:grid;grid-template-columns:repeat(3,34px);gap:4px}
.dprops .compass button{width:34px;height:30px;border:1px solid var(--line);border-radius:7px;background:var(--panel);cursor:pointer;color:var(--muted);font-size:13px}
.dprops .compass button[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
.dprops .ex{display:flex;flex-direction:column;gap:6px}
.dprops .ex button{display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--panel);cursor:pointer;color:var(--fg);text-align:left;font-size:13px}
.dprops .ex button:hover{border-color:var(--accent)}
.dprops .ex .prev{height:78px;display:grid;place-items:center;overflow:hidden;font-size:9px;pointer-events:none}
.dhint{padding:8px 16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--subtle);min-height:36px;display:flex;align-items:center;gap:10px}
.dhint kbd{font:500 11.5px var(--mono);background:var(--panel-3);border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;padding:0 5px;color:var(--muted)}
.dchoose{flex:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:22px;align-content:center;overflow:auto}
.dcard{display:flex;flex-direction:column;gap:10px;padding:16px;border:1.5px solid var(--line);border-radius:14px;background:var(--panel);cursor:pointer;color:var(--fg);text-align:left}
.dcard:hover,.dcard:focus-visible{border-color:var(--accent)}
.dcard .prev{height:190px;border-radius:10px;background-color:var(--surface);background-image:var(--pad-cross);display:grid;place-items:center;overflow:hidden;font-size:15.5px;pointer-events:none}
.dcard b{font-size:16px;font-weight:650}
.dcard small{color:var(--muted);font-size:13px;line-height:1.5}
.dghost{position:fixed;z-index:75;pointer-events:none;padding:5px 9px;border-radius:8px;background:var(--panel);border:1.5px solid var(--accent);box-shadow:var(--shadow);font-size:13px;transform:translate(-50%,-130%);color:var(--fg)}
.dia{position:relative;line-height:1}
.dia svg{display:block;overflow:visible}
.dl{position:absolute;line-height:1;white-space:nowrap;pointer-events:none}
.dl .katex{font-size:.8em}
@media (max-width:860px){
  .dov{padding:0}.dwin{border-radius:0;height:100%}
  .dmain{flex-direction:column}
  .dpal{width:auto;flex-direction:row;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--line);padding:6px;gap:4px}
  .dpal .lbl{display:none}.dpal>*{flex:none}.dpgrid{display:flex;gap:4px}
  .dhd{padding:8px;gap:2px}.dhd h2 .tn{display:none}.dhd .btn.sm{padding:0 9px}
  .dpi{flex-direction:column;width:auto;min-width:64px;font-size:11px;gap:2px;padding:4px 6px;text-align:center}
  .dpi kbd{display:none}.dpi{touch-action:pan-x}
  .dprops{width:auto;max-height:34vh;border-left:0;border-top:1px solid var(--line)}
  .dchoose{grid-template-columns:minmax(0,1fr);align-content:start}
  .dcard .prev{height:120px}
  .dhint{display:none}
}`;

const ICON = {
  dia: '<svg class="i" viewBox="0 0 24 24"><path d="M3 4l6 8-6 8M9 12h1.5c.6-1.6 1.4-1.6 2 0s1.4 1.6 2 0 1.4-1.6 2 0 1.4 1.6 2 0H21"/></svg>',
  feynman: '<svg class="i" viewBox="0 0 24 24"><path d="M3 4l6 8-6 8M9 12h1.5c.6-1.6 1.4-1.6 2 0s1.4 1.6 2 0 1.4-1.6 2 0 1.4 1.6 2 0H21"/></svg>',
  circuit: '<svg class="i" viewBox="0 0 24 24"><path d="M2 12h4l1.5-3 3 6 3-6 3 6 1.5-3h4"/></svg>',
  quantum: '<svg class="i" viewBox="0 0 24 24"><path d="M2 7h20M2 17h20M7 7v10"/><circle cx="7" cy="7" r="1.6" fill="currentColor"/><circle cx="7" cy="17" r="3"/><rect x="13" y="4" width="6" height="6" rx="1" fill="var(--panel)"/></svg>',
  select: '<svg class="i" viewBox="0 0 24 24"><path d="M5 3l14 8-6.2 1.6L10 19z"/></svg>',
  erase: '<svg class="i" viewBox="0 0 24 24"><path d="M8.5 20H20M4.6 15.4l9.8-9.8a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 18H8.2a2 2 0 01-1.4-.6l-2.2-2.2a2 2 0 010-2.8zM9 11l6 6"/></svg>',
};
const pal = { ink: 'currentColor', bg: 'none', accent: 'currentColor', faint: 'transparent' };
function feynIcon(t) {
  const d = { type: 'feynman', v: [V('a', .25, .5), V('b', 2.75, .5)], e: [E('a', 'b', t)] };
  return `<svg viewBox="0 0 3 1">${renderFeynman(d, pal).svg}</svg>`;
}
function circIcon(t) {
  if (CPT[t]) { const d = { type: 'circuit', el: [], pt: [{ id: 'p', t, x: 1.5, y: t === 'ground' ? .25 : .55, label: '' }] }; return `<svg viewBox="0 0 3 1.1">${renderCircuit(d, pal).svg.replace(/r="\.1(1)?"/g, 'r=".14"')}</svg>`; }
  const len = CT[t].len ? Math.max(1.9, CT[t].len + .5) : 1.9, d = { type: 'circuit', rstyle: 'american', el: [{ id: 'e', t, a: { x: 1.5 - len / 2, y: .6 }, b: { x: 1.5 + len / 2, y: .6 }, label: '' }], pt: [] };
  const sc = Math.min(1, 2.9 / (len + .2));
  return `<svg viewBox="0 0 3 1.2"><g transform="translate(1.5 .6) scale(${r3(sc)}) translate(-1.5 -.6)">${renderCircuit(d, pal).svg}</g></svg>`;
}
function qIcon(t) {
  if (isBox(t)) return `<span class="qg">${H.tex(t === 'box' ? 'U' : QT[t].lbl(''), false)}</span>`;
  const d = { type: 'quantum', n: 1, inL: [''], outL: [''], bar: t === 'bar' ? [0] : [], g: t === 'bar' ? [] : [{ id: 'g', r: 0, c: 0, t: t === 'ctrl' || t === 'octrl' || t === 'targ' || t === 'swap' || t === 'meas' ? t : 'H' }] };
  if (t === 'bar') return '<svg viewBox="0 0 3 1.2"><path d="M0 .6H3" stroke="currentColor" stroke-width=".065"/><path d="M1.5 0V1.2" stroke="currentColor" stroke-width=".06" stroke-dasharray=".16 .11"/></svg>';
  const r = renderQuantum(d, pal);
  return `<svg viewBox="${r3(r.layout.cx[0] - 1.5)} .15 3 1.2">${r.svg}</svg>`;
}

let ed = null;   // the open editor
function open(initial, opts = {}) {
  if (ed) return;
  const ov = document.createElement('div'); ov.className = 'dov';
  ov.innerHTML = `<div class="dwin" role="dialog" aria-modal="true" aria-label="Diagram editor"></div>`;
  document.body.append(ov);
  ed = { ov, win: ov.firstChild, opts, d: null, hist: [], fut: [], sel: null, tool: 'select', drag: null, changed: false, discarding: false, U: innerWidth < 860 ? 30 : 34 };
  addEventListener('keydown', onKey, true); addEventListener('paste', onPaste, true);
  if (initial && TYPES[initial.type]) startEditor(clone(initial), false);
  else chooser();
}
function close() {
  if (!ed) return;
  removeEventListener('keydown', onKey, true); removeEventListener('paste', onPaste, true);
  ed.ro?.disconnect(); ed.ov.remove(); ed = null;
}
function chooser() {
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--note-ink').trim() || '#17191e';
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#f6f6f3';
  const cards = [['feynman', 'Particles, propagators and vertices. Drag from point to point with a photon, gluon or fermion line.', 0], ['circuit', 'Resistors, capacitors, sources and meters. Drag a component between two grid points; wires bend at right angles.', 1], ['quantum', 'Qubit wires and gates. Drop H, X, controls, targets and measurements onto the grid.', 0]];
  ed.win.innerHTML = `<div class="dhd"><h2>${ICON.dia}New diagram</h2><span style="flex:1"></span><button class="btn sm" data-d="cancel">Cancel</button></div>
    <div class="dchoose">${cards.map(([t, txt, ex]) => `<button class="dcard" data-type="${t}"><div class="prev">${html(EXAMPLES[t][ex][1](), { ink, bg })}</div><b>${TYPES[t].name}</b><small>${txt}</small></button>`).join('')}</div>
    <div class="dhint">Everything is drawn with the mouse, a pen or a finger. Each diagram also exports as ${t('TikZ-Feynman')}, ${t('CircuiTikZ')} or ${t('quantikz')} code for your LaTeX documents.</div>`;
  ed.win.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.d === 'cancel') return close(); if (b.dataset.type) startEditor(blank(b.dataset.type), true); };
  setTimeout(() => ed?.win.querySelector('.dcard')?.focus(), 30);
  function t(s) { return `<b style="font-weight:600;color:var(--muted)">${s}</b>`; }
}
const C = () => CTRL[ed.d.type];
function startEditor(d, isNew) {
  ed.d = d; ed.off = null; ed.isNew = isNew || !!ed.opts.isNew; ed.hist = []; ed.fut = []; ed.last = JSON.stringify(d); ed.sel = null; ed.tool = d.type === 'feynman' ? 'fermion' : d.type === 'circuit' ? 'wire' : 'H';
  if (isEmpty(d)) ed.changed = false;
  const T = TYPES[d.type];
  ed.win.innerHTML = `<div class="dhd"><h2>${ICON[d.type]}<span class="tn">${T.name}</span></h2><span style="flex:1"></span>
      <button class="ibtn" data-d="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${H.icon('undo')}</button>
      <button class="ibtn" data-d="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${H.icon('redo')}</button>
      <button class="btn sm outline" data-d="latex" aria-pressed="false">${H.icon('tex')}<span class="lbl-wide">LaTeX</span></button>
      <button class="btn sm" data-d="cancel">Cancel</button>
      <button class="btn sm primary" data-d="done">${H.icon('check')}${ed.isNew ? 'Add<span class="lbl-wide">&nbsp;to workspace</span>' : 'Save'}</button></div>
    <div class="dmain"><nav class="dpal" aria-label="Parts"></nav>
      <div class="dcol"><div class="dcv" tabindex="0" aria-label="Drawing area"><svg class="dsv" xmlns="http://www.w3.org/2000/svg"></svg><div class="dlab"></div><div class="dempty" hidden></div></div>
        <div class="dtex" hidden><textarea class="code" readonly aria-label="LaTeX source" spellcheck="false"></textarea><div class="row" style="justify-content:space-between;gap:8px"><span class="hint dpk"></span><button class="btn sm outline" data-d="copy">${H.icon('copy')}Copy</button></div></div></div>
      <aside class="dprops" aria-label="Properties"></aside></div>
    <div class="dhint"></div>`;
  const cv = ed.win.querySelector('.dcv');
  ed.cv = cv; ed.svg = cv.querySelector('svg'); ed.lab = cv.querySelector('.dlab');
  cv.style.backgroundSize = `${ed.U}px ${ed.U}px`; cv.style.backgroundPosition = `${-ed.U / 2}px ${-ed.U / 2}px`;
  ed.lab.style.fontSize = (ed.U / UEM) + 'px';
  ed.ro = new ResizeObserver(() => draw()); ed.ro.observe(cv);
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { if (!ed.drag && ed.hover) { ed.hover = null; draw(); } });
  cv.addEventListener('contextmenu', e => { e.preventDefault(); const prev = ed.tool; ed.tool = 'erase'; down(e); ed.tool = prev; });
  ed.win.onclick = onClick;
  ed.win.querySelector('.dprops').addEventListener('input', onPropInput);
  ed.win.querySelector('.dprops').addEventListener('change', () => commit());
  ed.win.querySelector('.dpal').addEventListener('pointerdown', palDown);
  requestAnimationFrame(() => { centre(); renderPalette(); renderProps(); draw(); ed.cv.focus(); });
}
function centre(base = true) {
  if (!ed) return;
  if (ed.d.type === 'quantum') { ed.off = { x: 2, y: 2 }; return; }
  const r = TYPES[ed.d.type].render(ed.d, { ink: '#000', bg: '#fff' }), b = r.bb;
  const W = ed.cv.clientWidth / ed.U, Hh = ed.cv.clientHeight / ed.U;
  if (!isFinite(b.x0)) return;
  const dx = Math.round((W - (b.x1 - b.x0)) / 2 - b.x0), dy = Math.round((Hh - (b.y1 - b.y0)) / 2 - b.y0);
  shift(ed.d, dx, dy); if (base) ed.last = JSON.stringify(ed.d);
}
function shift(d, dx, dy) {
  if (d.type === 'feynman') d.v.forEach(v => { v.x += dx; v.y += dy; });
  else if (d.type === 'circuit') { d.el.forEach(e => { e.a.x += dx; e.a.y += dy; e.b.x += dx; e.b.y += dy; }); d.pt.forEach(p => { p.x += dx; p.y += dy; }); }
}
function colors() {
  const cs = getComputedStyle(document.documentElement);
  return { ink: cs.getPropertyValue('--note-ink').trim() || '#17191e', bg: cs.getPropertyValue('--surface').trim() || '#f6f6f3', accent: cs.getPropertyValue('--accent').trim() || '#2f55e4', faint: cs.getPropertyValue('--subtle').trim() || '#8a909b' };
}
function draw() {
  if (!ed?.cv) return;
  const W = ed.cv.clientWidth, Hh = ed.cv.clientHeight, U = ed.U, d = ed.preview || ed.d;
  ed.svg.setAttribute('width', W); ed.svg.setAttribute('height', Hh); ed.svg.setAttribute('viewBox', `0 0 ${r3(W / U)} ${r3(Hh / U)}`);
  const o = { ...colors(), edit: true, sel: ed.sel, hover: ed.hover, idp: 'e_', handles: ed.tool === 'select' };
  if (d.type === 'quantum') o.cols = Math.max(6, Math.max(-1, ...d.g.map(g => g.c), ...d.bar) + 3);
  const r = TYPES[d.type].render(d, o);
  ed.layout = r.layout;
  let extra = '';
  if (ed.drag?.kind === 'new' && ed.drag.moved && d.type === 'circuit' && ed.drag.route) extra = '';
  const off = ed.off || { x: 0, y: 0 };
  ed.svg.innerHTML = `<g transform="translate(${off.x} ${off.y})">${r.svg + r.hit + extra}</g>`;
  ed.lab.innerHTML = labelsHTML(r.labels, -off.x, -off.y, o.ink);
  const em = ed.win.querySelector('.dempty');
  em.hidden = !isEmpty(ed.d) || !!ed.preview;
  if (!em.hidden) em.innerHTML = C().emptyHint();
  ed.win.querySelector('[data-d=undo]').disabled = !ed.hist.length;
  ed.win.querySelector('[data-d=redo]').disabled = !ed.fut.length;
  const tx = ed.win.querySelector('.dtex');
  if (!tx.hidden) { tx.querySelector('textarea').value = TYPES[ed.d.type].latex(ed.d); tx.querySelector('.dpk').innerHTML = 'Needs in the preamble: <code>' + esc(preamble(new Set([TYPES[ed.d.type].pkg]))).replace(/\n/g, '</code> <code>') + '</code>'; }
}
function commit() {
  const s = JSON.stringify(ed.d); if (s === ed.last) return;
  ed.hist.push(ed.last); if (ed.hist.length > 150) ed.hist.shift(); ed.fut = []; ed.last = s; ed.changed = true; ed.discarding = false;
  draw();
}
function undo() { commit(); if (!ed.hist.length) return; ed.fut.push(ed.last); ed.last = ed.hist.pop(); ed.d = JSON.parse(ed.last); fixSel(); ed.changed = true; draw(); renderProps(); }
function redo() { if (!ed.fut.length) return; ed.hist.push(ed.last); ed.last = ed.fut.pop(); ed.d = JSON.parse(ed.last); fixSel(); draw(); renderProps(); }
function fixSel() { if (ed.sel && !C().find(ed.sel)) ed.sel = null; }
function setSel(id) { ed.sel = id; draw(); renderProps(); }
function setTool(t) { const redraw = (ed.tool === 'select') !== (t === 'select'); ed.tool = t; if (redraw) draw(); ed.cv.dataset.tool = t === 'select' || t === 'erase' ? t : 'draw'; ed.win.querySelectorAll('.dpi').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t)); hint(); }
function hint() { const h = ed.win.querySelector('.dhint'); if (h) h.innerHTML = C().hint(ed.tool); }
function pt(e) { const r = ed.cv.getBoundingClientRect(), o = ed.off || { x: 0, y: 0 }; return { x: (e.clientX - r.left) / ed.U - o.x, y: (e.clientY - r.top) / ed.U - o.y }; }
const snap = p => ({ x: Math.round(p.x), y: Math.round(p.y) });

function renderPalette() {
  const c = C(), box = ed.win.querySelector('.dpal');
  box.innerHTML = c.palette();
  setTool(ed.tool);
}
function palDown(e) {
  const b = e.target.closest('.dpi'); if (!b) return;
  e.preventDefault();
  setTool(b.dataset.t);
  if (!C().droppable?.(b.dataset.t)) return;
  const g = document.createElement('div'); g.className = 'dghost'; g.textContent = b.querySelector('.nm')?.textContent || b.dataset.t; g.hidden = true; document.body.append(g);
  const sx = e.clientX, sy = e.clientY;
  const mv = ev => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; g.hidden = false; g.style.left = ev.clientX + 'px'; g.style.top = ev.clientY + 'px'; const r = ed.cv.getBoundingClientRect(), inside = ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom; C().dragOver?.(inside ? pt(ev) : null); };
  const fin = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', fin); removeEventListener('pointercancel', fin); g.remove();
    const r = ed.cv.getBoundingClientRect(); if (ev.type === 'pointerup' && !g.hidden && ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) C().drop(b.dataset.t, pt(ev)); else C().dragOver?.(null); };
  addEventListener('pointermove', mv); addEventListener('pointerup', fin); addEventListener('pointercancel', fin);
}
function down(e) { if (e.button > 0 && e.type !== 'contextmenu') return; if (e.pointerId != null) try { ed.cv.setPointerCapture(e.pointerId); } catch {} C().down(e, pt(e)); }
function move(e) { C().move(e, pt(e)); }
function up(e) { C().up(e, pt(e)); }

function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const a = b.dataset.d;
  if (a === 'cancel') { if (ed.changed && !ed.discarding) { ed.discarding = true; b.textContent = 'Discard changes?'; b.classList.add('danger'); return; } return close(); }
  if (a === 'done') { const d = clone(ed.d); const cb = ed.opts.onDone; close(); if (!isEmpty(d)) cb?.(d); else H.toast('The diagram is empty — nothing was added'); return; }
  if (a === 'undo') return undo();
  if (a === 'redo') return redo();
  if (a === 'latex') { const t = ed.win.querySelector('.dtex'); t.hidden = !t.hidden; b.setAttribute('aria-pressed', !t.hidden); draw(); return; }
  if (a === 'copy') { const ta = ed.win.querySelector('.dtex textarea'); navigator.clipboard?.writeText(ta.value).then(() => H.toast('LaTeX copied'), () => { ta.select(); document.execCommand('copy'); H.toast('LaTeX copied'); }); return; }
  if (b.closest('.dprops')) C().propClick(b);
}
function onPropInput(e) { C().propInput(e.target); }
function onPaste(e) { if (!ed) return; if (!isEditable(e.target)) { e.stopImmediatePropagation(); e.preventDefault(); } }
const isEditable = t => t && (t.closest?.('input,textarea,[contenteditable=true],math-field') || t.tagName === 'MATH-FIELD');
function onKey(e) {
  if (!ed) return;
  if (isEditable(e.target)) { if (e.key === 'Escape') { e.target.blur?.(); ed.cv?.focus(); e.stopImmediatePropagation(); e.preventDefault(); } return; }
  e.stopImmediatePropagation();
  if (!ed.d) { if (e.key === 'Escape') close(); return; }
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'enter') { e.preventDefault(); ed.win.querySelector('[data-d=done]').click(); return; }
  if (mod) return;
  if (e.key === 'Escape') { e.preventDefault(); if (ed.drag) { ed.drag = null; ed.preview = null; draw(); return; } if (ed.sel) return setSel(null); if (ed.tool !== 'select') return setTool('select'); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ed.sel) { e.preventDefault(); C().remove(ed.sel); ed.sel = null; commit(); renderProps(); return; }
  if (e.key === 'v') return setTool('select');
  if (e.key === 'e' && ed.d.type !== 'circuit') return setTool('erase');
  if (e.key === 'Delete') return;
  const t = C().keyTool?.(e.key); if (t) setTool(t);
}

/* props helpers */
function mathInput(key, value, placeholder = '') {
  return `<div class="dmfslot" data-k="${key}" data-v="${esc(value || '')}" data-ph="${esc(placeholder)}"><input class="field" data-k="${key}" value="${esc(value || '')}" placeholder="${esc(placeholder)}" spellcheck="false" aria-label="Label as LaTeX"></div>`;
}
async function upgradeMath() {
  const slots = [...ed.win.querySelectorAll('.dmfslot')]; if (!slots.length) return;
  const ok = await H.loadMathLive?.(); if (!ok || !ed) return;
  for (const s of slots) {
    if (!s.isConnected) continue;
    const mf = new MathfieldElement(); mf.className = 'dmf'; mf.value = s.dataset.v; mf.dataset.k = s.dataset.k;
    try { mf.smartFence = true; mf.mathVirtualKeyboardPolicy = 'manual'; mf.placeholder = s.dataset.ph; } catch {}
    mf.setAttribute('aria-label', 'Label');
    mf.addEventListener('input', () => C().propInput(mf));
    mf.addEventListener('change', () => commit());
    mf.addEventListener('focusout', () => commit());
    s.replaceChildren(mf);
  }
}
const chips = (key, list) => `<div class="chips">${list.map(v => `<button data-chip="${key}" data-val="${esc(v)}" title="${esc(v)}">${H.tex(v, false)}</button>`).join('')}</div>`;
const compass = cur => {
  const cells = [[135, '↖'], [90, '↑'], [45, '↗'], [180, '←'], ['auto', 'A'], [0, '→'], [225, '↙'], [270, '↓'], [315, '↘']];
  return `<div class="compass">${cells.map(([a, s]) => `<button data-lpos="${a}" aria-pressed="${String(cur ?? 'auto') === String(a)}" title="${a === 'auto' ? 'Automatic' : 'Put the label here'}">${s}</button>`).join('')}</div>`;
};
function renderProps() {
  if (!ed?.d) return;
  const box = ed.win.querySelector('.dprops');
  box.innerHTML = C().props();
  upgradeMath();
}
function examplesHTML(type) {
  const { ink, bg } = colors();
  return `<div class="sec"><h4>Start from an example</h4><div class="ex">${EXAMPLES[type].map(([n, f], i) => `<button data-ex="${i}"><div class="prev">${html(f(), { ink, bg })}</div>${n}</button>`).join('')}</div></div>`;
}
function loadExample(i) {
  const d = EXAMPLES[ed.d.type][i][1]();
  ed.d = d; centre(false);
  ed.sel = null; commit(); renderProps(); setTool('select');
}

/* ---------- Feynman controller ---------- */
const CF = {
  emptyHint: () => `<div><b>Pick a line on the left and drag from point to point.</b><br>Lines snap to the crosses and join where they meet.<br>Or start from an example on the right.</div>`,
  hint: t => t === 'select' ? '<span>Drag a vertex to move it, drag the round handle on a selected line to curve it.</span><kbd>Del</kbd><span>removes</span>' : t === 'erase' ? '<span>Click a line or vertex to remove it.</span>' : `<span>Drag from point to point to draw a <b>${FT[t].n.toLowerCase()}</b>. Start on a vertex to connect to it.</span><kbd>V</kbd><span>select</span><kbd>Ctrl Z</kbd><span>undo</span>`,
  palette: () => `<button class="dpi" data-t="select"><span class="ico">${ICON.select}</span><span class="nm">Select &amp; move</span><kbd>V</kbd></button>
    <div class="lbl">Lines</div>${Object.entries(FT).map(([k, t]) => `<button class="dpi" data-t="${k}"><span class="ico">${feynIcon(k)}</span><span class="nm">${t.n}</span><kbd>${t.k}</kbd></button>`).join('')}
    <div class="lbl">Tools</div><button class="dpi" data-t="erase"><span class="ico">${ICON.erase}</span><span class="nm">Eraser</span><kbd>E</kbd></button>`,
  keyTool: k => Object.keys(FT).find(t => FT[t].k === k),
  find: id => ed.d.v.find(v => v.id === id) || ed.d.e.find(e => e.id === id),
  vAt(p, except) { return ed.d.v.find(v => v.id !== except && Math.hypot(v.x - p.x, v.y - p.y) < .45); },
  vertex(p) { const s = snap(p), f = CF.vAt(s); if (f) return f.id; const v = V(uid(), s.x, s.y); ed.d.v.push(v); return v.id; },
  remove(id) {
    const d = ed.d;
    if (d.v.some(v => v.id === id)) { d.v = d.v.filter(v => v.id !== id); d.e = d.e.filter(e => e.a !== id && e.b !== id); }
    else d.e = d.e.filter(e => e.id !== id);
    CF.tidy();
  },
  tidy() { const d = ed.d, used = new Set(d.e.flatMap(e => [e.a, e.b])); d.v = d.v.filter(v => used.has(v.id) || v.label || v.style !== 'none'); },
  down(e, p) {
    const t = e.target, vId = t.closest?.('[data-v]')?.dataset.v, eId = t.closest?.('[data-e]')?.dataset.e, hId = t.closest?.('[data-h]')?.dataset.h;
    if (ed.tool === 'erase') { const id = vId || eId || hId; if (id) { CF.remove(id); if (ed.sel === id) ed.sel = null; commit(); renderProps(); } return; }
    if (hId) { ed.drag = { kind: 'bend', id: hId }; return; }
    if (ed.tool === 'select') {
      if (vId) { const v = CF.find(vId); ed.drag = { kind: 'move', ids: [vId], start: snap(p), orig: [{ id: vId, x: v.x, y: v.y }] }; setSel(vId); return; }
      if (eId) { const ee = CF.find(eId), vs = [ee.a, ee.b].map(i => ed.d.v.find(v => v.id === i)); ed.drag = { kind: 'move', ids: [ee.a, ee.b], start: snap(p), orig: vs.map(v => ({ id: v.id, x: v.x, y: v.y })) }; setSel(eId); return; }
      setSel(null); return;
    }
    const from = vId ? CF.find(vId) : snap(p);
    ed.drag = { kind: 'new', from: { x: from.x, y: from.y }, fromId: vId || null, cur: { x: from.x, y: from.y }, moved: false, eId };
  },
  move(e, p) {
    const dr = ed.drag; if (!dr) return;
    if (dr.kind === 'bend') {
      const ee = CF.find(dr.id), A = CF.find(ee.a), B = CF.find(ee.b), dx = B.x - A.x, dy = B.y - A.y, D = Math.hypot(dx, dy);
      const off = ((p.x - A.x) * dy - (p.y - A.y) * dx) / D; // left offset (screen)
      let th = Math.asin(clamp(off / (.2936 * D), -1, 1)) * 180 / Math.PI; th = Math.round(th / 5) * 5;
      ee.bend = th; draw(); return;
    }
    if (dr.kind === 'move') {
      const s = snap(p), dx = s.x - dr.start.x, dy = s.y - dr.start.y;
      for (const o of dr.orig) { const v = CF.find(o.id); v.x = o.x + dx; v.y = o.y + dy; }
      draw(); return;
    }
    if (dr.kind === 'new') {
      const s = CF.vAt(snap(p)) || snap(p);
      if (s.x === dr.cur.x && s.y === dr.cur.y) return;
      dr.cur = { x: s.x, y: s.y }; dr.moved = dr.cur.x !== dr.from.x || dr.cur.y !== dr.from.y;
      const pv = clone(ed.d);
      if (dr.moved) { pv.v.push(V('__a', dr.from.x, dr.from.y), V('__b', dr.cur.x, dr.cur.y)); pv.e.push(E('__a', '__b', ed.tool)); }
      ed.preview = pv; draw();
    }
  },
  up(e, p) {
    const dr = ed.drag; ed.drag = null; ed.preview = null; if (!dr) return;
    if (dr.kind === 'bend') { commit(); renderProps(); return; }
    if (dr.kind === 'move') {
      for (const o of dr.orig) { const v = CF.find(o.id), other = CF.vAt(v, v.id); if (other) { ed.d.e.forEach(x => { if (x.a === v.id) x.a = other.id; if (x.b === v.id) x.b = other.id; }); ed.d.e = ed.d.e.filter(x => x.a !== x.b); ed.d.v = ed.d.v.filter(x => x !== v); if (ed.sel === v.id) ed.sel = other.id; } }
      commit(); renderProps(); return;
    }
    if (dr.kind === 'new') {
      if (!dr.moved) { if (dr.fromId) setSel(dr.fromId); else if (dr.eId) setSel(dr.eId); else draw(); return; }
      const a = dr.fromId || CF.vertex(dr.from), b = CF.vertex(dr.cur);
      if (a === b) { draw(); return; }
      const A = CF.find(a), B = CF.find(b), ne = E(a, b, ed.tool, '', { side: defSide(A, B) });
      ed.d.e.push(ne); ed.sel = ne.id; commit(); renderProps();
    }
  },
  props() {
    const d = ed.d, s = ed.sel && CF.find(ed.sel);
    if (!s) return `<div class="sec"><h4>How to draw</h4><div class="hint">Choose a line type, then drag between two crosses. Start or end on an existing point to join lines into a vertex. Select a line to label or curve it.</div></div>${examplesHTML('feynman')}
      ${isEmpty(d) ? '' : '<div class="sec"><button class="btn sm outline danger" data-p="clear">Clear the diagram</button></div>'}`;
    if (s.a) {
      const ty = FT[s.t] || FT.plain;
      return `<div class="sec"><h4>Line</h4><div class="tgrid">${Object.entries(FT).map(([k, t]) => `<button data-et="${k}" aria-pressed="${s.t === k}" title="${t.n}">${feynIcon(k)}<span>${t.n.split(' ')[0]}</span></button>`).join('')}</div></div>
        <div class="sec"><h4>Label</h4>${mathInput('label', s.label, 'e.g. \\gamma')}${chips('label', s.t === 'photon' ? ['\\gamma', '\\gamma^*', 'q', 'k'] : s.t === 'gluon' ? ['g', 'k'] : s.t === 'wboson' ? ['W^+', 'W^-', 'W^\\pm'] : s.t.includes('scalar') ? ['H', 'h', '\\phi', '\\pi^0'] : ['e^-', 'e^+', '\\mu^-', '\\nu_e', 'q', '\\bar q', 'p', 'p\'', 'Z^0'])}
          <div class="row"><span class="hint" style="width:auto">Side</span><div class="seg"><button data-side="1" aria-pressed="${(s.side || 1) > 0}">Left</button><button data-side="-1" aria-pressed="${(s.side || 1) < 0}">Right</button></div></div></div>
        <div class="sec"><h4>Momentum arrow</h4>${mathInput('mom', s.mom, 'e.g. k')}<div class="hint">Drawn beside the line, on the side opposite the label.</div></div>
        <div class="sec"><h4>Shape</h4><div class="seg wide"><button data-bend="0" aria-pressed="${!s.bend}">Straight</button><button data-bend="45" aria-pressed="${Math.abs(s.bend) > 0 && Math.abs(s.bend) < 90}">Arc</button><button data-bend="90" aria-pressed="${Math.abs(s.bend) === 90}">Half circle</button></div>
          <div class="row"><input type="range" min="-90" max="90" step="5" value="${s.bend || 0}" data-k="bend" aria-label="Curvature"></div>
          <div class="tb"><button class="btn sm outline" data-p="flipbend">Curve to the other side</button>${ty.arrow ? '<button class="btn sm outline" data-p="reverse">Reverse arrow</button>' : ''}</div></div>
        <div class="sec"><button class="btn sm outline danger" data-p="del">${H.icon('trash')}Delete line</button></div>`;
    }
    return `<div class="sec"><h4>Vertex</h4><div class="seg wide">${VSTYLE.map(([k, n]) => `<button data-vs="${k}" aria-pressed="${s.style === k}">${n}</button>`).join('')}</div></div>
      <div class="sec"><h4>Label</h4>${mathInput('label', s.label, 'e.g. e^-')}${chips('label', ['e^-', 'e^+', '\\mu^-', '\\mu^+', '\\gamma', 'q', '\\bar q', 'g', 'p', 'x', 'y'])}</div>
      <div class="sec"><h4>Label position</h4>${compass(s.lpos)}</div>
      <div class="sec"><button class="btn sm outline danger" data-p="del">${H.icon('trash')}Delete vertex and its lines</button></div>`;
  },
  propClick(b) {
    const s = ed.sel && CF.find(ed.sel);
    if (b.dataset.ex != null) return loadExample(+b.dataset.ex);
    if (b.dataset.p === 'clear') { ed.d.v = []; ed.d.e = []; ed.sel = null; commit(); renderProps(); return; }
    if (!s) return;
    if (b.dataset.p === 'del') { CF.remove(s.id); ed.sel = null; commit(); renderProps(); return; }
    if (b.dataset.et) s.t = b.dataset.et;
    else if (b.dataset.side) s.side = +b.dataset.side;
    else if (b.dataset.bend != null) s.bend = +b.dataset.bend * (s.bend < 0 ? -1 : 1);
    else if (b.dataset.p === 'flipbend') s.bend = -(s.bend || 0) || 45;
    else if (b.dataset.p === 'reverse') { [s.a, s.b] = [s.b, s.a]; s.bend = -(s.bend || 0); s.side = -(s.side || 1); }
    else if (b.dataset.vs) s.style = b.dataset.vs;
    else if (b.dataset.lpos) s.lpos = b.dataset.lpos === 'auto' ? 'auto' : +b.dataset.lpos;
    else if (b.dataset.chip) { s[b.dataset.chip] = b.dataset.val; }
    else return;
    commit(); renderProps();
  },
  propInput(t) {
    const s = ed.sel && CF.find(ed.sel); if (!s) return;
    const k = t.dataset.k; if (!k) return;
    s[k] = k === 'bend' ? +t.value : t.value; draw();
    if (k === 'bend') clearTimeout(ed.ct), ed.ct = setTimeout(commit, 300);
  },
};

/* ---------- circuit controller ---------- */
const CC = {
  emptyHint: () => `<div><b>Pick a component and drag it between two crosses.</b><br>Wires turn corners for you. Drop ground, junctions and terminals with a click.<br>Or start from an example on the right.</div>`,
  hint: t => t === 'select' ? '<span>Drag a part to move it — connected wires stretch along. Drag the round ends of a selected part to resize it.</span><kbd>Del</kbd><span>removes</span>' : t === 'erase' ? '<span>Click a part to remove it.</span>' : CPT[t] ? `<span>Click a cross to place a <b>${CPT[t].n.toLowerCase()}</b>.</span>` : t === 'wire' ? '<span>Drag from point to point. If the points are not in line, the wire turns a right angle; hold <kbd>Shift</kbd> for a straight diagonal.</span>' : `<span>Drag between two crosses to place a <b>${CT[t].n.toLowerCase()}</b>, or drag it from the list onto the grid.</span>`,
  palette: () => `<button class="dpi" data-t="select"><span class="ico">${ICON.select}</span><span class="nm">Select &amp; move</span><kbd>V</kbd></button>
    <div class="lbl">Components</div><div class="dpgrid">${Object.entries(CT).map(([k, t]) => `<button class="dpi" data-t="${k}" title="${t.n} (${t.k.toUpperCase()})"><span class="ico">${circIcon(k)}</span><span class="nm">${t.n}</span><kbd>${t.k.toUpperCase()}</kbd></button>`).join('')}</div>
    <div class="lbl">Points</div><div class="dpgrid">${Object.entries(CPT).map(([k, t]) => `<button class="dpi" data-t="${k}" title="${t.n} (${t.k.toUpperCase()})"><span class="ico">${circIcon(k)}</span><span class="nm">${t.n}</span><kbd>${t.k.toUpperCase()}</kbd></button>`).join('')}</div>
    <div class="lbl">Tools</div><button class="dpi" data-t="erase"><span class="ico">${ICON.erase}</span><span class="nm">Eraser</span><kbd>X</kbd></button>`,
  keyTool: k => k === 'x' ? 'erase' : Object.keys(CT).find(t => CT[t].k === k) || Object.keys(CPT).find(t => CPT[t].k === k),
  droppable: t => !!(CT[t] || CPT[t]),
  find: id => ed.d.el.find(e => e.id === id) || ed.d.pt.find(p => p.id === id),
  remove(id) { ed.d.el = ed.d.el.filter(e => e.id !== id); ed.d.pt = ed.d.pt.filter(p => p.id !== id); },
  attached(pts, exceptId) {   // every end or point sitting on one of these positions
    const keys = new Set(pts.map(ckey)), out = [];
    for (const e of ed.d.el) { if (e.id === exceptId) continue; for (const k of ['a', 'b']) if (keys.has(ckey(e[k]))) out.push({ o: e[k], x: e[k].x, y: e[k].y }); }
    for (const p of ed.d.pt) if (p.id !== exceptId && keys.has(ckey(p))) out.push({ o: p, x: p.x, y: p.y });
    return out;
  },
  add(t, a, b, route) {
    if (CPT[t]) { const ex = ed.d.pt.find(p => p.t === t && p.x === a.x && p.y === a.y); if (ex) return ex.id; const p = { id: uid(), t, x: a.x, y: a.y, label: '', lpos: 'auto' }; ed.d.pt.push(p); return p.id; }
    const mk = (a, b) => { const e = { id: uid(), t, a: { ...a }, b: { ...b }, label: '', side: defSide(a, b), i: '' }; ed.d.el.push(e); return e.id; };
    if (t === 'wire' && route && a.x !== b.x && a.y !== b.y) { const c = { x: b.x, y: a.y }; mk(a, c); return mk(c, b); }
    return mk(a, b);
  },
  down(e, p) {
    const t = e.target, eId = t.closest?.('[data-e]')?.dataset.e, pId = t.closest?.('[data-p]')?.dataset.p, end = t.closest?.('[data-end]')?.dataset.end;
    if (ed.tool === 'erase') { const id = eId || pId || (end && ed.sel); if (id) { CC.remove(id); if (ed.sel === id) ed.sel = null; commit(); renderProps(); } return; }
    if (end && ed.sel && ed.tool === 'select') { const el = CC.find(ed.sel); ed.drag = { kind: 'end', id: ed.sel, k: end, start: snap(p), orig: { ...el[end] }, att: CC.attached([el[end]], el.id) }; return; }
    if (ed.tool === 'select') {
      if (eId) { const el = CC.find(eId); setSel(eId); ed.drag = { kind: 'move', id: eId, start: snap(p), oa: { ...el.a }, ob: { ...el.b }, att: CC.attached([el.a, el.b], eId) }; return; }
      if (pId) { const q = CC.find(pId); setSel(pId); ed.drag = { kind: 'movept', id: pId, start: snap(p), o: { x: q.x, y: q.y }, att: CC.attached([q], pId) }; return; }
      if (ed.tool === 'select') { setSel(null); return; }
    }
    if (CPT[ed.tool]) { const s = snap(p); ed.sel = CC.add(ed.tool, s); commit(); renderProps(); return; }
    const s = snap(p);
    ed.drag = { kind: 'new', from: s, cur: s, moved: false, hitId: eId || pId };
  },
  move(e, p) {
    const dr = ed.drag; if (!dr) return;
    const s = snap(p);
    if (dr.kind === 'end') { const dx = s.x - dr.start.x, dy = s.y - dr.start.y, el = CC.find(dr.id); el[dr.k] = { x: dr.orig.x + dx, y: dr.orig.y + dy }; dr.att.forEach(a => { a.o.x = a.x + dx; a.o.y = a.y + dy; }); draw(); return; }
    if (dr.kind === 'move') { const dx = s.x - dr.start.x, dy = s.y - dr.start.y, el = CC.find(dr.id); el.a = { x: dr.oa.x + dx, y: dr.oa.y + dy }; el.b = { x: dr.ob.x + dx, y: dr.ob.y + dy }; dr.att.forEach(a => { a.o.x = a.x + dx; a.o.y = a.y + dy; }); draw(); return; }
    if (dr.kind === 'movept') { const dx = s.x - dr.start.x, dy = s.y - dr.start.y, q = CC.find(dr.id); q.x = dr.o.x + dx; q.y = dr.o.y + dy; dr.att.forEach(a => { a.o.x = a.x + dx; a.o.y = a.y + dy; }); draw(); return; }
    if (dr.kind === 'new') {
      if (s.x === dr.cur.x && s.y === dr.cur.y) return;
      dr.cur = s; dr.moved = s.x !== dr.from.x || s.y !== dr.from.y;
      const keep = ed.d; ed.d = clone(keep); if (dr.moved) CC.add(ed.tool, dr.from, dr.cur, !e.shiftKey); ed.preview = ed.d; ed.d = keep; draw();
    }
  },
  up(e, p) {
    const dr = ed.drag; ed.drag = null; ed.preview = null; if (!dr) return;
    if (dr.kind === 'new') {
      if (!dr.moved) { if (dr.hitId) setSel(dr.hitId); else draw(); return; }
      ed.sel = CC.add(ed.tool, dr.from, dr.cur, !e.shiftKey); commit(); renderProps(); return;
    }
    commit(); renderProps();
  },
  dragOver(p) { if (!p) { ed.preview = null; draw(); return; } const s = snap(p), keep = ed.d; ed.d = clone(keep); CC.dropAdd(ed.tool, s); ed.preview = ed.d; ed.d = keep; draw(); },
  dropAdd(t, s) { if (CPT[t]) return CC.add(t, s); const half = Math.max(1, Math.ceil(((CT[t].len || 1) + .6) / 2)); return CC.add(t, { x: s.x - half, y: s.y }, { x: s.x + half, y: s.y }); },
  drop(t, p) { ed.preview = null; ed.sel = CC.dropAdd(t, snap(p)); commit(); renderProps(); },
  props() {
    const s = ed.sel && CC.find(ed.sel);
    if (!s) return `<div class="sec"><h4>How to draw</h4><div class="hint">Choose a component and drag between two crosses, or drag it from the list onto the grid. Parts that share a point are connected; a dot appears where three or more meet.</div></div>
      <div class="sec"><h4>Symbol style</h4><div class="seg wide"><button data-rs="american" aria-pressed="${ed.d.rstyle !== 'european'}">American</button><button data-rs="european" aria-pressed="${ed.d.rstyle === 'european'}">European</button></div><div class="hint">Zigzag or box resistors, looped or filled inductors.</div></div>
      ${examplesHTML('circuit')}${isEmpty(ed.d) ? '' : '<div class="sec"><button class="btn sm outline danger" data-p="clear">Clear the circuit</button></div>'}`;
    if (s.a) {
      const t = CT[s.t] || CT.wire, pre = { R: ['R', 'R_1', 'R_2', '1\\,\\mathrm{k\\Omega}'], C: ['C', 'C_1', '10\\,\\mu\\mathrm{F}'], L: ['L', 'L_1', '1\\,\\mathrm{mH}'], V: ['U_0', 'V', 'U(t)', '5\\,\\mathrm{V}'], I: ['I_0', 'I'], bat: ['U_0', '9\\,\\mathrm{V}'], D: ['D', 'D_1'], led: ['\\mathrm{LED}'], sw: ['S', 'S_1'], lamp: ['L_1'], A: ['I'], Vm: ['U'], wire: [] }[s.t] || [];
      return `<div class="sec"><h4>Component</h4><div class="tgrid">${Object.entries(CT).map(([k, c]) => `<button data-ct="${k}" aria-pressed="${s.t === k}" title="${c.n}">${circIcon(k)}<span>${c.n.split(' ')[0]}</span></button>`).join('')}</div></div>
        ${s.t === 'wire' ? '' : `<div class="sec"><h4>Label</h4>${mathInput('label', s.label, 'e.g. R_1')}${chips('label', pre)}
          <div class="row"><span class="hint" style="width:auto">Side</span><div class="seg"><button data-side="${defSide(s.a, s.b)}" aria-pressed="${(s.side || defSide(s.a, s.b)) === defSide(s.a, s.b)}">${Math.abs(s.a.x - s.b.x) >= Math.abs(s.a.y - s.b.y) ? 'Above' : 'Left'}</button><button data-side="${-defSide(s.a, s.b)}" aria-pressed="${(s.side || defSide(s.a, s.b)) !== defSide(s.a, s.b)}">${Math.abs(s.a.x - s.b.x) >= Math.abs(s.a.y - s.b.y) ? 'Below' : 'Right'}</button></div></div></div>`}
        <div class="sec"><h4>Current arrow</h4>${mathInput('i', s.i, 'e.g. I_1')}${chips('i', ['I', 'I_1', 'I_2', 'i(t)'])}</div>
        <div class="sec"><div class="tb"><button class="btn sm outline" data-p="reverse">Reverse direction</button><button class="btn sm outline danger" data-p="del">${H.icon('trash')}Delete</button></div>
          <div class="hint">${s.t === 'V' || s.t === 'bat' ? 'The plus side is at the end you dragged towards; <b>Reverse direction</b> flips it.' : s.t === 'D' || s.t === 'led' ? 'The diode conducts in the direction you dragged.' : s.t === 'I' ? 'The arrow points the way you dragged.' : 'Drag the round ends to stretch or turn the part.'}</div></div>`;
    }
    return `<div class="sec"><h4>${CPT[s.t].n}</h4><div class="seg wide">${Object.entries(CPT).map(([k, c]) => `<button data-pt="${k}" aria-pressed="${s.t === k}">${c.n}</button>`).join('')}</div></div>
      <div class="sec"><h4>Label</h4>${mathInput('label', s.label, 'e.g. U_\\text{in}')}${chips('label', ['A', 'B', 'U_\\text{in}', 'U_\\text{out}', 'V_{cc}', '0\\,\\mathrm{V}'])}</div>
      <div class="sec"><h4>Label position</h4>${compass(s.lpos)}</div>
      <div class="sec"><button class="btn sm outline danger" data-p="del">${H.icon('trash')}Delete</button></div>`;
  },
  propClick(b) {
    const s = ed.sel && CC.find(ed.sel);
    if (b.dataset.ex != null) return loadExample(+b.dataset.ex);
    if (b.dataset.rs) { ed.d.rstyle = b.dataset.rs; commit(); renderPalette(); renderProps(); return; }
    if (b.dataset.p === 'clear') { ed.d.el = []; ed.d.pt = []; ed.sel = null; commit(); renderProps(); return; }
    if (!s) return;
    if (b.dataset.p === 'del') { CC.remove(s.id); ed.sel = null; commit(); renderProps(); return; }
    if (b.dataset.ct) s.t = b.dataset.ct;
    else if (b.dataset.pt) s.t = b.dataset.pt;
    else if (b.dataset.side) s.side = +b.dataset.side;
    else if (b.dataset.p === 'reverse') { [s.a, s.b] = [s.b, s.a]; s.side = -(s.side || defSide(s.b, s.a)); }
    else if (b.dataset.lpos) s.lpos = b.dataset.lpos === 'auto' ? 'auto' : +b.dataset.lpos;
    else if (b.dataset.chip) s[b.dataset.chip] = b.dataset.val;
    else return;
    commit(); renderProps();
  },
  propInput(t) { const s = ed.sel && CC.find(ed.sel); if (!s || !t.dataset.k) return; s[t.dataset.k] = t.value; draw(); },
};

/* ---------- quantum controller ---------- */
const CQ = {
  emptyHint: () => `<div><b>Drag a gate onto a wire, or pick it and click a spot.</b><br>Controls and targets in the same column join up by themselves.<br>Or start from an example on the right.</div>`,
  hint: t => t === 'select' ? '<span>Drag a gate to another spot. Click a qubit label on the left to rename it.</span><kbd>Del</kbd><span>removes</span>' : t === 'erase' ? '<span>Click a gate or a barrier to remove it.</span>' : t === 'bar' ? '<span>Click a column to put a dashed barrier after it; click again to remove it.</span>' : `<span>Click a spot on a wire to place <b>${QT[t].n}</b>, or drag it from the list.</span>${t === 'ctrl' || t === 'octrl' ? '<span>Put a control in the same column as a gate or target.</span>' : ''}`,
  palette: () => {
    const it = k => `<button class="dpi" data-t="${k}" title="${QT[k].n}${QT[k].k ? ` (${QT[k].k.toUpperCase()})` : ''}"><span class="ico">${qIcon(k)}</span><span class="nm">${QT[k].n}</span>${QT[k].k ? `<kbd>${QT[k].k.toUpperCase()}</kbd>` : ''}</button>`;
    return `<button class="dpi" data-t="select"><span class="ico">${ICON.select}</span><span class="nm">Select &amp; move</span><kbd>V</kbd></button>
      <div class="lbl">Gates</div><div class="dpgrid">${['H', 'X', 'Y', 'Z', 'S', 'T', 'Sdg', 'Tdg', 'Rx', 'Ry', 'Rz', 'P', 'U', 'box'].map(it).join('')}</div>
      <div class="lbl">Wiring</div><div class="dpgrid">${['ctrl', 'octrl', 'targ', 'swap', 'meas', 'bar'].map(it).join('')}</div>
      <div class="lbl">Tools</div><button class="dpi" data-t="erase"><span class="ico">${ICON.erase}</span><span class="nm">Eraser</span><kbd>E</kbd></button>`;
  },
  keyTool: k => Object.keys(QT).find(t => QT[t].k === k),
  droppable: t => !!QT[t] && t !== 'bar',
  find: id => typeof id === 'string' && id.startsWith('row') ? { row: +id.slice(3) } : ed.d.g.find(g => g.id === id),
  remove(id) { if (typeof id === 'string' && id.startsWith('row')) return CQ.delRow(+id.slice(3)); ed.d.g = ed.d.g.filter(g => g.id !== id); },
  cell(p) {
    const L = ed.layout; if (!L) return null;
    let r = 0; L.rowY.forEach((y, i) => { if (Math.abs(y - p.y) < Math.abs(L.rowY[r] - p.y)) r = i; });
    if (Math.abs(L.rowY[r] - p.y) > .8) return null;
    if (p.x < L.xs) return { r, c: -1 };
    for (let c = 0; c < L.nc; c++) if (Math.abs(p.x - L.cx[c]) <= L.colW[c] / 2) return { r, c };
    return null;
  },
  place(t, r, c, keepId) {
    const d = ed.d, span = t === 'box' ? Math.max(1, Math.min(2, d.n - r)) : 1;
    for (let k = r; k < r + span; k++) { const g = covering(d, k, c); if (g && g.id !== keepId) d.g = d.g.filter(x => x !== g); }
    const g = { id: keepId || uid(), r, c, t, p: '' }; if (t === 'box') g.span = span;
    d.g.push(g); return g.id;
  },
  down(e, p) {
    const q = CQ.cell(p), L = ed.layout;
    if (ed.tool === 'erase') {
      if (q && q.c >= 0) { const g = covering(ed.d, q.r, q.c); if (g) { CQ.remove(g.id); if (ed.sel === g.id) ed.sel = null; commit(); renderProps(); return; } }
      const bi = ed.d.bar.findIndex(c => Math.abs(L.cx[c] + L.colW[c] / 2 - p.x) < .3); if (bi >= 0) { ed.d.bar.splice(bi, 1); commit(); }
      return;
    }
    if (q && q.c === -1) { setSel('row' + q.r); return; }
    const g = q && q.c >= 0 ? covering(ed.d, q.r, q.c) : null;
    const grab = () => { setSel(g.id); ed.drag = { kind: 'move', id: g.id, from: { r: q.r, c: q.c }, to: null }; };
    if (ed.tool === 'select') { if (g) grab(); else setSel(null); return; }
    if (g && ed.sel === g.id && ed.tool !== 'bar') { grab(); return; }
    if (!q || q.c < 0) return;
    if (ed.tool === 'bar') { const i = ed.d.bar.indexOf(q.c); i >= 0 ? ed.d.bar.splice(i, 1) : ed.d.bar.push(q.c); commit(); return; }
    ed.sel = CQ.place(ed.tool, q.r, q.c); commit(); renderProps();
  },
  move(e, p) {
    const q = CQ.cell(p), dr = ed.drag;
    if (dr?.kind === 'move') { const g = CQ.find(dr.id); dr.to = q && q.c >= 0 ? q : null; ed.hover = dr.to ? { r: dr.to.r, c: dr.to.c, span: g.t === 'box' ? g.span || 2 : 1 } : null; draw(); return; }
    if (ed.tool === 'select' || ed.tool === 'erase') { if (ed.hover) { ed.hover = null; draw(); } return; }
    const h = q && q.c >= 0 ? { r: q.r, c: q.c, span: ed.tool === 'box' ? 2 : 1 } : null;
    if (JSON.stringify(h) !== JSON.stringify(ed.hover)) { ed.hover = h; draw(); }
  },
  up() {
    const dr = ed.drag; ed.drag = null; ed.hover = null;
    if (dr?.kind === 'move' && dr.to && (dr.to.r !== dr.from.r || dr.to.c !== dr.from.c)) {
      const g = CQ.find(dr.id), dr0 = dr.to.r - dr.from.r, nr = clamp(g.r + dr0, 0, ed.d.n - 1);
      const span = g.t === 'box' ? g.span || 2 : 1;
      ed.d.g = ed.d.g.filter(x => x !== g);
      for (let k = nr; k < Math.min(ed.d.n, nr + span); k++) { const o = covering(ed.d, k, dr.to.c); if (o) ed.d.g = ed.d.g.filter(x => x !== o); }
      g.r = Math.min(nr, ed.d.n - span); g.c = dr.to.c; ed.d.g.push(g); commit(); renderProps(); return;
    }
    draw();
  },
  dragOver(p) { const q = p && CQ.cell(p); ed.hover = q && q.c >= 0 ? { r: q.r, c: q.c, span: ed.tool === 'box' ? 2 : 1 } : null; draw(); },
  drop(t, p) { ed.hover = null; const q = CQ.cell(p); if (!q || q.c < 0) { draw(); return; } ed.sel = CQ.place(t, q.r, q.c); commit(); renderProps(); },
  addRow() { const d = ed.d; d.n++; d.inL.push('\\ket{0}'); d.outL.push(''); commit(); renderProps(); },
  delRow(r) {
    const d = ed.d; if (d.n <= 1) return;
    d.g = d.g.filter(g => !(g.r === r || (g.t === 'box' && r > g.r && r < g.r + (g.span || 2) && (g.span || 2) <= 2)));
    d.g.forEach(g => { if (g.r > r) g.r--; else if (g.t === 'box' && r < g.r + (g.span || 2)) g.span = Math.max(1, (g.span || 2) - 1); });
    d.inL.splice(r, 1); d.outL.splice(r, 1); d.n--;
  },
  props() {
    const d = ed.d, s = ed.sel && CQ.find(ed.sel);
    const qubits = `<div class="sec"><h4>Qubits</h4><div class="row"><div class="seg"><button data-p="rowdel" aria-label="Remove the last qubit" ${d.n <= 1 ? 'disabled' : ''}>−</button><button disabled style="min-width:44px;color:var(--fg)">${d.n}</button><button data-p="rowadd" aria-label="Add a qubit">+</button></div><span class="hint">Click a label on the left of a wire to rename it.</span></div></div>`;
    if (!s) return `<div class="sec"><h4>How to draw</h4><div class="hint">Drag gates onto the wires, or pick one and click. A control joins every gate, target or swap in its column with a vertical line. After a measurement the wire turns classical.</div></div>${qubits}${examplesHTML('quantum')}${isEmpty(d) ? '' : '<div class="sec"><button class="btn sm outline danger" data-p="clear">Clear the circuit</button></div>'}`;
    if (s.row != null) {
      const r = s.row;
      return `<div class="sec"><h4>Qubit ${r + 1} — input</h4>${mathInput('inL', d.inL[r], '\\ket{0}')}${chips('inL', ['\\ket{0}', '\\ket{1}', '\\ket{+}', '\\ket{-}', '\\ket{\\psi}', 'q_' + r])}</div>
        <div class="sec"><h4>Output (optional)</h4>${mathInput('outL', d.outL[r], '')}${chips('outL', ['\\ket{\\psi}', '\\ket{0}', 'c_' + r])}</div>
        ${qubits}<div class="sec"><button class="btn sm outline danger" data-p="rowthis" ${d.n <= 1 ? 'disabled' : ''}>${H.icon('trash')}Remove this qubit</button></div>`;
    }
    const q = QT[s.t];
    return `<div class="sec"><h4>${q.n}</h4>
        ${q.param ? `<div class="hint">Angle</div>${mathInput('p', s.p, q.param)}${chips('p', ['\\theta', '\\varphi', '\\tfrac{\\pi}{2}', '\\tfrac{\\pi}{4}', '\\pi'])}` : ''}
        ${q.custom ? `<div class="hint">Name</div>${mathInput('p', s.p, 'U')}${chips('p', ['U', 'U_f', 'V', 'O', '\\mathrm{QFT}', 'U^\\dagger'])}` : ''}
        ${s.t === 'box' ? `<div class="row"><span class="hint" style="width:auto">Covers</span><div class="seg"><button data-p="spanm" ${(s.span || 2) <= 1 ? 'disabled' : ''}>−</button><button disabled style="min-width:72px;color:var(--fg)">${s.span || 2} qubits</button><button data-p="spanp" ${s.r + (s.span || 2) >= d.n ? 'disabled' : ''}>+</button></div></div>` : ''}
        ${isBox(s.t) && !q.custom && !q.param ? '<div class="hint">Swap it for another gate:</div>' : ''}
        ${isBox(s.t) && !q.custom ? `<div class="chips">${['H', 'X', 'Y', 'Z', 'S', 'T', 'Sdg', 'Tdg'].map(k => `<button data-gt="${k}" title="${QT[k].n}">${H.tex(QT[k].lbl(''), false)}</button>`).join('')}</div>` : ''}</div>
      <div class="sec"><button class="btn sm outline danger" data-p="del">${H.icon('trash')}Delete</button></div>`;
  },
  propClick(b) {
    const d = ed.d, s = ed.sel && CQ.find(ed.sel);
    if (b.dataset.ex != null) return loadExample(+b.dataset.ex);
    if (b.dataset.p === 'clear') { d.g = []; d.bar = []; ed.sel = null; commit(); renderProps(); return; }
    if (b.dataset.p === 'rowadd') return CQ.addRow();
    if (b.dataset.p === 'rowdel') { CQ.delRow(d.n - 1); fixSel(); commit(); renderProps(); return; }
    if (!s) return;
    if (b.dataset.p === 'rowthis') { CQ.delRow(s.row); ed.sel = null; commit(); renderProps(); return; }
    if (b.dataset.p === 'del') { CQ.remove(s.id); ed.sel = null; commit(); renderProps(); return; }
    if (b.dataset.p === 'spanp') s.span = Math.min(d.n - s.r, (s.span || 2) + 1);
    else if (b.dataset.p === 'spanm') s.span = Math.max(1, (s.span || 2) - 1);
    else if (b.dataset.gt) s.t = b.dataset.gt;
    else if (b.dataset.chip) { if (s.row != null) d[b.dataset.chip][s.row] = b.dataset.val; else s[b.dataset.chip] = b.dataset.val; }
    else return;
    commit(); renderProps();
  },
  propInput(t) {
    const s = ed.sel && CQ.find(ed.sel), k = t.dataset.k; if (!s || !k) return;
    if (s.row != null) ed.d[k][s.row] = t.value; else s[k] = t.value;
    draw();
  },
};
const CTRL = { feynman: CF, circuit: CC, quantum: CQ };

window.SymvoloDiagrams = {
  init(h) { H = h; if (!document.getElementById('dia-css')) { const s = document.createElement('style'); s.id = 'dia-css'; s.textContent = CSS; document.head.append(s); } },
  html, latex, preamble, open, blank, isEmpty, examples: EXAMPLES,
  name: d => TYPES[d?.type]?.name || 'Diagram',
  isOpen: () => !!ed,
  icon: ICON.dia,
};
})();
