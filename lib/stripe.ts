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

// Métodos de pagamento aceitos no Checkout (separados por vírgula na env).
// Pix depende de liberação na conta Stripe (lista de espera no Brasil); enquanto
// isso não sai, o padrão é só "card". Quando o Pix for aprovado, defina
// STRIPE_PAYMENT_METHODS=card,pix nas variáveis do Vercel e redeploye — sem tocar no código.
export const WORKSHOP_PAYMENT_METHODS = (process.env.STRIPE_PAYMENT_METHODS ?? "card")
  .split(",")
  .map((method) => method.trim())
  .filter(Boolean) as Stripe.Checkout.SessionCreateParams.PaymentMethodType[]
