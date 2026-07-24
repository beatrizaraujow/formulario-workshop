import type Stripe from "stripe"
import { getStripe, WORKSHOP_PRODUCT_TAG } from "@/lib/stripe"
import { capiInputFromSession, isCapiConfigured, sendPurchaseCapi } from "@/lib/meta-capi"

/**
 * Reenvio manual do Purchase (Meta CAPI) por Session ID.
 *
 * Dois usos:
 *  1. Backfill de uma venda que não contou (ex: a compra da Patrícia, feita
 *     antes de o CAPI existir) — usando o event_time ORIGINAL do pagamento.
 *  2. Reenvio das que ficaram como `capi_falhou` na planilha por instabilidade
 *     da Meta.
 *
 * Protegida por ADMIN_TOKEN (header `x-admin-token`). Sem ADMIN_TOKEN a rota
 * fica desligada (503) — não existe reenvio aberto ao público.
 *
 *   GET  ?email=...          → lista sessões pagas do Workshop pra achar o cs_id
 *   POST { sessionId, ... }  → reenvia o Purchase daquela sessão
 */

function isAuthorized(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected) return false
  return request.headers.get("x-admin-token") === expected
}

function unauthorized(configured: boolean): Response {
  // 503 quando a rota nem está habilitada; 401 quando o token veio errado.
  const status = configured ? 401 : 503
  const error = configured ? "Não autorizado." : "Reenvio desligado (defina ADMIN_TOKEN)."
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

// Horário REAL da confirmação do pagamento, pra o backfill não mandar "agora"
// como event_time. Ordem: created do charge → do payment_intent → da sessão.
function paymentTimeSeconds(session: Stripe.Checkout.Session): number {
  const pi = session.payment_intent
  if (pi && typeof pi !== "string") {
    const charge = (pi as Stripe.PaymentIntent).latest_charge
    if (charge && typeof charge !== "string") {
      return (charge as Stripe.Charge).created
    }
    if (typeof (pi as Stripe.PaymentIntent).created === "number") {
      return (pi as Stripe.PaymentIntent).created
    }
  }
  return session.created
}

export async function GET(request: Request): Promise<Response> {
  const configured = Boolean(process.env.ADMIN_TOKEN)
  if (!isAuthorized(request)) return unauthorized(configured)

  const email = (new URL(request.url).searchParams.get("email") ?? "").trim().toLowerCase()
  const stripe = getStripe()

  // Lista as sessões recentes e filtra do lado de cá: a API do Stripe não
  // busca por e-mail. Suficiente pra localizar uma venda específica.
  const list = await stripe.checkout.sessions.list({ limit: 100 })
  const matches = list.data
    .filter((s) => s.metadata?.product === WORKSHOP_PRODUCT_TAG)
    .filter((s) => {
      if (!email) return true
      const sessionEmail = (s.customer_details?.email ?? s.customer_email ?? "").toLowerCase()
      return sessionEmail.includes(email)
    })
    .map((s) => ({
      sessionId: s.id,
      created: new Date(s.created * 1000).toISOString(),
      name: s.customer_details?.name ?? s.metadata?.name ?? "",
      email: s.customer_details?.email ?? s.customer_email ?? "",
      amountReais: typeof s.amount_total === "number" ? s.amount_total / 100 : null,
      currency: s.currency,
      status: s.status,
      paymentStatus: s.payment_status,
    }))

  return json({ ok: true, count: matches.length, sessions: matches })
}

export async function POST(request: Request): Promise<Response> {
  const configured = Boolean(process.env.ADMIN_TOKEN)
  if (!isAuthorized(request)) return unauthorized(configured)

  if (!isCapiConfigured()) {
    return json({ ok: false, error: "CAPI sem META_PIXEL_ID/META_CAPI_TOKEN." }, 400)
  }

  let body: { sessionId?: string; testEventCode?: string; force?: boolean }
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400)
  }

  const sessionId = body.sessionId?.trim()
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return json({ ok: false, error: "sessionId (cs_...) obrigatório." }, 400)
  }

  const stripe = getStripe()
  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.latest_charge"],
    })
  } catch (error) {
    return json({ ok: false, error: `Sessão não encontrada: ${String(error)}` }, 404)
  }

  if (session.metadata?.product !== WORKSHOP_PRODUCT_TAG) {
    return json({ ok: false, error: "Não é uma sessão do Workshop." }, 422)
  }

  const isPaid = session.status === "complete" && session.payment_status === "paid"
  if (!isPaid) {
    return json(
      { ok: false, error: `Sessão não paga (status=${session.status}, payment=${session.payment_status}).` },
      422
    )
  }

  // Trava anti-teste: a compra de R$1 (Maria Clara) não deve ser reenviada.
  // Só passa com force=true, caso um dia haja um R$1 legítimo.
  const amountCents = typeof session.amount_total === "number" ? session.amount_total : 0
  if (amountCents <= 100 && !body.force) {
    return json(
      { ok: false, error: `Valor R$${(amountCents / 100).toFixed(2)} parece teste — use force:true se for real.` },
      422
    )
  }

  const eventTime = paymentTimeSeconds(session)
  const result = await sendPurchaseCapi(capiInputFromSession(session, eventTime), {
    testEventCode: body.testEventCode,
  })

  return json({
    ok: result.ok,
    sessionId,
    eventTime,
    eventTimeIso: new Date(eventTime * 1000).toISOString(),
    amountReais: amountCents / 100,
    result,
  })
}
