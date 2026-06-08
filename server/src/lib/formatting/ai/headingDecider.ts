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
        maxOutputTokens: cfg.maxTokens,
        maxRetries: cfg.maxRetries,
      })

      // Guard: only trust decisions for indices we actually sent (the model can hallucinate i).
      const allowed = new Set(chunk.blocks.map(b => b.i))
      return object.decisions.filter(d => allowed.has(d.i))
    },
  }
}
