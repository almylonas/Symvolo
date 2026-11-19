# Symvolo

*σύμβολο — symbol.* A full-screen workspace for math notes. Bring in a photo of a notebook page or a school board, or draw a formula by hand, and Symvolo turns it into editable text and LaTeX blocks you can arrange freely on a cross-grid canvas. Save your layouts and export them as Markdown, as a PDF or as a LaTeX document.

## Features

- **Cross-grid workspace.** Full-screen canvas of small crosses. Pan, zoom to the cursor, fit to screen, and snap blocks to the crosses (toggle with `G`).
- **Photos → LaTeX.** Drop, choose or paste photos of handwritten or printed notes, handouts, whiteboards or chalkboards (up to 5 at once). Text and formula blocks appear while Claude reads them, laid out like the original. Anything hard to read is outlined in orange with a note saying what is uncertain. You can keep the photo next to the notes.
- **Handwriting → LaTeX.** Draw a symbol or an equation with a mouse, pen or finger (`P`). Symvolo recognises it, shows a live preview with editable LaTeX and up to three alternative readings, then adds it to the workspace. From the inspector you can also draw a replacement for a formula, or draw a formula into the middle of a sentence.
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

## How handwriting recognition works

Symvolo asks Claude to read images. It runs in one of two ways and detects which on its own:

| Where it runs | Who reads the images | Setup |
|---|---|---|
| Inside Claude (claude.ai artifact) | Claude on the viewer's own account. They are asked once for permission. | None |
| Your own deployment (Vercel) | The `api/recognize` function, with your Anthropic API key | Set `ANTHROPIC_API_KEY` |

If neither is available (for example a plain static host), everything else still works. Photos can still be placed on the workspace; only recognition is switched off.

The prompts live in **`prompts.js`**, shared by the browser and the server, so both paths read notes the same way.

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

`vercel.json` gives the recognition function up to 120 s (large board photos on the careful model can take a while), caches the bundled libraries for a year, and adds a few security headers.

## Run locally

```bash
cp .env.example .env.local   # add your key
npx vercel dev               # app + API on http://localhost:3000
```

Without a key, `npx serve .` (or any static server) runs the app with recognition switched off. Open it through a server, not as `file://`, because the app loads `prompts.js` as a module.

## Project structure

```
index.html          the whole app (UI, canvas, editor, exports)
prompts.js          prompts for photo import and handwriting, shared by browser and server
api/recognize.js    POST: images → Claude → streamed text (Vercel function)
api/health.js       GET: is recognition configured? is an access code required?
vendor/             KaTeX, MathLive, html2canvas, jsPDF and the KaTeX fonts (self-hosted)
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
| In the drawing pad: `Enter`, `Ctrl Z` | recognise, undo stroke |

## Privacy

Workspaces are kept in your browser (localStorage) and in the files you save. Images go to Claude only when you press **Convert** or **Recognize**, and only the images and the optional hint are sent. On your own deployment, they pass through your Vercel function to the Anthropic API under your key. Nothing is stored on the server.

## Third-party code

All bundled in `vendor/`, all MIT-licensed:
- [KaTeX](https://katex.org) 0.16.22: rendering, plus the Computer Modern–style fonts
- [MathLive](https://cortexjs.io/mathlive/) 0.111.1: direct formula editing
- [html2canvas](https://html2canvas.hertzen.com) 1.4.1 and [jsPDF](https://github.com/parallax/jsPDF) 2.5.2: PDF export
- Geist and Geist Mono (SIL OFL), loaded from Google Fonts
