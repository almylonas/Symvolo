/* Symvolo — typeset pages → PDF with real text.
   Walks the laid-out LaTeX pages and writes every word as selectable, searchable text in the
   embedded Computer Modern fonts (KaTeX's, plus CMU Serif for accented letters, Greek and
   Cyrillic), rules and borders as vector rectangles, SVG (root signs, arrows, diagrams) as
   vector paths through svg2pdf, and photos as images. Positions come from the browser's own
   layout, so the PDF matches the preview exactly. */
(function () {
'use strict';
const BASE = 'vendor/pdf/';
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/;
let COV = null;
const fileCache = new Map();

async function fetchBin(path) {
  for (const u of [path, path + '.wasm']) {
    try { const r = await fetch(u); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch {}
  }
  throw new Error('Could not load ' + path);
}
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s); });

async function coverage() {
  if (COV) return COV;
  const r = await fetch(BASE + 'coverage.json'); if (!r.ok) throw new Error('Could not load font coverage');
  COV = await r.json();
  for (const [id, f] of Object.entries(COV)) f.id = id;
  return COV;
}
function has(face, cp) {
  const R = face.ranges; let lo = 0, hi = R.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cp < R[m][0]) hi = m - 1; else if (cp > R[m][1]) lo = m + 1; else return true; }
  return false;
}
// CSS font-family list → the families we can embed
const ALIAS = { 'latin modern roman': 'CMU Serif', 'cmu serif': 'CMU Serif', 'times new roman': 'CMU Serif', 'times': 'CMU Serif', 'serif': 'CMU Serif', 'courier new': 'KaTeX_Typewriter', 'courier': 'KaTeX_Typewriter', 'monospace': 'KaTeX_Typewriter' };
const famCache = new Map();
function families(css) {
  let f = famCache.get(css); if (f) return f;
  f = css.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).map(s => s.startsWith('KaTeX_') ? s : ALIAS[s.toLowerCase()] || null).filter(Boolean);
  if (!f.includes('CMU Serif')) f.push('CMU Serif');   // the browser's last resort becomes ours too
  famCache.set(css, f); return f;
}
const faceCache = new Map();
function faceFor(fams, bold, italic, cp) {
  const key = fams.join(',') + (bold ? 'b' : '') + (italic ? 'i' : '') + cp;
  if (faceCache.has(key)) return faceCache.get(key);
  let best = null;
  for (const fam of fams) {
    let score = -1;
    for (const f of Object.values(COV)) {
      if (f.family !== fam || !has(f, cp)) continue;
      const s = (f.italic === italic ? 2 : 0) + (f.bold === bold ? 1 : 0);
      if (s > score) { score = s; best = f; }
    }
    if (best) break;
  }
  faceCache.set(key, best); return best;
}

/* ---------- colour and baseline ---------- */
function rgba(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
const baseCache = new Map();
function baseline(cs, host) {      // distance from the top of a text box to its baseline, per px of font size
  const key = cs.fontFamily + '|' + cs.fontWeight + '|' + cs.fontStyle;
  let v = baseCache.get(key); if (v != null) return v;
  const s = document.createElement('span');
  s.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;line-height:normal;font-size:100px;font-family:${cs.fontFamily};font-weight:${cs.fontWeight};font-style:${cs.fontStyle}`;
  s.textContent = 'x'; const mark = document.createElement('span'); mark.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline'; s.append(mark); host.append(s);
  const r = document.createRange(); r.selectNodeContents(s.firstChild);
  v = (mark.getBoundingClientRect().top - r.getBoundingClientRect().top) / 100; s.remove();
  baseCache.set(key, v); return v;
}

/* ---------- pass 1: turn a laid-out page into drawing operations ---------- */
function collect(page) {
  const pr = page.getBoundingClientRect(), ops = [];
  const box = r => ({ x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height });
  const inter = (a, b) => { if (!a) return b; if (!b) return a; const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y); return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) }; };
  const outside = (b, c) => c && (b.x > c.x + c.w || b.y > c.y + c.h || b.x + b.w < c.x || b.y + b.h < c.y);

  function text(node, cs, clip) {
    const s = node.data; if (!/\S/.test(s)) return;
    const col = rgba(cs.color); if (!col || col.a < .05) return;
    const fams = families(cs.fontFamily), bold = (parseInt(cs.fontWeight) || 400) >= 600, italic = cs.fontStyle !== 'normal';
    const size = parseFloat(cs.fontSize), base = baseline(cs, page) * size;
    const re = /\S+/g; let m;
    const rg = document.createRange();
    while ((m = re.exec(s))) {
      const chars = []; let i = m.index;
      for (const ch of m[0]) {
        const at = i; i += ch.length;
        if (INVISIBLE.test(ch)) continue;
        rg.setStart(node, at); rg.setEnd(node, at + ch.length);
        const r = [...rg.getClientRects()].find(q => q.width > 0 || q.height > 0); if (!r) continue;
        const b = box(r); if (outside(b, clip)) continue;
        chars.push({ s: ch, x: b.x, y: b.y + base, w: b.w, h: b.h, top: b.y, face: faceFor(fams, bold, italic, ch.codePointAt(0)) });
      }
      if (!chars.length) continue;
      // keep runs that share a face and a baseline together as one text object
      let run = null;
      for (const c of chars) {
        if (run && run.face === c.face && Math.abs(run.y - c.y) < .5 && c.face) { run.chars.push(c); run.s += c.s; continue; }
        run = { t: c.face ? 'text' : 'raster', face: c.face, s: c.s, x: c.x, y: c.y, size, col, chars: [c], font: `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}` };
        ops.push(run);
      }
    }
  }
  function visit(el, clip) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || +cs.opacity === 0) return;
    const r = el.getBoundingClientRect(), b = box(r), shown = cs.visibility !== 'hidden';
    if (shown && el !== page) {
      const bg = rgba(cs.backgroundColor);
      if (bg && bg.a > .05 && b.w > 0 && b.h > 0 && !outside(b, clip)) ops.push({ t: 'rect', ...b, col: bg });
      const side = (w, st, c, rect) => { const wd = parseFloat(w); const cc = rgba(c); if (wd > 0 && st !== 'none' && st !== 'hidden' && cc && cc.a > .05) ops.push({ t: 'rect', ...rect(wd), col: cc }); };
      side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor, w => ({ x: b.x, y: b.y, w: b.w, h: w }));
      side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor, w => ({ x: b.x, y: b.y + b.h - w, w: b.w, h: w }));
      side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor, w => ({ x: b.x, y: b.y, w, h: b.h }));
      side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor, w => ({ x: b.x + b.w - w, y: b.y, w, h: b.h }));
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') { if (shown && b.w > 0 && !outside(b, clip)) ops.push({ t: 'img', el, ...b, clip }); return; }
    if (tag === 'svg') { if (shown && b.w > 0 && b.h > 0 && !outside(b, clip)) ops.push({ t: 'svg', el, cs, ...b, clip }); return; }
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clip = inter(clip, b);
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (shown) text(n, cs, clip); }
      else if (n.nodeType === 1) visit(n, clip);
    }
  }
  visit(page, null);
  return { ops, w: pr.width, h: pr.height };
}

/* ---------- pass 2: write the PDF ---------- */
async function addFonts(pdf, ids) {
  await Promise.all([...ids].map(async id => {
    if (!fileCache.has(id)) fileCache.set(id, fetchBin(BASE + 'fonts/' + id + '.ttf').then(b64));
    pdf.addFileToVFS(id + '.ttf', await fileCache.get(id));
    pdf.addFont(id + '.ttf', id, 'normal', 'normal', 'Identity-H');
  }));
}
function imageData(el) {
  const src = el.currentSrc || el.src;
  if (/^data:image\/(jpeg|png)/i.test(src)) return { data: src, fmt: /png/i.test(src) ? 'PNG' : 'JPEG' };
  const c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(el, 0, 0);
  return { data: c.toDataURL('image/jpeg', .92), fmt: 'JPEG' };
}
function clipTo(pdf, c, k) { pdf.saveGraphicsState(); pdf.rect(c.x * k, c.y * k, c.w * k, c.h * k, null); pdf.clip(); pdf.discardPath(); }

async function render(pages, opts = {}) {
  await coverage();
  if (!window.jspdf) await loadScript('vendor/jspdf.umd.min.js');
  if (!window.svg2pdf) await loadScript(BASE + 'svg2pdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  const PW = pdf.internal.pageSize.getWidth();
  const laid = pages.map(collect);
  const need = new Set(); laid.forEach(p => p.ops.forEach(o => o.t === 'text' && need.add(o.face.id)));
  await addFonts(pdf, need);
  const svgHost = document.createElement('div'); svgHost.style.cssText = 'position:absolute;left:-99999px;top:0;width:10px;height:10px;overflow:hidden'; document.body.append(svgHost);
  try {
    for (let i = 0; i < laid.length; i++) {
      if (i) pdf.addPage();
      const k = PW / laid[i].w;
      let font = null, size = 0, color = '';
      for (const o of laid[i].ops) {
        if (o.t === 'rect') { pdf.setFillColor(o.col.r, o.col.g, o.col.b); pdf.rect(o.x * k, o.y * k, Math.max(o.w * k, .1), Math.max(o.h * k, .1), 'F'); continue; }
        if (o.t === 'img') {
          const im = imageData(o.el);
          if (o.clip) clipTo(pdf, o.clip, k);
          pdf.addImage(im.data, im.fmt, o.x * k, o.y * k, o.w * k, o.h * k, undefined, 'FAST');
          if (o.clip) pdf.restoreGraphicsState();
          continue;
        }
        if (o.t === 'svg') {
          const c = o.el.cloneNode(true);
          c.setAttribute('width', o.w); c.setAttribute('height', o.h);
          if (!c.getAttribute('fill')) c.setAttribute('fill', o.cs.fill && o.cs.fill !== 'none' ? o.cs.fill : 'none');
          if (!c.getAttribute('stroke') && o.cs.stroke && o.cs.stroke !== 'none' && parseFloat(o.cs.strokeWidth) > 0) { c.setAttribute('stroke', o.cs.stroke); c.setAttribute('stroke-width', o.cs.strokeWidth); }
          svgHost.replaceChildren(c);
          if (o.clip) clipTo(pdf, o.clip, k);
          try { await window.svg2pdf.svg2pdf(c, pdf, { x: o.x * k, y: o.y * k, width: o.w * k, height: o.h * k }); }
          catch (e) { console.warn('svg2pdf', e); }
          if (o.clip) pdf.restoreGraphicsState();
          font = null; color = '';   // svg2pdf changes the graphics state
          continue;
        }
        if (o.t === 'raster') {      // a script none of the embedded fonts covers: keep its look as a picture
          const c0 = o.chars[0], sc = 4, cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.ceil(c0.w * sc)); cv.height = Math.max(1, Math.ceil(c0.h * sc));
          const g = cv.getContext('2d'); g.scale(sc, sc); g.font = o.font; g.fillStyle = `rgb(${o.col.r},${o.col.g},${o.col.b})`; g.textBaseline = 'alphabetic';
          g.fillText(o.s, 0, c0.y - c0.top);
          pdf.addImage(cv.toDataURL('image/png'), 'PNG', c0.x * k, c0.top * k, c0.w * k, c0.h * k, undefined, 'FAST');
          continue;
        }
        // text
        if (font !== o.face.id) { pdf.setFont(o.face.id, 'normal'); font = o.face.id; size = 0; }
        if (size !== o.size) { pdf.setFontSize(o.size * k); size = o.size; }
        const cc = `${o.col.r},${o.col.g},${o.col.b}`; if (cc !== color) { pdf.setTextColor(o.col.r, o.col.g, o.col.b); color = cc; }
        const last = o.chars.at(-1), span = (last.x + last.w - o.x) * k;
        if (o.chars.length === 1 || Math.abs(pdf.getTextWidth(o.s) - span) <= Math.max(.25, span * .006)) pdf.text(o.s, o.x * k, o.y * k);
        else for (const c of o.chars) pdf.text(c.s, c.x * k, c.y * k);
      }
    }
  } finally { svgHost.remove(); }
  pdf.setProperties({ title: opts.title || '', author: opts.author || '', creator: 'Symvolo', subject: 'Typeset with KaTeX fonts (Computer Modern)' });
  return pdf.output('blob');
}

window.SymvoloPDF = { render };
})();
