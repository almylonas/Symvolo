// GET /api/health — tells the app whether handwriting recognition is available on this deployment.
import { LIMITS } from '../prompts.js';

export function GET() {
  const ok = Boolean(process.env.ANTHROPIC_API_KEY);
  return new Response(JSON.stringify({
    ok,
    needsCode: Boolean(process.env.ACCESS_CODE),
    maxImages: LIMITS.import.maxImages,
    ...(ok ? {} : { reason: 'ANTHROPIC_API_KEY is not set' }),
  }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
