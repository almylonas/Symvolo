# Symvolo

*σύμβολο — symbol.* **A versatile editor for mathematical notes, with LaTeX as its engine.** Write prose and formulas, draw Feynman diagrams, electrical circuits and quantum circuits, place every block freely on a cross-grid workspace, edit formulas visually or as LaTeX source, and export to Markdown, PDF or a compilable `.tex` document. Notes can also be brought in from photos of boards and pages, or drawn by hand. That recognition is in **beta**.

## Features

- **Welcome screen.** On opening, a translucent overlay over the live workspace, typeset in LaTeX style, shows the name, what Symvolo does and a **Start writing** button. Pressing it (or Enter) fades the overlay and the workspace is ready immediately. It can be shown again from the `?` menu.
- **Two ways to edit.** Formulas: edit them directly, like an equation editor (MathLive, with an on-screen math keyboard), or as LaTeX code. Text: type directly, with formulas inside it that you click to edit, or edit the Markdown + `$LaTeX$` source.
- **Diagrams, drawn graphically (`D`).** Three editors, no code needed; double-click a diagram on the workspace to edit it again.
  - **Feynman diagrams.** Pick a line (fermion, antifermion, photon, gluon, W boson, scalar, charged scalar, ghost, plain) and drag from point to point; lines join at shared points. Curve a line by dragging its handle, add labels and momentum arrows, and give vertices a dot, blob, crossed dot or ring.
  - **Electrical circuits.** Resistor, capacitor, inductor, voltage and current source, battery, diode, LED, switch, lamp, ammeter, voltmeter, wires (they turn right angles for you), ground, junctions and terminals. Drag between crosses or drop from the list. Connected parts stretch along when you move one, and junction dots appear by themselves. American or European symbols.
  - **Quantum circuits.** Drop gates (H, X, Y, Z, S, T, S†, T†, rotations, phase, custom and multi-qubit gates), controls, open controls, targets, swaps, measurements and barriers onto qubit wires. Controls connect to their column automatically; wires turn classical after a measurement.
  - Every diagram exports as real LaTeX — **TikZ-Feynman**, **CircuiTikZ** or **quantikz** — inside the `.tex` export, with the packages added to the preamble. The inspector and the editor's **LaTeX** button show the code to copy. In Markdown, diagrams become a `latex` code block. Each editor has examples to start from.
- **Cross-grid workspace.** Full-screen canvas of small crosses. Pan, zoom to the cursor, fit to screen, and snap blocks to the crosses (toggle with `G`).
- **Free layout.** Drag, resize, multi-select (marquee or `Shift`+click), line up left or top edges, space blocks evenly, layer order, lock, duplicate, nudge with the arrow keys. Each block has its own size, ink colour and background (none, card or highlight).
- **Workspaces.** Create, rename, duplicate, delete and switch between them. Choose a workspace colour from 7 presets or any custom colour; the interface turns dark on dark colours. Note lettering can be the LaTeX serif or a sans.
- **Save and export**
  - **Save workspace** (`.symvolo.json`): reopens with every position, size and colour. `Ctrl+S`.
  - **Markdown** (`.md`): text with `$…$` and `$$…$$`, in reading order.
  - **PDF, as on screen**: the workspace with its colours, cut into A4 pages.
  - **PDF, LaTeX document**: typeset as an article in Computer Modern, with a title, author, date, numbered sections and equations and a live page preview.
  - **LaTeX source** (`.tex`): the same document as compilable LaTeX (`article`, `amsmath`, plus `tikz-feynman`, `circuitikz` or `quantikz` when the workspace has diagrams). It compiles with `pdflatex` or in Overleaf. TikZ-Feynman prints a few harmless warnings under `pdflatex` because its automatic layout needs LuaLaTeX; Symvolo places every vertex itself, so it does not need it.
- **Photos → LaTeX (beta).** Drop, choose or paste photos of handwritten or printed notes, handouts, whiteboards or chalkboards (up to 5 at once). They become text and formula blocks laid out like the original. An **offline pipeline** reads them in the browser: it finds the lines, reads the text, tells formulas from prose and turns the formulas into LaTeX. Anything doubtful is outlined in orange. Select a block to see the part of the photo it came from, right above its editor, and switch a block between text and formula with one click if it was classified wrongly. You can keep the photo next to the notes.
- **Handwriting → LaTeX (beta), on your device.** Draw a symbol or an equation with a mouse, pen or finger (`P`). A small neural network (CoMER, 7 MB) reads it **in the browser, offline**, while you draw. No image leaves your machine. You get a live preview and editable LaTeX, then add it to the workspace. From the inspector you can also draw a replacement for a formula, or draw a formula into the middle of a sentence. Claude can be switched on as a more accurate engine (with up to three alternative readings).
- Undo/redo, autosave in the browser, paste an image anywhere to convert it, and a keyboard shortcut for nearly everything (`?` button in the app).

> **About the LaTeX PDF.** It is typeset in the browser with KaTeX and the Computer Modern fonts, so it looks like LaTeX output but is not produced by a TeX engine, and its text is an image. For a true pdflatex document, export the `.tex` file and compile it.

## How recognition works (beta)

### Drawn formulas: on-device by default

The drawing pad uses [ink-on](https://github.com/kimseungdae/ink-on), an INT8 ONNX export of the CoMER model (ECCV 2022), trained on the CROHME handwritten-math dataset. It runs in the browser through ONNX Runtime Web (WebAssembly).

- **Private and offline.** The model files ship in `vendor/` and are served by your own deployment. No external service is called. After the first load the browser caches them (IndexedDB), so it works without a connection.
- **Fast.** About 0.2–0.3 s per formula on a laptop. On Vercel the `COOP`/`COEP` headers in `vercel.json` enable multithreaded WebAssembly; elsewhere it runs single-threaded.
- **First use downloads about 20 MB**: the 12 MB WebAssembly runtime and the 7.5 MB model.
- **Accuracy is limited, so check the result.** On clean, deliberate writing it does well (9–10 of 10 simple formulas in our tests). On messy real handwriting it does much worse: ink-on reports 36% exactly right and 53% within one symbol on the CROHME 2014 test set. Every result is editable in the pad and later on the workspace.
- **Symbols it knows (about 110):** digits, Latin letters, `+ - = < > ( ) [ ] \{ \}`, `\frac \sqrt ^ _`, `\sum \int \lim \log \sin \cos \tan`, `\alpha \beta \gamma \theta \lambda \mu \pi \sigma \phi \Delta \Pi`, `\infty \pm \times \div \cdot \leq \geq \neq \rightarrow \in \forall \exists`, `\ldots \cdots \prime`. Symbols outside this set (for example `\partial`, `\nabla`, most capital Greek letters) can't be recognised on-device.

### Photos of notes and boards: on-device pipeline by default

`vendor/ocr/pagereader.js` reads a photo in six steps, all in the browser:

1. **Clean.** Find the board in the photo and ignore the room and people around it. Decide light-on-dark region by region (a chalkboard in a bright lecture hall), flip chalk to dark-on-light, divide out uneven lighting and glare, and boost faint or half-erased chalk with local contrast.
2. **Find lines.** PaddleOCR PP-OCRv5 text detection (DBNet). Lines glued together by tall brackets are split, divider strokes are dropped, word boxes on a line are joined, and columns stay apart. Columns are then read left to right.
3. **Read lines.** PP-OCRv6 small recognition (CTC), noticeably better on handwriting than v5, limited to Latin, Greek, digits and maths symbols. Each line is read from two views and the more confident reading wins. Recognition which gives characters with their positions and confidences. It handles umlauts and accents, so German or French notes work.
4. **Text or maths?** Rules on each token: real words (≥3 letters, or common short words in English, German, French and Spanish) versus symbols, operators, digits and function names. A line becomes text, a formula, or text with inline `$…$` maths. Stacked pieces (numerator / bar / denominator) are merged.
5. **Formulas → LaTeX.** Each formula region is read twice, from the cleaned image and from a lightly corrected one, and the reading the model is more confident about wins. The reader is **[Texo](https://github.com/alephpi/Texo)**, a 20M-parameter formula recogniser trained on printed and handwritten maths. It knows the full LaTeX vocabulary of lecture notes (`\vec`, `\hat`, `\hbar`, `\delta`, `\varepsilon`, `\equiv`, `\partial`, `\nabla`, `\dim`, `\ker`, arrays…). Font-style noise is removed and spelled-out function names become operators. The text reading acts as a check: if Texo's answer is much shorter than what was seen, the LaTeX is built from the text reading instead and the block is flagged. If Texo can't load, CoMER (the drawing-pad model) is used.
6. **Layout.** Headings (larger writing), paragraphs and multi-line derivations (aligned at `=`), with positions taken from the photo.

**How good is it?**
- **Neat, print-style writing:** most text and formulas come out right. Examples read exactly in our tests: $T(av+w)=aT(v)+T(w)$, $\dim V=\dim\ker T+\dim\operatorname{im}T$, $e^{x}=1+x+\frac{x^{2}}{2}$ and $xe^{x}=xe^{x}-e^{x}+C$, plus mixed lines like "Konvergenz für $|x|<R$".
- **Real lecture-hall photos:** layout, columns and positions are right, but individual symbols often aren't (a P read as T or 7). On one test photo of a physics board, the character error rate for formulas was about 45%. Handwritten text lines are the weakest part. Everything uncertain is outlined in orange, and the photo crop shown with each block makes fixing quick.
- **Speed and download:** 5–15 s per photo. The first use downloads about 105 MB (OCR 26 MB, Texo 61 MB, runtime 12 MB, CoMER 7.5 MB), cached afterwards.

**Claude for photos is switched off for now.** The code path is still there. Set `PHOTO_CLAUDE = true` in `index.html` to bring back the "Read with: On device | Claude" choice. Claude reads messy boards far better when enabled:

| Where Symvolo runs | Who reads with "Claude" | Setup |
|---|---|---|
| Inside Claude (claude.ai artifact) | Claude on the viewer's own account. They are asked once for permission. | None |
| Your own deployment (Vercel) | The `api/recognize` function, with your Anthropic API key | Set `ANTHROPIC_API_KEY` |
| Anywhere else | Not available. On-device reading still works. | — |

**Gear button (bottom left) → Recognition settings:** *Drawn formulas* can be **On device** (default) or **Claude**. Photos are always read on the device. With drawings on device too, Symvolo never contacts any external service. For a deployment that can never call Claude, simply don't set `ANTHROPIC_API_KEY`.

The Claude prompts live in **`prompts.js`**, shared by the browser and the server, so both paths read notes the same way.

## Deploy to Vercel

1. Push this folder to a GitHub repository, and set `SOURCE_URL` near the top of the script in `index.html` to its URL (the AGPL source-code link; see *License*).
2. In Vercel, **Add New → Project**, import the repository. Framework preset: **Other**. There is no build step and no output directory to set.
3. Under **Settings → Environment Variables**, add:

   | Variable | Required | What it does |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | yes | Your key from console.anthropic.com |
   | `ACCESS_CODE` | recommended | A shared password. When set, the app asks for it before calling Claude, so strangers who find the URL can't spend your credit. |
   | `ANTHROPIC_MODEL` | no | Model for "Standard" reading (default `claude-sonnet-5-5`) |
   | `ANTHROPIC_MODEL_CAREFUL` | no | Model for "Careful" reading (default `claude-opus-5-5`) |

4. Deploy. Check `https://<your-app>.vercel.app/api/health`: it should return `{"ok":true,…}`.

Or from the command line:

```bash
npm i -g vercel
vercel                      # first deploy, links the project
vercel env add ANTHROPIC_API_KEY
vercel env add ACCESS_CODE
vercel --prod
```

`vercel.json` gives the recognition function up to 120 s (large board photos on the careful model can take a while), caches the bundled libraries and models for a year, and sets `Cross-Origin-Opener-Policy: same-origin` with `Cross-Origin-Embedder-Policy: credentialless`. These two make the page cross-origin isolated, so the on-device recognizer can use several CPU threads. Safari ignores `credentialless` and simply runs single-threaded.

## Run locally

```bash
cp .env.example .env.local   # add your key
npx vercel dev               # app + API on http://localhost:3000
```

Without a key, `npx serve .` (or any static server) runs the whole app, including on-device handwriting and photo reading. Only the Claude options are unavailable. Open it through a server, not as `file://`, because the app loads ES modules and WebAssembly.

## Project structure

```
index.html          the whole app (UI, canvas, editor, exports)
js/diagrams.js      Feynman, circuit and quantum-circuit editors, SVG rendering and TikZ export
prompts.js          prompts for photo import and handwriting, shared by browser and server
api/recognize.js    POST: images → Claude → streamed text (Vercel function)
api/health.js       GET: is recognition configured? is an access code required?
vendor/             self-hosted libraries and fonts (see vendor/NOTICE.md)
  ort/              ONNX Runtime Web, WebAssembly build
  inkon/            ink-on recognition engine (two small patches, listed in NOTICE.md)
  models/comer/     CoMER encoder/decoder (INT8 ONNX) + vocabulary
  models/ppocr/     PP-OCRv5 mobile text detection, PP-OCRv6 small recognition (2 parts) + dictionary
  models/texo/      Texo formula recogniser (INT8 ONNX, encoder in 4 parts) + tokenizer
  ocr/pagereader.5.js  offline photo → blocks pipeline
  ocr/texo.2.js        Texo preprocessing + decoding
                       (version numbers in the file names, so browsers never run a cached older copy)
vercel.json         function limits and headers
.env.example        environment variables
```

### API

`POST /api/recognize`, JSON body:

```json
{ "task": "import" | "handwriting",
  "images": [{ "media_type": "image/jpeg", "data": "<base64>" }],
  "hint": "optional, import only",
  "tier": "default" | "complex" }
```

Send the `x-access-code` header if `ACCESS_CODE` is set. The response streams plain text:
- **import:** one JSON block per line, `{"kind":"text"|"math","content":…,"x","y","w","img","unsure"?,"note"?}`
- **handwriting:** `{"latex": "...", "alternatives": [...]}`

Errors come back as JSON `{ "error": code }`: `not_configured`, `bad_code`, `bad_request`, `image_rejected`, `rate_limited`, `too_large` or `upstream_error`.

The browser shrinks images to at most 1568 px on the long edge before sending them, which keeps requests under Vercel's 4.5 MB body limit.

## File format

`.symvolo.json`:

```json
{
  "format": "symvolo-workspace",
  "version": 1,
  "saved": "2026-11-19T22:00:00.000Z",
  "workspace": {
    "id": "…", "name": "Fourier series", "bg": "#f6f6f3", "font": "serif",
    "view": { "x": 0, "y": 0, "z": 1 },
    "blocks": [
      { "id": "…", "kind": "math", "x": 180, "y": 276, "content": "f(x)=…",
        "size": 1, "ink": null, "fill": "none", "z": 3, "locked": false },
      { "id": "…", "kind": "text", "x": 156, "y": 180, "w": 480, "content": "A $2\\pi$-periodic …",
        "align": "left", "size": 1, "ink": "#4a6cf7", "fill": "card", "z": 2 },
      { "id": "…", "kind": "image", "x": 0, "y": 0, "w": 420, "src": "data:image/jpeg;base64,…", "op": 1, "z": 0 },
      { "id": "…", "kind": "diagram", "x": 600, "y": 120, "size": 1.25,
        "dia": { "type": "feynman",
                 "v": [{ "id": "a", "x": 0, "y": 0, "style": "none", "label": "e^-", "lpos": "auto" }, …],
                 "e": [{ "id": "…", "a": "a", "b": "c", "t": "fermion", "bend": 0, "label": "", "side": 1, "mom": "" }, …] } }
    ]
  }
}
```

Diagram coordinates are in grid units (one cross = one unit). Circuits store `el` (two-terminal parts with ends `a`, `b`) and `pt` (ground, junction, terminal); quantum circuits store `n` qubits, `inL`/`outL` labels, gates `g` with row `r` and column `c`, and barrier columns `bar`.

Files saved by the earlier prototype (`.crux.json`) open too.

## Keyboard

| Key | Action |
|---|---|
| Double-click | new text block / edit a block |
| `T` / `M` | text / formula tool |
| `P` | handwrite a formula |
| `D` | draw a diagram (Feynman, circuit, quantum) |
| In a diagram editor | `V` select, `E`/`X` eraser, number or letter keys pick a part (shown in the list), `Delete` removes, `Ctrl Z` undo, `Ctrl Enter` save, right-click erases |
| `I` | import photos |
| `Space`+drag, two-finger scroll | pan |
| `Ctrl`+wheel, pinch | zoom |
| `Shift`+click, drag on empty space | multi-select |
| Arrow keys (`Shift` = bigger steps) | nudge |
| `Ctrl D` / `Delete` | duplicate / delete |
| `Ctrl Z` / `Ctrl Shift Z` | undo / redo |
| `Ctrl S` | save workspace file |
| `G` | snap to crosses on/off |
| `1` / `0` | fit to screen / 100 % |
| In the drawing pad: `Enter`, `Ctrl Z` | recognise now / add, undo stroke |

## Privacy

Workspaces are kept in your browser (localStorage) and in the files you save. Drawn formulas and photos are read on your device by default and never leave it. Images go to Claude only if you choose Claude (in the import dialog, the drawing pad or the gear menu) and press **Convert** or **Recognize**. Only the images and the optional hint are sent. On your own deployment, they pass through your Vercel function to the Anthropic API under your key. Nothing is stored on the server.

## Third-party code

All bundled in `vendor/`. Details and patch notes are in [`vendor/NOTICE.md`](vendor/NOTICE.md).
- [KaTeX](https://katex.org) 0.16.22 (MIT): rendering, plus the Computer Modern–style fonts
- [MathLive](https://cortexjs.io/mathlive/) 0.111.1 (MIT): direct formula editing
- [html2canvas](https://html2canvas.hertzen.com) 1.4.1 and [jsPDF](https://github.com/parallax/jsPDF) 2.5.2 (MIT): PDF export
- [ONNX Runtime Web](https://onnxruntime.ai) 1.24.3 (MIT): runs the recognition model
- [ink-on](https://github.com/kimseungdae/ink-on) 0.1.0 and its CoMER model (Apache-2.0): on-device handwriting recognition
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv5 mobile models (Apache-2.0): on-device text detection and recognition
- [Texo](https://github.com/alephpi/Texo) by Sicheng Mao (AGPL-3.0): on-device formula recognition for photos
- Geist and Geist Mono (SIL OFL), loaded from Google Fonts

## License

Symvolo is free software under the **GNU Affero General Public License v3.0** ([`LICENSE`](LICENSE)). It has to be, because it includes the AGPL-3.0 Texo model.

What that means in practice:
- You may use, modify and deploy Symvolo freely.
- If you run a modified version for other people (for example on Vercel), you must offer them its source code under the same licence. The app has a **Source code** link in its help menu (`?` button). Set `SOURCE_URL` at the top of the script in `index.html` to your repository.
- The bundled libraries and models keep their own licences (MIT / Apache-2.0); see [`vendor/NOTICE.md`](vendor/NOTICE.md).
