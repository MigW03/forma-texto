// Billing unit is the "lauda" (~300-word unit). `perPage` keeps its name so the
// value flows unchanged through the API/Stripe metadata, but it is now R$ per lauda.
export const PRICING = {
  formatting: {
    perPage: 1,    // R$ per lauda
    minimum: 5,    // R$ minimum
  },
  proofreading: {
    perPage: 2,    // R$ per lauda
    minimum: 15,   // R$ minimum
  },
} as const

export type ServiceKey = keyof typeof PRICING

/** Price for `count` laudas of a service, with the per-service minimum applied. */
export function calcPrice(service: ServiceKey, count: number): number {
  const { perPage, minimum } = PRICING[service]
  return Math.max(count * perPage, minimum)
}

/** One lauda free — subtracted from the post-minimum total, floor 0 */
export function calcPriceWithTrial(service: ServiceKey, count: number): number {
  return Math.max(calcPrice(service, count) - PRICING[service].perPage, 0)
}

export function trialDiscountBRL(services: ServiceKey[]): number {
  return services.reduce((sum, s) => sum + PRICING[s].perPage, 0)
}

export function formatBRL(amount: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}
