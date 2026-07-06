import { describe, it, expect } from 'vitest'
import { loadAiConfig } from './config'

const base = { AI_MODEL: 'default/model' } as NodeJS.ProcessEnv

describe('loadAiConfig per-step models', () => {
  it('falls every step back to AI_MODEL when no override is set', () => {
    const cfg = loadAiConfig(base)
    expect(cfg.model).toBe('default/model')
    expect(cfg.headingModel).toBe('default/model')
    expect(cfg.referenceModel).toBe('default/model')
    expect(cfg.proofreadModel).toBe('default/model')
  })

  it('lets each step override independently', () => {
    const cfg = loadAiConfig({
      ...base,
      AI_HEADING_MODEL: 'strong/heading',
      AI_PROOFREAD_MODEL: 'fast/proofread',
    } as NodeJS.ProcessEnv)
    expect(cfg.headingModel).toBe('strong/heading')
    expect(cfg.proofreadModel).toBe('fast/proofread')
    // unspecified step still inherits the default
    expect(cfg.referenceModel).toBe('default/model')
  })
})

describe('loadAiConfig reasoning effort', () => {
  it('defaults every structured pass to low', () => {
    const cfg = loadAiConfig(base)
    expect(cfg.headingReasoningEffort).toBe('low')
    expect(cfg.referenceReasoningEffort).toBe('low')
    expect(cfg.proofreadReasoningEffort).toBe('low')
  })

  it('reads a per-pass override and ignores an invalid value', () => {
    const cfg = loadAiConfig({
      ...base,
      AI_HEADING_REASONING_EFFORT: 'minimal',
      AI_REFERENCES_REASONING_EFFORT: 'bogus', // invalid → falls back to default
    } as NodeJS.ProcessEnv)
    expect(cfg.headingReasoningEffort).toBe('minimal')
    expect(cfg.referenceReasoningEffort).toBe('low')
  })

  it('raises the default output budgets for reasoning headroom', () => {
    const cfg = loadAiConfig(base)
    expect(cfg.maxTokens).toBe(16384)
    expect(cfg.proofreadMaxTokens).toBe(8192)
  })

  it('caps paragraphs per chunk (default 12, env-overridable)', () => {
    expect(loadAiConfig(base).maxBlocksPerChunk).toBe(12)
    expect(loadAiConfig({ ...base, AI_MAX_BLOCKS_PER_CHUNK: '6' } as NodeJS.ProcessEnv).maxBlocksPerChunk).toBe(6)
  })
})
