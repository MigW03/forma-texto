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
