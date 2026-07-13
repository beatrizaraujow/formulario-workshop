import type Stripe from "stripe"
import { appendSheetRow } from "@/lib/sheets"
import { getStripe } from "@/lib/stripe"

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session
    const metadata = session.metadata ?? {}

    try {
      await appendSheetRow({
        event: "pagamento_aprovado",
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
    } catch (error) {
      // Loga mas retorna 200: o pagamento já foi aprovado, não faz sentido o Stripe reenviar o evento por isso.
      console.error("Falha ao gravar pagamento aprovado na planilha:", error)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
