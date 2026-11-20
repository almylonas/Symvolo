// Texo formula recogniser (image → LaTeX) for Symvolo's offline photo reader.
// Model: Texo by Sicheng Mao (https://github.com/alephpi/Texo), AGPL-3.0 — 20M-parameter HGNetV2 encoder +
// 2-layer mBART decoder, trained on UniMER-1M (printed and handwritten maths). The ONNX export comes from
// Texo-web; Symvolo ships it with 8-bit matrix weights (onnxruntime dynamic quantisation, encoder convolutions
// left in float) and the encoder split into <20 MB parts.
//
// Preprocessing follows Texo-web's imageProcessor.ts: grey, dark-on-light, crop to ink, fit into 384×384
// (centred, black padding), normalise with mean 0.7931 / std 0.1738, three identical channels.

const SIZE = 384, MEAN = .7931, STD = .1738, MAX_STEPS = 256;

export async function createTexo({ ort, fetchModel }){
  const parts = [];
  for (let i = 0; ; i++) { // encoder_int8.onnx.000, .001, … (missing part = done)
    const name = 'texo/encoder_int8.onnx.' + String(i).padStart(3, '0');
    let buf; try { buf = await fetchModel(name); } catch { if (i) break; throw new Error('Texo encoder missing'); }
    parts.push(new Uint8Array(buf));
  }
  const total = parts.reduce((a, p) => a + p.length, 0), encBytes = new Uint8Array(total);
  let off = 0; for (const p of parts) { encBytes.set(p, off); off += p.length; }
  const [decBuf, tokTxt] = await Promise.all([fetchModel('texo/decoder_int8.onnx'), fetchModel('texo/tokenizer.json', 'text')]);
  const opts = { executionProviders: ['wasm'] };
  const enc = await ort.InferenceSession.create(encBytes, opts);
  const dec = await ort.InferenceSession.create(new Uint8Array(decBuf), opts);
  const vocab = JSON.parse(tokTxt).model.vocab, id2tok = [];
  for (const [t, i] of Object.entries(vocab)) id2tok[i] = t;
  const pastNames = dec.inputNames.filter(n => n.startsWith('past_key_values'));
  const empty = () => new ort.Tensor('float32', new Float32Array(0), [1, 16, 0, 24]);

  // gray: Float32Array page (0 = ink, 1 = paper), W×H; r: crop box in page pixels
  function prepare(gray, W, H, r){
    const x0 = Math.max(0, Math.floor(r.x0)), y0 = Math.max(0, Math.floor(r.y0)), x1 = Math.min(W, Math.ceil(r.x1)), y1 = Math.min(H, Math.ceil(r.y1));
    let cw = x1 - x0, ch = y1 - y0; if (cw < 4 || ch < 4) return null;
    const v = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) v[y * cw + x] = gray[(y0 + y) * W + x0 + x] * 255;
    // Texo-web: invert if dark pixels dominate
    let dark = 0; for (const p of v) if (p < 200) dark++;
    if (dark >= v.length - dark) for (let i = 0; i < v.length; i++) v[i] = 255 - v[i];
    // crop to ink (normalised < 200)
    let mn = 255, mx = 0; for (const p of v) { if (p < mn) mn = p; if (p > mx) mx = p; }
    let ix0 = cw, iy0 = ch, ix1 = -1, iy1 = -1;
    if (mx > mn) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if ((v[y * cw + x] - mn) / (mx - mn) * 255 < 200) { if (x < ix0) ix0 = x; if (x > ix1) ix1 = x; if (y < iy0) iy0 = y; if (y > iy1) iy1 = y; }
    if (ix1 < ix0) { ix0 = 0; iy0 = 0; ix1 = cw - 1; iy1 = ch - 1; }
    const iw = Math.max(1, ix1 - ix0), ih = Math.max(1, iy1 - iy0);
    const src = document.createElement('canvas'); src.width = iw; src.height = ih;
    const sctx = src.getContext('2d'), sim = sctx.createImageData(iw, ih);
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = v[(iy0 + y) * cw + ix0 + x], i = (y * iw + x) * 4; sim.data[i] = sim.data[i + 1] = sim.data[i + 2] = p; sim.data[i + 3] = 255; }
    sctx.putImageData(sim, 0, 0);
    // fit: scale shorter side to 384, then shrink to fit
    let s = SIZE / Math.min(iw, ih), nw = Math.round(iw * s), nh = Math.round(ih * s);
    if (nw > SIZE || nh > SIZE) { const q = Math.min(SIZE / nw, SIZE / nh); nw = Math.max(1, Math.round(nw * q)); nh = Math.max(1, Math.round(nh * q)); }
    const dst = document.createElement('canvas'); dst.width = SIZE; dst.height = SIZE;
    const d = dst.getContext('2d', { willReadFrequently: true }); d.fillStyle = '#000'; d.fillRect(0, 0, SIZE, SIZE);
    d.imageSmoothingEnabled = true; d.imageSmoothingQuality = 'high';
    d.drawImage(src, Math.floor((SIZE - nw) / 2), Math.floor((SIZE - nh) / 2), nw, nh);
    const px = d.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, t = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { const val = (px[i * 4] / 255 - MEAN) / STD; t[i] = t[n + i] = t[2 * n + i] = val; }
    return new ort.Tensor('float32', t, [1, 3, SIZE, SIZE]);
  }

  // Greedy decoding with the merged decoder's key/value cache. Returns { latex, looped }.
  async function recognize(gray, W, H, r){
    const pixel = prepare(gray, W, H, r); if (!pixel) return { latex: '', looped: false };
    const eh = (await enc.run({ [enc.inputNames[0]]: pixel }))[enc.outputNames[0]];
    let past = Object.fromEntries(pastNames.map(nm => [nm, empty()]));
    const ids = [0]; let looped = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      const first = step === 0;
      const inp = first ? ids : ids.slice(-1);
      const feed = { input_ids: new ort.Tensor('int64', BigInt64Array.from(inp.map(BigInt)), [1, inp.length]), encoder_hidden_states: eh, use_cache_branch: new ort.Tensor('bool', [!first], [1]), ...past };
      const out = await dec.run(feed);
      const logits = out[dec.outputNames[0]], V = logits.dims[2], base = (logits.dims[1] - 1) * V, L = logits.data;
      let best = 0, bv = -Infinity; for (let k = 0; k < V; k++) if (L[base + k] > bv) { bv = L[base + k]; best = k; }
      const next = {};
      for (const on of dec.outputNames.slice(1)) {
        const pn = on.replace('present', 'past_key_values');
        next[pn] = (!first && pn.includes('.encoder.')) ? past[pn] : out[on];
      }
      past = next; ids.push(best);
      if (best === 2) break;
      // stop runaway repetition ("B_{A} B_{A} B_{A} …")
      if (ids.length > 40) {
        for (let p = 1; p <= 8 && !looped; p++) {
          const a = ids.slice(-4 * p); let rep = true;
          for (let i = p; i < a.length; i++) if (a[i] !== a[i - p]) { rep = false; break; }
          if (rep) looped = true;
        }
        if (looped) break;
      }
    }
    const toks = ids.slice(1).filter(i => i > 3).map(i => id2tok[i] ?? '');
    return { latex: tidy(toks), looped };
  }
  return { recognize };
}

function tidy(toks){
  let s = '';
  for (const t of toks) { if (s && /\\[a-zA-Z]+$/.test(s) && /^[a-zA-Z0-9]/.test(t)) s += ' '; s += t; }
  // Print-like handwriting makes Texo add font styles and hard spaces; notes don't want them.
  for (let i = 0; i < 3; i++) s = s.replace(/\\(?:mathsf|textsf|mathrm|textrm|mathit|textit|mathnormal|mathtt|texttt|textbf|mathbf|boldsymbol|bm)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\(?:bf|rm|sf|it|tt)(?![a-zA-Z])\s*/g, '').replace(/~/g, ' ').replace(/\\[,;:! ]/g, ' ');
  // function names spelled out in letters → operators
  s = s.replace(/(?<![\\a-zA-Z])(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|log|ln|exp|lim|det|dim|ker|max|min|sup|inf|deg|gcd|arg)(?![a-zA-Z])/g, '\\$1')
       .replace(/(?<![\\a-zA-Z{])(im|rank|span|tr)(?![a-zA-Z])/g, '\\operatorname{$1}');
  // spacing: keep a space only where a command is followed by a letter
  s = s.replace(/\s+/g, ' ').replace(/(?<!\\[a-zA-Z]+) /g, '').replace(/(\\[a-zA-Z]+) (?![a-zA-Z])/g, '$1');
  return s.replace(/\\overrightarrow\{(\w)\}/g, '\\vec{$1}').trim();
}
