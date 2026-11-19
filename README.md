# Symvolo

*σύμβολο — symbol.* A full-screen workspace for math notes. Bring in a photo of a notebook page or a school board, or draw a formula by hand, and Symvolo turns it into editable text and LaTeX blocks you can arrange freely on a cross-grid canvas. Save your layouts and export them as Markdown, as a PDF or as a LaTeX document.

## Features

- **Cross-grid workspace.** Full-screen canvas of small crosses. Pan, zoom to the cursor, fit to screen, and snap blocks to the crosses (toggle with `G`).
- **Photos → LaTeX.** Drop, choose or paste photos of handwritten or printed notes, handouts, whiteboards or chalkboards (up to 5 at once). Text and formula blocks appear while Claude reads them, laid out like the original. Anything hard to read is outlined in orange with a note saying what is uncertain. You can keep the photo next to the notes.
- **Handwriting → LaTeX, on your device.** Draw a symbol or an equation with a mouse, pen or finger (`P`). A small neural network (CoMER, 7 MB) reads it **in the browser, offline**, while you draw. No image leaves your machine. You get a live preview and editable LaTeX, then add it to the workspace. From the inspector you can also draw a replacement for a formula, or draw a formula into the middle of a sentence. Claude can be switched on as a more accurate engine (with up to three alternative readings).
- **Two ways to edit.** Formulas: edit them directly, like an equation editor (MathLive, with an on-screen math keyboard), or as LaTeX code. Text: type directly, with formulas inside it that you click to edit, or edit the Markdown + `$LaTeX$` source.
- **Free layout.** Drag, resize, multi-select (marquee or `Shift`+click), line up left or top edges, space blocks evenly, layer order, lock, duplicate, nudge with the arrow keys. Each block has its own size, ink colour and background (none, card or highlight).
- **Workspaces.** Create, rename, duplicate, delete and switch between them. Choose a workspace colour from 7 presets or any custom colour; the interface turns dark on dark colours. Note lettering can be the LaTeX serif or a sans.
- **Save and export**
  - **Save workspace** (`.symvolo.json`): reopens with every position, size and colour. `Ctrl+S`.
  - **Markdown** (`.md`): text with `$…$` and `$$…$$`, in reading order.
  - **PDF, as on screen**: the workspace with its colours, cut into A4 pages.
  - **PDF, LaTeX document**: typeset as an article in Computer Modern, with a title, author, date, numbered sections and equations and a live page preview.
  - **LaTeX source** (`.tex`): the same document as compilable LaTeX (`article`, `amsmath`). It compiles with `pdflatex` or in Overleaf.
- Undo/redo, autosave in the browser, paste an image anywhere to convert it, and a keyboard shortcut for nearly everything (`?` button in the app).

> **About the LaTeX PDF.** It is typeset in the browser with KaTeX and the Computer Modern fonts, so it looks like LaTeX output but is not produced by a TeX engine, and its text is an image. For a true pdflatex document, export the `.tex` file and compile it.

## How recognition works

### Drawn formulas: on-device by default

The drawing pad uses [ink-on](https://github.com/kimseungdae/ink-on), an INT8 ONNX export of the CoMER model (ECCV 2022), trained on the CROHME handwritten-math dataset. It runs in the browser through ONNX Runtime Web (WebAssembly).

- **Private and offline.** The model files ship in `vendor/` and are served by your own deployment. No external service is called. After the first load the browser caches them (IndexedDB), so it works without a connection.
- **Fast.** About 0.2–0.3 s per formula on a laptop. On Vercel the `COOP`/`COEP` headers in `vercel.json` enable multithreaded WebAssembly; elsewhere it runs single-threaded.
- **First use downloads about 20 MB**: the 12 MB WebAssembly runtime and the 7.5 MB model.
- **Accuracy is limited, so check the result.** On clean, deliberate writing it does well (9–10 of 10 simple formulas in our tests). On messy real handwriting it does much worse: ink-on reports 36% exactly right and 53% within one symbol on the CROHME 2014 test set. Every result is editable in the pad and later on the workspace.
- **Symbols it knows (about 110):** digits, Latin letters, `+ - = < > ( ) [ ] \{ \}`, `\frac \sqrt ^ _`, `\sum \int \lim \log \sin \cos \tan`, `\alpha \beta \gamma \theta \lambda \mu \pi \sigma \phi \Delta \Pi`, `\infty \pm \times \div \cdot \leq \geq \neq \rightarrow \in \forall \exists`, `\ldots \cdots \prime`. Symbols outside this set (for example `\partial`, `\nabla`, most capital Greek letters) can't be recognised on-device.

### Photos of notes and boards: Claude (optional)

A whole page mixes prose, formulas and layout, which needs a large vision model. Photo conversion therefore uses Claude, if it's available and allowed:

| Where Symvolo runs | Who reads the photos | Setup |
|---|---|---|
| Inside Claude (claude.ai artifact) | Claude on the viewer's own account. They are asked once for permission. | None |
| Your own deployment (Vercel) | The `api/recognize` function, with your Anthropic API key | Set `ANTHROPIC_API_KEY` |
| Anywhere else, or switched off | Nobody. Photos are placed on the workspace as they are. | — |

**Gear button (bottom left) → Recognition settings:**
- *Drawn formulas:* **On device** (default) or **Claude**.
- *Photos:* **Send photos to Claude to convert them**, on or off.

With photos off and the pad on-device, Symvolo never contacts any external service. For a deployment that can never call Claude, simply don't set `ANTHROPIC_API_KEY`.

The Claude prompts live in **`prompts.js`**, shared by the browser and the server, so both paths read notes the same way.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
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

Without a key, `npx serve .` (or any static server) runs the whole app. On-device handwriting works; only photo conversion is off. Open it through a server, not as `file://`, because the app loads ES modules and WebAssembly.

## Project structure

```
index.html          the whole app (UI, canvas, editor, exports)
prompts.js          prompts for photo import and handwriting, shared by browser and server
api/recognize.js    POST: images → Claude → streamed text (Vercel function)
api/health.js       GET: is recognition configured? is an access code required?
vendor/             self-hosted libraries and fonts (see vendor/NOTICE.md)
  ort/              ONNX Runtime Web, WebAssembly build
  inkon/            ink-on recognition engine (two small patches, listed in NOTICE.md)
  models/comer/     CoMER encoder/decoder (INT8 ONNX) + vocabulary
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
      { "id": "…", "kind": "image", "x": 0, "y": 0, "w": 420, "src": "data:image/jpeg;base64,…", "op": 1, "z": 0 }
    ]
  }
}
```

Files saved by the earlier prototype (`.crux.json`) open too.

## Keyboard

| Key | Action |
|---|---|
| Double-click | new text block / edit a block |
| `T` / `M` | text / formula tool |
| `P` | handwrite a formula |
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

Workspaces are kept in your browser (localStorage) and in the files you save. Drawn formulas are recognised on your device by default and never leave it. Images go to Claude only if you switch that on (photo conversion, or Claude as the drawing engine) and press **Convert** or **Recognize**. Only the images and the optional hint are sent. On your own deployment, they pass through your Vercel function to the Anthropic API under your key. Nothing is stored on the server.

## Third-party code

All bundled in `vendor/`. Details and patch notes are in [`vendor/NOTICE.md`](vendor/NOTICE.md).
- [KaTeX](https://katex.org) 0.16.22 (MIT): rendering, plus the Computer Modern–style fonts
- [MathLive](https://cortexjs.io/mathlive/) 0.111.1 (MIT): direct formula editing
- [html2canvas](https://html2canvas.hertzen.com) 1.4.1 and [jsPDF](https://github.com/parallax/jsPDF) 2.5.2 (MIT): PDF export
- [ONNX Runtime Web](https://onnxruntime.ai) 1.24.3 (MIT): runs the recognition model
- [ink-on](https://github.com/kimseungdae/ink-on) 0.1.0 and its CoMER model (Apache-2.0): on-device handwriting recognition
- Geist and Geist Mono (SIL OFL), loaded from Google Fonts
