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
 * Weak models routinely ignore the `{ decisions: [...] }` wrapper and return the
 * bare array `[{ i, role }, ...]` (or wrap it under a different key, or fence it in
 * markdown). Re-shape any of those into the schema before validation fails the job.
 * Returns null when nothing salvageable is found (the SDK then errors as before).
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
    return null
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
