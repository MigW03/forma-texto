/**
 * Real `HeadingDecider` — calls a model through OpenRouter (OpenAI-compatible)
 * via the Vercel AI SDK. `generateObject` forces a zod-validated JSON shape, so
 * the model returns decisions, never XML or prose-wrapped JSON.
 *
 * This is the only file that knows about the SDK or the provider. The pass
 * (`stepD`) depends solely on the `HeadingDecider` interface, so swapping the
 * gateway or model is a config change here, nothing upstream.
 */
import { generateObject } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'
import { loadAiConfig, type AiConfig } from './config'
import { loadGuidelineDoc, guidelineSection } from '../loadGuideline'
import { buildHeadingSystemPrompt, buildHeadingUserPrompt } from './headingsPrompt'
import type { HeadingChunk, HeadingDecider, HeadingDecision } from '../stepD'

const decisionsSchema = z.object({
  decisions: z.array(
    z.object({
      i: z.number().int(),
      role: z.enum(['title', 'h1', 'h2', 'h3', 'body']),
    }),
  ),
})

/**
 * Pull every COMPLETE decision object out of a (possibly truncated) decisions array.
 * Reasoning models can hit the output-token ceiling and stop mid-JSON (finishReason
 * "length"), which makes a strict parse fail and lose the whole chunk — even the
 * entries that finished cleanly. This scans the array element-by-element (tracking
 * string/escape/brace state) and keeps each `{...}` that closes and parses, dropping
 * only the final partial one. Applying a partial set is safe: both passes act by
 * index, so a missing decision just leaves that block as the deterministic result.
 */
function salvageCompleteDecisions(text: string): unknown[] | null {
  const key = text.indexOf('"decisions"')
  const arrStart = text.indexOf('[', key < 0 ? 0 : key)
  if (arrStart < 0) return null
  const objs: unknown[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let k = arrStart + 1; k < text.length; k++) {
    const c = text[k]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') { if (depth === 0) start = k; depth++ }
    else if (c === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          const parsed = JSON.parse(text.slice(start, k + 1))
          if (parsed && typeof (parsed as { i?: unknown }).i === 'number') objs.push(parsed)
        } catch { /* skip a malformed element */ }
        start = -1
      }
    } else if (c === ']' && depth === 0) break
  }
  return objs.length ? objs : null
}

/**
 * Weak models routinely ignore the `{ decisions: [...] }` wrapper and return the
 * bare array `[{ i, role }, ...]` (or wrap it under a different key, or fence it in
 * markdown). Re-shape any of those into the schema before validation fails the job.
 * If the JSON is truncated (reasoning model hit the token ceiling), salvage the
 * complete decisions instead of losing the whole chunk. Returns null when nothing
 * salvageable is found (the SDK then errors as before).
 */
export async function repairDecisions({ text }: { text: string }): Promise<string | null> {
  const wrap = (v: unknown): string | null => {
    if (Array.isArray(v)) return JSON.stringify({ decisions: v })
    if (v && typeof v === 'object') {
      if ('decisions' in (v as Record<string, unknown>)) return JSON.stringify(v)
      const arr = Object.values(v as Record<string, unknown>).find(Array.isArray)
      if (arr) return JSON.stringify({ decisions: arr })
    }
    return null
  }
  try {
    return wrap(JSON.parse(text))
  } catch {
    // Salvage a JSON array embedded in prose or ```json fences.
    const m = text.match(/\[[\s\S]*\]/)
    if (m) {
      try {
        return wrap(JSON.parse(m[0]))
      } catch {
        /* fall through */
      }
    }
    // Last resort: the response was cut off mid-JSON — keep the complete decisions.
    const salvaged = salvageCompleteDecisions(text)
    return salvaged ? JSON.stringify({ decisions: salvaged }) : null
  }
}

export function createHeadingDecider(cfg: AiConfig = loadAiConfig()): HeadingDecider {
  if (!cfg.apiKey) throw new Error('OPENROUTER_API_KEY is not set — cannot create heading decider')
  const openrouter = createOpenRouter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })

  return {
    async classify(chunk: HeadingChunk): Promise<HeadingDecision[]> {
      const section4 = guidelineSection(loadGuidelineDoc(chunk.guideline), 4)
      const { object } = await generateObject({
        model: openrouter.chat(cfg.model),
        schema: decisionsSchema,
        system: buildHeadingSystemPrompt(section4, chunk.guideline),
        prompt: buildHeadingUserPrompt(chunk),
        // Determinism: greedy decode + fixed seed so the same doc yields the same headings.
        temperature: cfg.temperature,
        seed: cfg.seed,
        maxOutputTokens: cfg.maxTokens,
        maxRetries: cfg.maxRetries,
        experimental_repairText: repairDecisions,
        // Pin OpenRouter to a single backend when configured, so routing doesn't
        // swap hardware/quantization between runs (a source of run-to-run variance).
        ...(cfg.provider.length > 0 && {
          providerOptions: {
            openrouter: { provider: { order: cfg.provider, allow_fallbacks: false } },
          },
        }),
      })

      // Guard: only trust decisions for indices we actually sent (the model can hallucinate i).
      const allowed = new Set(chunk.blocks.map(b => b.i))
      return object.decisions.filter(d => allowed.has(d.i))
    },
  }
}
