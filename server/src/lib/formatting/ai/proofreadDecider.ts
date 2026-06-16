/**
 * Real `ProofreadDecider` — calls a model through OpenRouter (OpenAI-compatible)
 * via the Vercel AI SDK. `generateObject` forces a zod-validated JSON shape, so the
 * model returns `{ i, text }` corrections, never XML or prose-wrapped JSON.
 *
 * This is the only Step P file that knows about the SDK or the provider. The pass
 * (`stepProofread`) depends solely on the `ProofreadDecider` interface, so swapping
 * the gateway or model is a config change here, nothing upstream. Mirrors
 * `referencesDecider.ts`; it reuses `headingDecider.ts`'s generic `repairDecisions`.
 */
import { generateObject } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'
import { loadAiConfig, type AiConfig } from './config'
import { loadGuidelineDoc, guidelineSection } from '../loadGuideline'
import { repairDecisions } from './headingDecider'
import { withConnectionRetry } from './retry'
import { buildProofreadSystemPrompt, buildProofreadUserPrompt } from './proofreadPrompt'
import type { ProofreadChunk, ProofreadDecider, ProofreadDecision } from '../stepProofread'

const decisionsSchema = z.object({
  decisions: z.array(
    z.object({
      i: z.number().int(),
      text: z.string(),
    }),
  ),
})

export function createProofreadDecider(cfg: AiConfig = loadAiConfig()): ProofreadDecider {
  if (!cfg.apiKey) throw new Error('OPENROUTER_API_KEY is not set — cannot create proofread decider')
  const openrouter = createOpenRouter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })

  return {
    async proofread(chunk: ProofreadChunk): Promise<ProofreadDecision[]> {
      // §5 carries the guideline's in-text citation rules (author-date casing, et al.).
      const section5 = guidelineSection(loadGuidelineDoc(chunk.guideline), 5)
      // Retry the SDK's non-retryable connection resets (free models drop the
      // socket mid-response); HTTP-status retries stay the SDK's job.
      const { object } = await withConnectionRetry(
        () => generateObject({
          model: openrouter.chat(cfg.model),
          schema: decisionsSchema,
          system: buildProofreadSystemPrompt(section5, chunk.guideline),
          prompt: buildProofreadUserPrompt(chunk),
          // Determinism: greedy decode + fixed seed so the same doc yields the same edits.
          temperature: cfg.temperature,
          seed: cfg.seed,
          // Step P's own (smaller) budget — shorter gen, fewer mid-stream resets.
          maxOutputTokens: cfg.proofreadMaxTokens,
          maxRetries: cfg.maxRetries,
          experimental_repairText: repairDecisions,
          // Pin OpenRouter to a single backend when configured, so routing doesn't
          // swap hardware/quantization between runs (a source of run-to-run variance).
          ...(cfg.provider.length > 0 && {
            providerOptions: {
              openrouter: { provider: { order: cfg.provider, allow_fallbacks: false } },
            },
          }),
        }),
        { retries: cfg.maxRetries },
      )

      // Guard: only trust decisions for indices we actually sent (the model can hallucinate i).
      const allowed = new Set(chunk.blocks.map(b => b.i))
      return object.decisions.filter(d => allowed.has(d.i))
    },
  }
}
