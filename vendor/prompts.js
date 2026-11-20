// Prompts shared by the browser (inside Claude) and the Vercel function (api/recognize.js).
// Keeping them in one file means both paths read handwriting the same way.

export function importPrompt({ n = 1, hint = '' } = {}) {
  const note = String(hint || '').trim().slice(0, 300);
  return `You are transcribing ${n > 1 ? n + ' photos' : 'a photo'} of handwritten or printed math notes (a notebook page, handout, whiteboard or chalkboard) into editable blocks for a math notes app.
${note ? 'The user says about the notes: "' + note + '"\n' : ''}
Rules:
- Transcribe everything that belongs to the notes, faithfully. Do not translate, summarise, correct, complete or solve anything. Keep the original language.
- Ignore the background, people, glare, smudges, erased remnants, page edges and anything that is not part of the notes. Boards may be photographed at an angle: read through the perspective.
- Split the content into blocks the way it is laid out: a heading, a line or paragraph of text, a standalone formula, a multi-line derivation, a list, a boxed result, a side remark.
- kind "math": a standalone formula or derivation. content is LaTeX only, without $ delimiters. Multi-line derivations use \\begin{aligned} ... \\end{aligned} with & before the relation sign and \\\\ between lines. Words inside formulas go in \\text{}. A boxed result uses \\boxed{}.
- kind "text": headings, prose, lists, labels. content is Markdown with inline math as $...$. Headings start with "# " or "## ". List items start with "- ". Underlined or emphasised words may use **bold**.
- A sketch, plot or diagram: kind "text" with content like "*[Sketch: parabola with roots at -1 and 2]*".
- x, y: the top-left corner of the block as a fraction (0 to 1) of the image width and height. w: the block's width as a fraction of the image width.
- img: the 0-based index of the photo the block comes from${n > 1 ? '' : ' (always 0)'}.
- unsure: true if any part of the block was hard to read; then add "note" with a few words on what is uncertain. Otherwise omit both.
- Escape backslashes correctly for JSON (a LaTeX \\frac is written "\\\\frac" inside the JSON string).

Output format: one JSON object per line, in reading order, and nothing else — no code fence, no commentary. Example lines:
{"kind":"text","content":"# Taylor series","x":0.06,"y":0.04,"w":0.5,"img":0}
{"kind":"math","content":"f(x)=\\\\sum_{n=0}^{\\\\infty}\\\\frac{f^{(n)}(a)}{n!}(x-a)^n","x":0.1,"y":0.15,"w":0.7,"img":0}
{"kind":"text","content":"converges for $|x-a|<R$","x":0.12,"y":0.3,"w":0.4,"img":0,"unsure":true,"note":"last symbol could be ≤"}`;
}

export function handwritingPrompt() {
  return `The image shows a mathematical symbol, expression or equation that someone drew by hand with a mouse, pen or finger (dark strokes on a white background). Transcribe it into LaTeX.

Rules:
- Transcribe exactly what is drawn. Do not complete, simplify, correct or solve it.
- A single symbol is fine (for example \\nabla, \\aleph_0, \\oint, \\mathbb{R}).
- Several lines: use \\begin{aligned} ... \\end{aligned} with \\\\ between lines and & before the relation signs that line up.
- If a stroke is ambiguous (x or \\times, 1 or l, z or 2, a or \\alpha, u or \\mu), pick the most likely reading in context and list other plausible complete readings as alternatives.
- No $ delimiters.

Reply with only one JSON object and nothing else, no code fence:
{"latex": "...", "alternatives": ["...", "..."]}
alternatives may be empty and has at most 3 entries. Escape backslashes for JSON (\\frac is written "\\\\frac").
If nothing readable is drawn, reply {"latex": "", "alternatives": []}.`;
}

export const LIMITS = { import: { maxImages: 5, maxTokens: 8000 }, handwriting: { maxImages: 1, maxTokens: 800 } };
