/**
 * AI gateway config for the formatting AI passes (Step C/D).
 *
 * Gateway: OpenRouter, accessed via the OpenAI-compatible protocol. Every knob is
 * env-overridable so a model swap is a config change, not a code change. The two
 * values that change if the gateway/host ever changes are `baseUrl` + `apiKey`;
 * nothing in the passes does.
 */
export interface AiConfig {
  baseUrl: string
  apiKey: string
  /** OpenRouter model slug (e.g. "deepseek/deepseek-chat-v3:free"). */
  model: string
  maxTokens: number
  /** Compact-text budget per chunk; keep well under the model's context window. */
  maxCharsPerChunk: number
  /** Parallel chunk calls; respects rate limits. */
  concurrency: number
  maxRetries: number
  /** Feature flag — ship the deterministic pipeline and turn C/D on separately. */
  enabled: boolean
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey: env.OPENROUTER_API_KEY ?? '',
    // Free text model for initial tests; swap the slug when promoting to a paid model.
    model: env.AI_MODEL ?? 'openai/gpt-oss-120b:free',
    maxTokens: num(env.AI_MAX_TOKENS, 2048),
    maxCharsPerChunk: num(env.AI_MAX_CHARS_PER_CHUNK, 8000),
    concurrency: num(env.AI_CONCURRENCY, 2),
    maxRetries: num(env.AI_MAX_RETRIES, 2),
    enabled: env.AI_FORMATTING_ENABLED === 'true',
  }
}
