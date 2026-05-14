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

/** One page free — subtracted from the post-minimum total, floor 0 */
export function calcPriceWithTrial(service: ServiceKey, pageCount: number): number {
  return Math.max(calcPrice(service, pageCount) - PRICING[service].perPage, 0)
}

export function trialDiscountBRL(services: ServiceKey[]): number {
  return services.reduce((sum, s) => sum + PRICING[s].perPage, 0)
}

export function formatBRL(amount: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}
