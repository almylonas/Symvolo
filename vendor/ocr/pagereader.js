// Symvolo offline page reader — photos of notes and boards → text + LaTeX blocks, entirely in the browser.
//
//   1. Clean the photo: flatten uneven lighting, flip chalkboards to dark-on-light.
//   2. Find text lines:       PP-OCRv5 mobile detection (DBNet).
//   3. Read each line:        PP-OCRv5 mobile recognition (CTC) → characters with positions and confidences.
//   4. Tell text from maths:  rules on the recognised tokens (words vs. symbols / operators / digits).
//   5. Read formulas:         CoMER (handwritten maths → LaTeX) on cleaned, thinned crops of the formula regions.
//   6. Lay out blocks:        headings, paragraphs, aligned derivations — with positions as fractions of the photo,
//                             the same format the Claude path produces.
//
// MIT — part of Symvolo. Models: PP-OCRv5 (Apache-2.0, PaddlePaddle), CoMER via ink-on (Apache-2.0).

const DET_MAX_SIDE = 1280, REC_H = 48, COMER_H = 256, COMER_CONTENT_H = 112, COMER_MAX_W = 1024;

const yieldUI = () => new Promise(r => setTimeout(r, 0));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function canvas(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
const ctx2d = c => c.getContext('2d', { willReadFrequently: true });

/* ---------- 1. cleaning ---------- */
async function loadImage(blob){
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = canvas(bmp.width * k, bmp.height * k); ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
// Returns a gray Float32Array (0 = ink, 1 = paper) and a canvas showing it.
function cleanPage(src){
  const W = src.width, H = src.height, d = ctx2d(src).getImageData(0, 0, W, H).data, n = W * H;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = (d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114) / 255;
  // polarity: a dark board with light chalk → invert
  const sorted = Float32Array.from(g.filter((_, i) => i % 7 === 0)).sort();
  const median = sorted[sorted.length >> 1];
  const dark = median < .45;
  if (dark) for (let i = 0; i < n; i++) g[i] = 1 - g[i];
  // background estimate: heavy blur of a "max-ish" image (paper is the bright majority)
  const bw = Math.max(8, Math.round(W / 24)), bh = Math.max(8, Math.round(H / 24));
  const small = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const x0 = Math.floor(bx * W / bw), x1 = Math.floor((bx + 1) * W / bw), y0 = Math.floor(by * H / bh), y1 = Math.floor((by + 1) * H / bh);
    const vals = [];
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) vals.push(g[y * W + x]);
    vals.sort((a, b) => a - b); small[by * bw + bx] = vals[Math.floor(vals.length * .7)] || 1;
  }
  // smooth the background grid (3 box passes)
  for (let pass = 0; pass < 3; pass++) {
    const t = small.slice();
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += t[yy * bw + xx]; c++; } }
      small[y * bw + x] = s / c;
    }
  }
  const out = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    const fy = clamp((y + .5) * bh / H - .5, 0, bh - 1), y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = clamp((x + .5) * bw / W - .5, 0, bw - 1), x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
      const b = (small[y0 * bw + x0] * (1 - tx) + small[y0 * bw + x1] * tx) * (1 - ty) + (small[y1 * bw + x0] * (1 - tx) + small[y1 * bw + x1] * tx) * ty;
      out[y * W + x] = clamp(g[y * W + x] / Math.max(.05, b), 0, 1);
    }
  }
  // stretch contrast: darkest 1.5 % → 0
  const s2 = Float32Array.from(out.filter((_, i) => i % 5 === 0)).sort(), lo = s2[Math.floor(s2.length * .015)];
  for (let i = 0; i < n; i++) out[i] = clamp((out[i] - lo) / Math.max(.05, .97 - lo), 0, 1);
  const c = canvas(W, H), cx = ctx2d(c), im = cx.createImageData(W, H);
  for (let i = 0; i < n; i++) { const v = Math.round(out[i] * 255); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  cx.putImageData(im, 0, 0);
  return { gray: out, canvas: c, W, H, dark };
}

/* ---------- 2. line detection (DBNet) ---------- */
async function detectLines(ort, det, page){
  const k = Math.min(1, DET_MAX_SIDE / Math.max(page.W, page.H));
  const w = Math.max(32, Math.round(page.W * k / 32) * 32), h = Math.max(32, Math.round(page.H * k / 32) * 32);
  const c = canvas(w, h); ctx2d(c).drawImage(page.canvas, 0, 0, w, h);
  const d = ctx2d(c).getImageData(0, 0, w, h).data, n = w * h, x = new Float32Array(3 * n);
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) x[ch * n + i] = (d[i * 4 + ch] / 255 - mean[ch]) / std[ch];
  const res = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, h, w]) });
  const prob = res[det.outputNames[0]].data;
  // connected components on prob > .3
  const lab = new Int32Array(n), boxes = [], stack = new Int32Array(n);
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (prob[i] <= .3 || lab[i]) continue;
    cur++; let sp = 0; stack[sp++] = i; lab[i] = cur;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0, cnt = 0;
    while (sp) {
      const p = stack[--sp], px = p % w, py = (p - px) / w;
      sum += prob[p]; cnt++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (px > 0 && !lab[p - 1] && prob[p - 1] > .3) { lab[p - 1] = cur; stack[sp++] = p - 1; }
      if (px < w - 1 && !lab[p + 1] && prob[p + 1] > .3) { lab[p + 1] = cur; stack[sp++] = p + 1; }
      if (py > 0 && !lab[p - w] && prob[p - w] > .3) { lab[p - w] = cur; stack[sp++] = p - w; }
      if (py < h - 1 && !lab[p + w] && prob[p + w] > .3) { lab[p + w] = cur; stack[sp++] = p + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (cnt < 12 || sum / cnt < .5 || Math.max(bw, bh) < 4) continue;
    // DB "unclip": grow the shrunk text kernel back out
    const grow = (bw * bh * 1.6) / (2 * (bw + bh));
    boxes.push({ x0: (x0 - grow) / k, y0: (y0 - grow) / k, x1: (x1 + 1 + grow) / k, y1: (y1 + 1 + grow) / k, score: sum / cnt });
  }
  for (const b of boxes) { b.x0 = clamp(b.x0, 0, page.W); b.x1 = clamp(b.x1, 0, page.W); b.y0 = clamp(b.y0, 0, page.H); b.y1 = clamp(b.y1, 0, page.H); }
  return mergeIntoLines(boxes);
}
const bh_ = b => b.y1 - b.y0, bw_ = b => b.x1 - b.x0;
function mergeIntoLines(boxes){
  let changed = true;
  while (changed) {
    changed = false;
    boxes.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const vov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0), minH = Math.min(bh_(a), bh_(b)), maxH = Math.max(bh_(a), bh_(b));
      const hgap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      if (vov > .5 * minH && hgap < 1.1 * maxH && maxH / minH < 2.6) {
        boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), score: Math.min(a.score, b.score) };
        boxes.splice(j, 1); changed = true; break outer;
      }
    }
  }
  return boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/* ---------- 3. line recognition (CTC) ---------- */
async function recognizeLine(ort, rec, dict, page, b){
  const pad = Math.round(bh_(b) * .08), x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad), x1 = Math.min(page.W, b.x1 + pad), y1 = Math.min(page.H, b.y1 + pad);
  const cw = x1 - x0, ch = y1 - y0;
  const W = clamp(Math.round(REC_H * cw / ch), 16, 3200), c = canvas(W, REC_H);
  const g = ctx2d(c); g.fillStyle = '#fff'; g.fillRect(0, 0, W, REC_H); g.drawImage(page.canvas, x0, y0, cw, ch, 0, 0, W, REC_H);
  const d = g.getImageData(0, 0, W, REC_H).data, n = W * REC_H, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) x[k * n + i] = (d[i * 4 + 2 - k] / 255 - .5) / .5;
  const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, REC_H, W]) });
  const t = out[rec.outputNames[0]], [, T, C] = t.dims, p = t.data;
  const chars = []; let prev = 0;
  for (let s = 0; s < T; s++) {
    let best = 0, bv = -1; const o = s * C;
    for (let k = 0; k < C; k++) if (p[o + k] > bv) { bv = p[o + k]; best = k; }
    if (best !== 0 && best !== prev) { const chr = best - 1 < dict.length ? dict[best - 1] : ' '; chars.push({ c: chr === '　' ? ' ' : chr, p: bv, x: x0 + (s + .5) / T * cw }); }
    prev = best;
  }
  for (const c of chars) c.c = normChar(c.c);
  const text = chars.map(c => c.c).join('').replace(/\s+/g, ' ').trim();
  const conf = chars.length ? chars.reduce((a, c) => a + c.p, 0) / chars.length : 0;
  return { text, conf, chars };
}

// Characters the multilingual reader likes to return for Latin handwriting
const CONFUSE = { 'ν': 'v', 'ο': 'o', 'α': 'a', 'ι': 'i', 'κ': 'k', 'τ': 't', 'χ': 'x', 'ρ': 'p', 'υ': 'u', 'η': 'n', 'ϲ': 'c', 'ј': 'j', 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', '‘': "'", '’': "'", '“': '"', '”': '"', '—': '-', '–': '-', '−': '-' };
function normChar(c){ const n = c.normalize('NFKC'); return CONFUSE[n] ?? n; }

/* ---------- 4. text or maths? ---------- */
const FUNC = new Set(['sin', 'cos', 'tan', 'cot', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'det', 'dim', 'ker', 'im', 'sup', 'inf', 'mod', 'arg', 'deg', 'gcd', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'rank', 'tr', 'span']);
const SHORT = new Set(['a', 'an', 'as', 'at', 'be', 'by', 'do', 'if', 'in', 'is', 'it', 'of', 'on', 'or', 'so', 'to', 'we', 'and', 'are', 'for', 'let', 'the', 'not', 'all', 'any', 'has', 'its', 'one', 'two', 'iff', 'with', 'then', 'that', 'this', 'when',
  'am', 'da', 'es', 'im', 'ob', 'zu', 'ab', 'an', 'auf', 'aus', 'bei', 'bis', 'das', 'dem', 'den', 'der', 'des', 'die', 'ein', 'für', 'fur', 'hat', 'ist', 'mit', 'nur', 'sei', 'und', 'von', 'vom', 'zum', 'zur', 'wir', 'gilt', 'oder', 'dann', 'also', 'eine', 'wenn', 'sind', 'nach',
  'de', 'du', 'en', 'et', 'il', 'la', 'le', 'un', 'les', 'des', 'est', 'une', 'pour', 'avec', 'dans', 'soit', 'si', 'el', 'lo', 'los', 'las', 'que', 'con', 'por', 'para', 'y', 'o', 'e', 'i', 'k', 'w', 'u']);
const MATHY = /[=+<>^_∫∑√π∞≤≥≈≠±×÷·|∂∇∈∀∃→⇒⇔αβγδεθλμσφωΔΣΩ]/;
function tokenKind(tok, neighbourWords){
  const t = tok.replace(/^[("'„“]+|[.,;:!?)"'“”]+$/g, '');
  if (!t) return 'punct';
  if (MATHY.test(t)) return 'math';
  if (/[()[\]{}\/*]/.test(t) && !/^[A-Za-zÀ-ÿß]+$/.test(t)) return 'math';
  const letters = (t.match(/[A-Za-zÀ-ÿß]/g) || []).length, digits = (t.match(/\d/g) || []).length;
  if (digits && digits >= letters) return 'math';
  const lw = t.toLowerCase();
  if (FUNC.has(lw)) return 'math';
  if (letters >= 3 && letters >= t.length * .8) return 'word';
  if (SHORT.has(lw) && (t.length > 1 || neighbourWords)) return 'word';
  return 'math';
}
function splitTokens(line){
  // whitespace-separated tokens with x-ranges from the CTC character positions
  const toks = []; let cur = null;
  for (const ch of line.chars) {
    if (ch.c === ' ') { if (cur) { toks.push(cur); cur = null; } continue; }
    if (!cur) cur = { s: '', xs: ch.x, xe: ch.x, p: 0, n: 0 };
    cur.s += ch.c; cur.xe = ch.x; cur.p += ch.p; cur.n++;
  }
  if (cur) toks.push(cur);
  toks.forEach((t, i) => { const nb = [toks[i - 1], toks[i + 1]].some(o => o && /^[A-Za-zÀ-ÿß]{3,}$/.test(o.s)); t.kind = tokenKind(t.s, nb); t.p /= t.n; });
  return toks;
}

/* ---------- 5. formulas via CoMER ---------- */
function otsu(vals){
  const hist = new Array(256).fill(0); for (const v of vals) hist[Math.round(v * 255)]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128; const tot = vals.length;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2; if (between > best) { best = between; thr = i; } }
  return thr / 255;
}
function thin(img, w, h){ // Zhang–Suen skeleton, in place on a 0/1 Uint8Array
  const idx = (x, y) => y * w + x; let changed = true; const del = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (!img[idx(x, y)]) continue;
        const P = [img[idx(x, y - 1)], img[idx(x + 1, y - 1)], img[idx(x + 1, y)], img[idx(x + 1, y + 1)], img[idx(x, y + 1)], img[idx(x - 1, y + 1)], img[idx(x - 1, y)], img[idx(x - 1, y - 1)]];
        const B = P.reduce((a, b) => a + b, 0); if (B < 2 || B > 6) continue;
        let A = 0; for (let k = 0; k < 8; k++) if (!P[k] && P[(k + 1) % 8]) A++;
        if (A !== 1) continue;
        if (step === 0 ? (P[0] * P[2] * P[4] || P[2] * P[4] * P[6]) : (P[0] * P[2] * P[6] || P[0] * P[4] * P[6])) continue;
        del.push(idx(x, y));
      }
      if (del.length) { changed = true; for (const i of del) img[i] = 0; }
    }
  }
}
function comerInput(page, r){
  // crop → ink mask → tight box → scale to ≤112 px high → skeleton → 3 px strokes, white on black, top-left
  const x0 = Math.max(0, Math.floor(r.x0)), y0 = Math.max(0, Math.floor(r.y0)), x1 = Math.min(page.W, Math.ceil(r.x1)), y1 = Math.min(page.H, Math.ceil(r.y1));
  const cw = x1 - x0, ch = y1 - y0; if (cw < 4 || ch < 4) return null;
  const vals = []; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(page.gray[y * page.W + x]);
  const thr = Math.min(.75, otsu(vals));
  let tx0 = cw, ty0 = ch, tx1 = -1, ty1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (vals[y * cw + x] < thr) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
  if (tx1 < 0) return null;
  const iw = tx1 - tx0 + 1, ih = ty1 - ty0 + 1;
  const s = Math.min(COMER_CONTENT_H / ih, (COMER_MAX_W - 32) / iw), dw = Math.max(1, Math.round(iw * s)), dh = Math.max(1, Math.round(ih * s));
  // scale the ink mask by area sampling
  const m = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx0 = tx0 + Math.floor(x / s), sx1 = Math.max(sx0 + 1, tx0 + Math.floor((x + 1) / s)), sy0 = ty0 + Math.floor(y / s), sy1 = Math.max(sy0 + 1, ty0 + Math.floor((y + 1) / s));
    let ink = 0, tot = 0;
    for (let yy = sy0; yy < Math.min(ch, sy1); yy++) for (let xx = sx0; xx < Math.min(cw, sx1); xx++) { tot++; if (vals[yy * cw + xx] < thr) ink++; }
    m[y * dw + x] = tot && ink / tot > .35 ? 1 : 0;
  }
  const PADW = 2, w = dw + PADW * 2, h = dh + PADW * 2, img = new Uint8Array(w * h);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) img[(y + PADW) * w + x + PADW] = m[y * dw + x];
  thin(img, w, h);
  const OFF = 8, canvasW = clamp(Math.ceil((w + OFF * 2) / 64) * 64, 128, COMER_MAX_W);
  const tensor = new Float32Array(COMER_H * canvasW);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!img[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + OFF + dx, Y = y + OFF + dy; if (X >= 0 && X < canvasW && Y >= 0 && Y < COMER_H) tensor[Y * canvasW + X] = 1;
    }
  }
  const contentW = Math.min(canvasW, w + OFF * 2), contentH = Math.min(COMER_H, h + OFF * 2), mask = new Uint8Array(COMER_H * canvasW);
  for (let y = 0; y < COMER_H; y++) for (let x = 0; x < canvasW; x++) mask[y * canvasW + x] = y < contentH && x < contentW ? 0 : 1;
  return { tensor, height: COMER_H, width: canvasW, mask, maskHeight: COMER_H, maskWidth: canvasW };
}
function tidyTex(s){
  let out = '';
  for (const tok of String(s || '').trim().split(/\s+/).filter(Boolean)) { if (out && /\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(tok)) out += ' '; out += tok; }
  return out;
}
async function readFormula(ink, page, r){
  const input = comerInput(page, r); if (!input) return '';
  try { return tidyTex((await ink.engine.recognize(input, ink.vocab, 'auto')).latex); } catch { return ''; }
}
// Functions the formula model has no symbol for; when the text reader sees one, its reading wins.
const OPNAME = { dim: '\\dim', ker: '\\ker', det: '\\det', exp: '\\exp', ln: '\\ln', max: '\\max', min: '\\min', sup: '\\sup', inf: '\\inf', arg: '\\arg', deg: '\\deg', gcd: '\\gcd', mod: '\\bmod', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan', cot: '\\cot', im: '\\operatorname{im}', rank: '\\operatorname{rank}', span: '\\operatorname{span}', tr: '\\operatorname{tr}', sin: '\\sin', cos: '\\cos', tan: '\\tan', log: '\\log', lim: '\\lim' };
const NOT_IN_COMER = /\b(dim|ker|det|exp|ln|max|min|sup|inf|arg|deg|gcd|mod|sinh|cosh|tanh|arc\w+|cot|im|rank|span|tr)(?=[A-Z\s(]|$)/;
function ocrToTex(s){
  return s.replace(/[{}#%&$]/g, c => '\\' + c).replace(/\b(arcsin|arccos|arctan|sinh|cosh|tanh|rank|span|sin|cos|tan|cot|log|lim|dim|ker|det|exp|max|min|sup|inf|arg|deg|gcd|mod|ln|im|tr)(?=[A-Z\s(\d]|$)/g, (m) => OPNAME[m] + ' ')
    .replace(/·/g, '\\cdot ').replace(/×/g, '\\times ').replace(/≤/g, '\\le ').replace(/≥/g, '\\ge ').replace(/≠/g, '\\neq ').replace(/≈/g, '\\approx ')
    .replace(/π/g, '\\pi ').replace(/∞/g, '\\infty ').replace(/√/g, '\\sqrt ').replace(/∫/g, '\\int ').replace(/∑/g, '\\sum ').replace(/→/g, '\\to ')
    .replace(/\^(?![\w({])/g, '').replace(/\s+/g, ' ').trim();
}
const texLen = t => t.replace(/\\(begin|end)\{[a-z]+\}/g, '').replace(/\\[a-zA-Z]+/g, '#').replace(/[{}^_\s&]|\\\\/g, '').length;
// CoMER for the 2-D structure, the text reader as a sanity check and a fallback.
async function bestFormula(ink, page, r, ocr, conf){
  const plain = ocr.replace(/\s+/g, '');
  if (NOT_IN_COMER.test(ocr) && conf >= .6) return { tex: ocrToTex(ocr), weak: true };
  const tex = await readFormula(ink, page, r);
  if (!tex) return { tex: ocrToTex(ocr), weak: true };
  if (conf >= .55 && plain.length >= 2 && texLen(tex) < .55 * plain.length) return { tex: ocrToTex(ocr), weak: true };
  return { tex, weak: false };
}

/* ---------- 6. blocks ---------- */
function alignRows(rows){
  if (rows.length === 1) return rows[0];
  const withEq = rows.map(r => { const i = topLevelIndex(r, '='); return i < 0 ? r : r.slice(0, i) + '&' + r.slice(i); });
  return '\\begin{aligned}' + withEq.map(r => r.startsWith('&') ? r : (withEq.some(x => x.includes('&')) && /^\s*=/.test(r) ? '&' + r : r)).join(' \\\\ ') + '\\end{aligned}';
}
function topLevelIndex(s, ch){ let d = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '{') d++; else if (c === '}') d--; else if (c === ch && d === 0) return i; } return -1; }

export async function createPageReader({ ort, ink, fetchModel }){
  const [detBuf, recBuf, dictTxt] = await Promise.all([fetchModel('det_v5.ort'), fetchModel('rec_v5.onnx'), fetchModel('dict_v5.txt', 'text')]);
  const opts = { executionProviders: ['wasm'] };
  const det = await ort.InferenceSession.create(new Uint8Array(detBuf), opts);
  const rec = await ort.InferenceSession.create(new Uint8Array(recBuf), opts);
  // ppocrv5_dict.txt as shipped starts with an ideographic space that the model's output layer doesn't have:
  // classes are [blank, dict lines 2…N, ' '].
  const dict = dictTxt.split(/\r?\n/); if (dict.at(-1) === '') dict.pop(); if (dict[0] === '\u3000') dict.shift();

  async function read(blob, { onProgress = () => {}, signal } = {}){
    const stop = () => { if (signal?.aborted) throw { code: 'cancelled' }; };
    onProgress('Cleaning up the photo…');
    const page = cleanPage(await loadImage(blob)); await yieldUI(); stop();
    onProgress('Finding lines…');
    const boxes = await detectLines(ort, det, page); stop();
    const lines = [];
    for (let i = 0; i < boxes.length; i++) {
      onProgress(`Reading line ${i + 1} of ${boxes.length}…`);
      const b = boxes[i], r = await recognizeLine(ort, rec, dict, page, b); await yieldUI(); stop();
      if (!r.text) continue;
      const toks = splitTokens(r);
      const nWord = toks.filter(t => t.kind === 'word').length, nMath = toks.filter(t => t.kind === 'math').length;
      const rel = toks.some(t => /[=<>≤≥≈≠]/.test(t.s)), longWords = toks.filter(t => t.kind === 'word' && t.s.length >= 4).length;
      const kind = !nMath ? 'text' : !nWord ? 'math'
        : (rel && longWords <= 1 && nMath >= 2 * nWord) ? 'math'   // "dim V = dim ker T + …": a stray word-like token inside a formula
        : (nWord >= 2 || longWords >= 1) ? 'mixed' : 'math';
      lines.push({ ...b, ...r, toks, kind });
    }
    // merge stacked formula pieces (fractions: numerator / bar / denominator) into one region
    const medH = (() => { const hs = lines.map(bh_).sort((a, b) => a - b); return hs[hs.length >> 1] || 40; })();
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < lines.length && !changed; i++) for (let j = 0; j < lines.length && !changed; j++) {
        if (i === j) continue; const a = lines[i], b = lines[j];
        if (a.kind === 'text' || b.kind === 'text' || a.kind === 'mixed' && b.kind === 'mixed') continue;
        const gap = b.y0 - a.y1, hov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const small = Math.min(bh_(a), bh_(b)) < .75 * medH || Math.min(bw_(a), bw_(b)) < .45 * Math.max(bw_(a), bw_(b));
        if (gap > -.3 * medH && gap < .45 * medH && hov > .5 * Math.min(bw_(a), bw_(b)) && small) {
          const m = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), text: a.text + ' ' + b.text, conf: Math.min(a.conf, b.conf), toks: [], kind: a.kind === 'mixed' || b.kind === 'mixed' ? 'mixed' : 'math', merged: true, chars: [...a.chars, ...b.chars] };
          if (m.kind === 'mixed') m.toks = [...a.toks, ...b.toks];
          lines.splice(Math.max(i, j), 1); lines.splice(Math.min(i, j), 1, m); changed = true;
        }
      }
    }
    lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    // read the maths
    const nF = lines.filter(l => l.kind !== 'text').length; let done = 0;
    for (const l of lines) {
      if (l.kind === 'text') { l.out = l.text; continue; }
      onProgress(`Reading formula ${++done} of ${nF}…`); stop();
      if (l.kind === 'math') {
        const f = await bestFormula(ink, page, l, l.text, l.conf);
        l.out = f.tex; l.weak = f.weak;
      } else {
        // mixed: words stay text, runs of maths become inline $…$ read by CoMER on their sub-crop
        let s = '', run = [];
        const flush = async () => {
          if (!run.length) return;
          const pad = .25 * bh_(l), r = { x0: run[0].xs - pad, x1: run.at(-1).xe + pad, y0: l.y0, y1: l.y1 };
          const raw = run.map(t => t.s).join(' ');
          const conf = run.reduce((a, t) => a + t.p, 0) / run.length;
          const f = run.length === 1 && /^[A-Za-z]$/.test(raw) ? { tex: raw } : await bestFormula(ink, page, r, raw, conf);
          s += (s && !s.endsWith(' ') ? ' ' : '') + '$' + f.tex + '$ '; if (f.weak) l.weak = true; run = [];
        };
        for (const t of l.toks) { if (t.kind === 'math') run.push(t); else { await flush(); s += t.s + ' '; } }
        await flush(); l.out = s.replace(/\s+/g, ' ').replace(/ ([.,;:!?])/g, '$1').trim();
      }
      await yieldUI();
    }
    // group into blocks
    const textH = (() => { const hs = lines.filter(l => l.kind !== 'math').map(bh_).sort((a, b) => a - b); return hs[hs.length >> 1] || medH; })();
    const pitch = l => bw_(l) / Math.max(1, l.text.length);
    const textPitch = (() => { const ps = lines.filter(l => l.kind !== 'math' && l.text.length >= 4).map(pitch).sort((a, b) => a - b); return ps[ps.length >> 1] || 30; })();
    const blocks = [];
    for (const l of lines) {
      const last = blocks.at(-1), h = bh_(l);
      const others = lines.filter(o => o !== l && o.kind !== 'math' && o.text.length >= 4), med = (arr) => { const v = arr.sort((a, b) => a - b); return v[v.length >> 1]; };
      const oP = others.length ? med(others.map(pitch)) : textPitch, oH = others.length ? med(others.map(bh_)) : textH, words = l.text.split(' ').length;
      const heading = l.kind === 'text' && l.text.length >= 3 && words <= 6 && !/[.:,;]$/.test(l.text)
        && (pitch(l) > 1.2 * oP || h > 1.25 * oH || (l === lines[0] && words <= 4 && pitch(l) > oP));
      const near = last && l.y0 - last.y1 < .9 * Math.max(h, last.lh) && Math.abs(l.x0 - last.x0) < 2.2 * Math.max(h, last.lh);
      if (near && !heading && !last.heading && last.kind === 'math' && l.kind === 'math') { last.rows.push(l.out); Object.assign(last, ext(last, l)); last.weak ||= l.weak; last.conf = Math.min(last.conf, l.conf); continue; }
      if (near && !heading && !last.heading && last.kind !== 'math' && l.kind !== 'math') { last.rows.push(l.out); Object.assign(last, ext(last, l)); last.weak ||= l.weak; last.conf = Math.min(last.conf, l.conf); continue; }
      blocks.push({ kind: l.kind === 'math' ? 'math' : 'text', heading, rows: [l.out], x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, lh: h, conf: l.conf, weak: l.weak });
    }
    function ext(a, b){ return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }; }
    return blocks.map(b => {
      const content = b.kind === 'math' ? alignRows(b.rows) : (b.heading ? '# ' : '') + b.rows.map(r => r.replace(/^[•·*]\s*/, '- ')).join('\n');
      const unsure = b.weak || b.conf < .75;
      return { kind: b.kind, content, x: b.x0 / page.W, y: b.y0 / page.H, w: Math.max(.12, (b.x1 - b.x0) / page.W), unsure,
        note: unsure ? (b.weak ? 'read on this device — the formula reader could not make sense of part of it' : 'read on this device with low confidence') : undefined };
    });
  }
  return { read };
}
