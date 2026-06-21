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
  /**
   * Default OpenRouter model slug (e.g. "deepseek/deepseek-chat-v3:free"). Used by
   * any step without its own override below. Each pass resolves its model through
   * the per-step fields, so a single doc can mix a strong model for heading
   * classification with a cheap/fast one for proofreading.
   */
  model: string
  /** Step D (heading reclassification) model — defaults to `model`. */
  headingModel: string
  /** Step C (reference reformatting) model — defaults to `model`. */
  referenceModel: string
  /** Step P (proofreading) model — defaults to `model`. */
  proofreadModel: string
  maxTokens: number
  /**
   * Output-token budget for the proofreading pass (Step P) only. Kept separate
   * from `maxTokens` (Step C/D) so we can shrink Step P's generation — shorter
   * responses finish faster and are far less likely to hit a mid-stream
   * connection reset on the free model — without starving the heading/reference
   * passes, which legitimately need the larger budget.
   */
  proofreadMaxTokens: number
  /** Compact-text budget per chunk; keep well under the model's context window. */
  maxCharsPerChunk: number
  /**
   * Max reference entries per Step C call. References are short, so the char budget
   * alone would batch all of them into one request — but reasoning models over-reason
   * a large batch and silently drop most entries. Small batches keep each call
   * tractable and the output count stable.
   */
  referencesMaxEntries: number
  /** Parallel chunk calls; respects rate limits. */
  concurrency: number
  maxRetries: number
  /** Sampling temperature. 0 = greedy/deterministic; the default for the classification passes. */
  temperature: number
  /** Fixed RNG seed for reproducible output where the provider honours it. */
  seed: number
  /**
   * Optional OpenRouter provider slug(s) to pin routing to (comma-separated, in
   * preference order). When set, fallbacks are disabled so every call hits the
   * same backend — same hardware/quantization → same output. Empty = let
   * OpenRouter route freely (cheapest, but a source of run-to-run variance).
   */
  provider: string[]
  /** Feature flag — ship the deterministic pipeline and turn C/D on separately. */
  enabled: boolean
  /** Feature flag for the proofreading AI pass (Step P), toggled independently of C/D. */
  proofreadingEnabled: boolean
  /**
   * Reasoning effort for the proofreading pass (Step P), passed to OpenRouter. Step Punct
   * already handles the mechanical spacing/punctuation deterministically, so the model only
   * does light grammar — a low effort keeps reasoning models (e.g. nemotron) from burning the
   * whole output budget on chain-of-thought and never emitting the JSON. One of
   * `none|minimal|low|medium|high|xhigh`.
   */
  proofreadReasoningEffort: ReasoningEffort
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
const REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const effort = (v: string | undefined, fallback: ReasoningEffort): ReasoningEffort =>
  REASONING_EFFORTS.includes(v as ReasoningEffort) ? (v as ReasoningEffort) : fallback

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const model = env.AI_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free'
  return {
    baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey: env.OPENROUTER_API_KEY ?? '',
    model,
    // Per-step overrides; each falls back to the default model when unset.
    headingModel: env.AI_HEADING_MODEL ?? model,
    referenceModel: env.AI_REFERENCES_MODEL ?? model,
    proofreadModel: env.AI_PROOFREAD_MODEL ?? model,
    maxTokens: num(env.AI_MAX_TOKENS, 8192),
    proofreadMaxTokens: num(env.AI_PROOFREAD_MAX_TOKENS, 4096),
    maxCharsPerChunk: num(env.AI_MAX_CHARS_PER_CHUNK, 3000),
    referencesMaxEntries: num(env.AI_REFERENCES_MAX_ENTRIES, 3),
    concurrency: num(env.AI_CONCURRENCY, 2),
    maxRetries: num(env.AI_MAX_RETRIES, 2),
    // Deterministic by default: greedy decode + a fixed seed. num() rejects 0, so read temperature directly.
    temperature: Number.isFinite(Number(env.AI_TEMPERATURE)) ? Number(env.AI_TEMPERATURE) : 0,
    seed: num(env.AI_SEED, 7),
    provider: (env.AI_PROVIDER ?? '').split(',').map(s => s.trim()).filter(Boolean),
    enabled: env.AI_FORMATTING_ENABLED === 'true',
    proofreadingEnabled: env.AI_PROOFREADING_ENABLED === 'true',
    proofreadReasoningEffort: effort(env.AI_PROOFREAD_REASONING_EFFORT, 'low'),
  }
}
