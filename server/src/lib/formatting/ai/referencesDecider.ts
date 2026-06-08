/**
 * Real `ReferenceDecider` — calls a model through OpenRouter (OpenAI-compatible)
 * via the Vercel AI SDK. `generateObject` forces a zod-validated JSON shape, so
 * the model returns `{ i, segments }` decisions, never XML or prose-wrapped JSON.
 *
 * This is the only Step C file that knows about the SDK or the provider. The pass
 * (`stepC`) depends solely on the `ReferenceDecider` interface, so swapping the
 * gateway or model is a config change here, nothing upstream. Mirrors
 * `headingDecider.ts`; it reuses that file's generic `repairDecisions` reshaper.
 */
import { generateObject } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'
import { loadAiConfig, type AiConfig } from './config'
import { loadGuidelineDoc, guidelineSection } from '../loadGuideline'
import { repairDecisions } from './headingDecider'
import { buildReferenceSystemPrompt, buildReferenceUserPrompt } from './referencesPrompt'
import type { ReferenceChunk, ReferenceDecider, ReferenceDecision } from '../stepC'

const decisionsSchema = z.object({
  decisions: z.array(
    z.object({
      i: z.number().int(),
      segments: z.array(
        z.object({
          text: z.string(),
          // Weak models sometimes send `null` for plain text; accept it (nullish) and
          // coerce to undefined below so it never fails validation or kills the chunk.
          emphasis: z.enum(['bold', 'italic']).nullish(),
        }),
      ),
    }),
  ),
})

export function createReferenceDecider(cfg: AiConfig = loadAiConfig()): ReferenceDecider {
  if (!cfg.apiKey) throw new Error('OPENROUTER_API_KEY is not set — cannot create reference decider')
  const openrouter = createOpenRouter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })

  return {
    async reformat(chunk: ReferenceChunk): Promise<ReferenceDecision[]> {
      const doc = loadGuidelineDoc(chunk.guideline)
      const { object } = await generateObject({
        model: openrouter.chat(cfg.model),
        schema: decisionsSchema,
        system: buildReferenceSystemPrompt(guidelineSection(doc, 6), guidelineSection(doc, 7), chunk.guideline),
        prompt: buildReferenceUserPrompt(chunk),
        // Determinism: greedy decode + fixed seed so the same doc yields the same entries.
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
      // Coerce nullish emphasis → undefined so the segment matches ReferenceSegment exactly.
      const allowed = new Set(chunk.entries.map(e => e.i))
      return object.decisions
        .filter(d => allowed.has(d.i))
        .map(d => ({
          i: d.i,
          segments: d.segments.map(s => ({ text: s.text, emphasis: s.emphasis ?? undefined })),
        }))
    },
  }
}
