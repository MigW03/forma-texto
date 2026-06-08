import { describe, it, expect } from 'vitest'
import { calcPrice, calcPriceWithTrial, trialDiscountBRL, formatBRL } from './pricing'

describe('calcPrice', () => {
  it('charges per page above the minimum', () => {
    expect(calcPrice('formatting', 10)).toBe(10) // 10 × R$1
    expect(calcPrice('proofreading', 20)).toBe(40) // 20 × R$2
  })

  it('applies the per-service minimum below it', () => {
    expect(calcPrice('formatting', 3)).toBe(5) // 3 × R$1 → floored to R$5
    expect(calcPrice('proofreading', 5)).toBe(15) // 5 × R$2 = R$10 → floored to R$15
  })

  it('treats the break-even page count as the per-page price', () => {
    expect(calcPrice('formatting', 5)).toBe(5) // exactly at the minimum
    expect(calcPrice('proofreading', 8)).toBe(16) // first page count above the R$15 floor
  })
})

describe('calcPriceWithTrial', () => {
  it('subtracts one free page from the post-minimum total', () => {
    expect(calcPriceWithTrial('formatting', 10)).toBe(9) // 10 − 1
    expect(calcPriceWithTrial('proofreading', 20)).toBe(38) // 40 − 2
  })

  it('discounts off the minimum when the page count is small', () => {
    expect(calcPriceWithTrial('formatting', 1)).toBe(4) // min 5 − 1
    expect(calcPriceWithTrial('proofreading', 1)).toBe(13) // min 15 − 2
  })

  it('never goes below zero', () => {
    expect(calcPriceWithTrial('formatting', 0)).toBeGreaterThanOrEqual(0)
  })
})

describe('trialDiscountBRL', () => {
  it('sums one free page per selected service', () => {
    expect(trialDiscountBRL(['formatting'])).toBe(1)
    expect(trialDiscountBRL(['proofreading'])).toBe(2)
    expect(trialDiscountBRL(['formatting', 'proofreading'])).toBe(3)
  })

  it('is zero with no services', () => {
    expect(trialDiscountBRL([])).toBe(0)
  })
})

describe('formatBRL', () => {
  it('formats as Brazilian Real with two decimals', () => {
    const s = formatBRL(1)
    expect(s).toMatch(/^R\$/)
    expect(s).toContain('1,00')
  })

  it('uses a dot as the thousands separator', () => {
    expect(formatBRL(1234.5)).toContain('1.234,50')
  })

  it('always shows cents', () => {
    expect(formatBRL(40)).toContain('40,00')
  })
})
