// POST /api/recognize — reads handwriting with Claude and streams the answer back as plain text.
// Body: { task: "import" | "handwriting", images: [{ media_type, data(base64) }], hint?, tier?: "default" | "complex" }
// The prompts live in ../prompts.js so the browser (inside Claude) and this server read notes the same way.

import { importPrompt, handwritingPrompt, LIMITS } from '../prompts.js';

const API = 'https://api.anthropic.com/v1/messages';
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_B64 = 5_000_000; // per image, after the browser has downscaled it

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function model(tier) {
  if (tier === 'complex') return process.env.ANTHROPIC_MODEL_CAREFUL || 'claude-opus-5-5';
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
}

export async function POST(request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);

  const code = process.env.ACCESS_CODE;
  if (code && request.headers.get('x-access-code') !== code) return json({ error: 'bad_code' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const task = body?.task;
  if (!LIMITS[task]) return json({ error: 'bad_request' }, 400);
  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length || images.length > LIMITS[task].maxImages) return json({ error: 'bad_request' }, 400);
  for (const im of images) {
    if (!im || !TYPES.has(im.media_type) || typeof im.data !== 'string' || im.data.length > MAX_B64) return json({ error: 'image_rejected' }, 400);
  }

  const prompt = task === 'import'
    ? importPrompt({ n: images.length, hint: String(body.hint || '').slice(0, 300) })
    : handwritingPrompt();

  let upstream;
  try {
    upstream = await fetch(API, {
      method: 'POST',
      signal: request.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model(body.tier),
        max_tokens: LIMITS[task].maxTokens,
        stream: true,
        messages: [{
          role: 'user',
          content: [
            ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }

  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 400);
    console.error('Anthropic API error', upstream.status, detail);
    const error = upstream.status === 429 || upstream.status === 529 ? 'rate_limited' : upstream.status === 413 ? 'too_large' : 'upstream_error';
    return json({ error }, upstream.status === 429 ? 429 : 502);
  }

  // Turn Anthropic's server-sent events into a plain stream of text deltas.
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            let ev;
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') ctrl.enqueue(enc.encode(ev.delta.text));
            else if (ev.type === 'error') throw new Error(ev.error?.message || 'stream error');
          }
        }
        ctrl.close();
      } catch (e) {
        console.error('Stream error', e?.message);
        ctrl.error(e);
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}

export function GET() {
  return json({ error: 'method_not_allowed' }, 405);
}
