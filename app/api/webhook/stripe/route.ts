import type Stripe from "stripe"
import { appendSheetRow, type SheetRow } from "@/lib/sheets"
import { getStripe } from "@/lib/stripe"

async function recordSession(
  session: Stripe.Checkout.Session,
  event: SheetRow["event"]
): Promise<void> {
  const metadata = session.metadata ?? {}

  await appendSheetRow({
    event,
    leadId: metadata.leadId ?? "",
    name: metadata.name ?? session.customer_details?.name ?? "",
    email: session.customer_details?.email ?? "",
    phone: metadata.phone ?? "",
    amount:
      typeof session.amount_total === "number"
        ? (session.amount_total / 100).toFixed(2)
        : "",
    utmSource: metadata.utmSource ?? "",
    utmMedium: metadata.utmMedium ?? "",
    utmCampaign: metadata.utmCampaign ?? "",
    utmTerm: metadata.utmTerm ?? "",
    utmContent: metadata.utmContent ?? "",
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

    let row: SheetRow["event"]
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

    try {
      await recordSession(session, row)
    } catch (error) {
      // Loga mas retorna 200: o evento já aconteceu do lado do Stripe, reenviar não conserta a planilha.
      console.error(`Falha ao gravar "${row}" na planilha:`, error)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
