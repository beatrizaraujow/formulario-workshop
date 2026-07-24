import type Stripe from "stripe"
import { savePayment, type PaymentInput } from "@/lib/store"
import { getStripe, WORKSHOP_PRODUCT_TAG } from "@/lib/stripe"
import { dispatchPurchaseCapi } from "@/lib/capi-dispatch"

async function recordSession(
  session: Stripe.Checkout.Session,
  event: PaymentInput["event"]
): Promise<void> {
  const metadata = session.metadata ?? {}

  await savePayment({
    event,
    leadId: metadata.leadId ?? "",
    name: metadata.name ?? session.customer_details?.name ?? "",
    email: session.customer_details?.email ?? "",
    phone: metadata.phone ?? "",
    // Em centavos, como o Stripe manda. Quem precisa de reais converte na hora
    // de exibir — dinheiro não vira float aqui no meio do caminho.
    amountCents: typeof session.amount_total === "number" ? session.amount_total : null,
    currency: session.currency ?? "",
    utmSource: metadata.utmSource ?? "",
    utmMedium: metadata.utmMedium ?? "",
    utmCampaign: metadata.utmCampaign ?? "",
    utmTerm: metadata.utmTerm ?? "",
    utmContent: metadata.utmContent ?? "",
    // A metadata do Stripe é sempre string, então utm_id e fbclid chegam aqui
    // como texto e seguem como texto — nada de Number() no caminho.
    utmId: metadata.utmId ?? "",
    fbclid: metadata.fbclid ?? "",
    stripeSessionId: session.id,
    stripePaymentIntent:
      typeof session.payment_intent === "string" ? session.payment_intent : "",
  })
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature")
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature || !webhookSecret) {
    console.error("Webhook do Stripe sem assinatura ou sem STRIPE_WEBHOOK_SECRET configurado.")
    return new Response("Webhook não configurado.", { status: 500 })
  }

  const rawBody = await request.text()
  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (error) {
    console.error("Assinatura inválida no webhook do Stripe:", error)
    return new Response("Assinatura inválida.", { status: 400 })
  }

  const isSessionEvent =
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed"

  if (isSessionEvent) {
    const session = event.data.object as Stripe.Checkout.Session

    let row: PaymentInput["event"]
    if (event.type === "checkout.session.completed") {
      // Cartão é síncrono e já chega "paid". Métodos assíncronos (Pix) chegam aqui
      // ainda não pagos — o cliente só recebeu o QR Code. Marcar aprovado agora diria
      // que pagou quem não pagou; a confirmação real vem em async_payment_succeeded.
      row = session.payment_status === "paid" ? "pagamento_aprovado" : "pagamento_pendente"
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      row = "pagamento_aprovado"
    } else {
      row = "pagamento_falhou"
    }

    // Não precisa de try/catch: savePayment já loga a falha de cada destino e
    // não lança. Sempre respondemos 200 — o pagamento já aconteceu do lado do
    // Stripe, e pedir reenvio não conserta um destino fora do ar.
    await recordSession(session, row)

    // Purchase de servidor (Meta CAPI): só para venda REALMENTE paga e que seja
    // deste produto. Mesmo event_id (session.id) do Purchase do navegador, pra
    // Meta deduplicar. event_time é o horário real da confirmação (event.created).
    // dispatchPurchaseCapi não lança; o try é só um cinto extra — o 200 pro
    // Stripe não pode depender da Meta de jeito nenhum.
    if (row === "pagamento_aprovado" && session.metadata?.product === WORKSHOP_PRODUCT_TAG) {
      try {
        await dispatchPurchaseCapi(session, event.created)
      } catch (error) {
        console.error("[capi] erro inesperado no webhook (ignorado):", error)
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
