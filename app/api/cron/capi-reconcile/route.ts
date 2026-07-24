import type Stripe from "stripe"
import { getStripe, WORKSHOP_PRODUCT_TAG } from "@/lib/stripe"
import { isCapiConfigured } from "@/lib/meta-capi"
import { dispatchPurchaseCapi, hasCapiSent, paymentTimeSeconds } from "@/lib/capi-dispatch"

/**
 * Reconciliação automática do Purchase de servidor (Meta CAPI).
 *
 * Roda 1x/dia (Vercel Cron, ver vercel.json). Procura vendas pagas do Workshop
 * dos últimos dias que AINDA não têm o marcador `capiSent` no metadata — ou
 * seja, cujo envio inline no webhook falhou em todas as tentativas — e reenvia.
 *
 * É seguro reenviar: a Meta deduplica pelo event_id (= session.id), e o ledger
 * `capiSent` impede que uma venda já enviada seja reenviada (o que poderia
 * contar duas vezes fora da janela de dedupe). Uma instabilidade da Meta que
 * dure horas deixa de perder a conversão — o cron pega no dia seguinte.
 *
 * Protegida por CRON_SECRET (o Vercel Cron manda `Authorization: Bearer <secret>`).
 */

const LOOKBACK_DAYS = 3

function unauthorized(): Response {
  return new Response(JSON.stringify({ ok: false, error: "Não autorizado." }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  })
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  // Sem CRON_SECRET a rota fica fechada. O Vercel Cron manda o header abaixo.
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorized()
  }

  if (!isCapiConfigured()) {
    return Response.json({ ok: true, skipped: "CAPI desligado (sem PIXEL_ID/token)." })
  }

  const stripe = getStripe()
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 24 * 60 * 60

  // Lista barata pra achar candidatos; o metadata da lista pode estar defasado
  // em relação a um capiSent recém-gravado, então cada candidato é RE-buscado
  // fresco antes de decidir (evita corrida com o webhook).
  const candidates: Stripe.Checkout.Session[] = []
  for await (const session of stripe.checkout.sessions.list({
    created: { gte: since },
    limit: 100,
  })) {
    const isPaid = session.status === "complete" && session.payment_status === "paid"
    const amount = typeof session.amount_total === "number" ? session.amount_total : 0
    if (
      session.metadata?.product === WORKSHOP_PRODUCT_TAG &&
      isPaid &&
      amount > 100 && // ignora testes de R$1
      !hasCapiSent(session)
    ) {
      candidates.push(session)
    }
  }

  const resent: Array<{ sessionId: string; ok: boolean }> = []
  for (const candidate of candidates) {
    // Re-busca fresco: pega capiSent recente e o charge (pro event_time real).
    const session = await stripe.checkout.sessions.retrieve(candidate.id, {
      expand: ["payment_intent.latest_charge"],
    })
    if (hasCapiSent(session)) continue

    const result = await dispatchPurchaseCapi(session, paymentTimeSeconds(session))
    resent.push({ sessionId: session.id, ok: result.ok })
  }

  return Response.json({
    ok: true,
    lookbackDays: LOOKBACK_DAYS,
    candidates: candidates.length,
    resent,
  })
}
