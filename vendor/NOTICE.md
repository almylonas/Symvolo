# Third-party components in `vendor/`

| Folder / file | Project | Version | License |
|---|---|---|---|
| `katex.min.js`, `katex.min.css`, `fonts/` | [KaTeX](https://github.com/KaTeX/KaTeX) | 0.16.22 | MIT |
| `mathlive.min.js` | [MathLive](https://github.com/arnog/mathlive) | 0.111.1 | MIT |
| `html2canvas.min.js` | [html2canvas](https://github.com/niklasvh/html2canvas) | 1.4.1 | MIT |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 | MIT |
| `ort/` | [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (WASM build) | 1.24.3 | MIT |
| `inkon/` | [ink-on](https://github.com/kimseungdae/ink-on): handwritten math recognition | 0.1.0 | Apache-2.0 (see `inkon/LICENSE`) |
| `models/comer/` | INT8 ONNX export of [CoMER](https://github.com/Green-Wood/CoMER) (ECCV 2022), from the ink-on repository | — | Apache-2.0, as distributed by ink-on |
| `models/ppocr/` | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv5 mobile text detection (`det_v5.ort`) and multilingual recognition (`rec_v5.onnx`, `dict_v5.txt`), from the npm package `pdfmarkdown-ppocrv5-models` 1.0.0 | v5 | Apache-2.0 (see `models/ppocr/LICENSE`) |
| `ocr/pagereader.js` | Symvolo's own offline page reader (cleaning, line detection, text/formula separation, layout) | — | MIT |

## Changes made to ink-on

`inkon/chunks/inference-4T2UM6yg.js` carries two small patches, each marked `// Symvolo patch`:

1. `fetchWithCache` throws when a model download fails (non-2xx response), instead of caching the error page in IndexedDB.
2. `ort.env.wasm.numThreads` is set to 1 unless the page is cross-origin isolated, where browsers allow WebAssembly threads (at most 4).

Source maps were removed from the vendored files.
