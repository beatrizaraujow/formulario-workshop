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

/**
 * Carimbo gravado em `metadata.product` de toda sessão criada por este checkout.
 *
 * É o que diz "esta venda é do Workshop", e não outra qualquer da mesma conta
 * Stripe. Sem ele, bastaria validar moeda — e aí QUALQUER compra em BRL da conta
 * (outro produto, outro funil) passaria a disparar o Purchase do Workshop.
 *
 * Fica fora de env de propósito: quem grava e quem confere têm que usar
 * exatamente a mesma string, sempre. Se mudar aqui, sessões criadas antes da
 * mudança param de ser reconhecidas.
 */
export const WORKSHOP_PRODUCT_TAG = "workshop_carbone"

export const WORKSHOP_CURRENCY = process.env.STRIPE_CURRENCY ?? "brl"
export const WORKSHOP_PRODUCT_NAME =
  process.env.STRIPE_PRODUCT_NAME ?? "Workshop Carbone"
// Valor em centavos (R$97,00 = 9700). Só é usado se STRIPE_PRICE_ID não estiver definido.
export const WORKSHOP_AMOUNT = Number(process.env.STRIPE_AMOUNT ?? 9700)
