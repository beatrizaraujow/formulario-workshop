import { z } from "zod"
import { contactSchema } from "@/lib/validation"
import { handlePreflight, jsonResponse } from "@/lib/cors"
import {
  getStripe,
  WORKSHOP_AMOUNT,
  WORKSHOP_CURRENCY,
  WORKSHOP_PRODUCT_NAME,
} from "@/lib/stripe"
import type Stripe from "stripe"

export async function OPTIONS(request: Request) {
  return handlePreflight(request)
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(request, { ok: false, error: "JSON inválido." }, { status: 400 })
  }

  const parsed = contactSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse(
      request,
      { ok: false, error: "Dados inválidos.", issues: z.flattenError(parsed.error) },
      { status: 400 }
    )
  }

  const data = parsed.data

  if (data.honeypot) {
    return jsonResponse(request, { ok: false, error: "Requisição inválida." }, { status: 400 })
  }

  // No modo embedded não existe cancel_url: o Checkout roda dentro da página e só
  // usa return_url, pra onde o cliente vai depois de concluir o pagamento.
  const successUrl = process.env.STRIPE_SUCCESS_URL
  if (!successUrl) {
    console.error("STRIPE_SUCCESS_URL não configurado.")
    return jsonResponse(
      request,
      { ok: false, error: "Checkout não configurado. Tente novamente mais tarde." },
      { status: 500 }
    )
  }

  const metadata = {
    leadId: data.leadId,
    name: data.name,
    phone: data.phone,
    utmSource: data.utmSource ?? "",
    utmMedium: data.utmMedium ?? "",
    utmCampaign: data.utmCampaign ?? "",
    utmTerm: data.utmTerm ?? "",
    utmContent: data.utmContent ?? "",
  }

  const priceId = process.env.STRIPE_PRICE_ID
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = priceId
    ? [{ price: priceId, quantity: 1 }]
    : [
        {
          quantity: 1,
          price_data: {
            currency: WORKSHOP_CURRENCY,
            unit_amount: WORKSHOP_AMOUNT,
            product_data: { name: WORKSHOP_PRODUCT_NAME },
          },
        },
      ]

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Renderiza o pagamento dentro da própria página, sem redirecionar pro Stripe.
      ui_mode: "embedded_page",
      // payment_method_types é omitido de propósito: assim o Checkout usa os métodos
      // habilitados no Dashboard da Stripe. Quando o Pix for aprovado na conta, ele
      // passa a aparecer sozinho — sem mexer no código e sem redeploy.
      customer_email: data.email,
      line_items: lineItems,
      metadata,
      return_url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
    })

    return jsonResponse(request, { ok: true, clientSecret: session.client_secret })
  } catch (error) {
    console.error("Falha ao criar sessão de checkout no Stripe:", error)
    return jsonResponse(
      request,
      { ok: false, error: "Não foi possível iniciar o pagamento. Tente novamente." },
      { status: 502 }
    )
  }
}
