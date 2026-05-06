export const PRICING = {
  formatting: {
    perPage: 1,    // R$ per page
    minimum: 5,    // R$ minimum
  },
  proofreading: {
    perPage: 2,    // R$ per page
    minimum: 15,   // R$ minimum
  },
} as const

export type ServiceKey = keyof typeof PRICING

export function calcPrice(service: ServiceKey, pageCount: number): number {
  const { perPage, minimum } = PRICING[service]
  return Math.max(pageCount * perPage, minimum)
}

export function formatBRL(amount: number): string {
  return `R$${amount.toFixed(0)}`
}
