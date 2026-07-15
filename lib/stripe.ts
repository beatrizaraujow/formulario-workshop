import Stripe from "stripe"

let cachedClient: Stripe | null = null

export function getStripe(): Stripe {
  if (cachedClient) return cachedClient

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY não configurado.")
  }

  cachedClient = new Stripe(key, {
    appInfo: { name: "formulario-workshop" },
  })
  return cachedClient
}

export const WORKSHOP_CURRENCY = process.env.STRIPE_CURRENCY ?? "brl"
export const WORKSHOP_PRODUCT_NAME =
  process.env.STRIPE_PRODUCT_NAME ?? "Workshop Carbone"
// Valor em centavos (R$97,00 = 9700). Só é usado se STRIPE_PRICE_ID não estiver definido.
export const WORKSHOP_AMOUNT = Number(process.env.STRIPE_AMOUNT ?? 9700)
