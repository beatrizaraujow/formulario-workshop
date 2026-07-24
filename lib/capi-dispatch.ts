import type Stripe from "stripe"
import { getStripe } from "@/lib/stripe"
import { capiInputFromSession, sendPurchaseCapi, type CapiResult } from "@/lib/meta-capi"
import { saveCapiFailure } from "@/lib/store"

/**
 * Orquestra o Purchase de servidor de forma IDEMPOTENTE e recuperável.
 *
 * O problema que isto resolve: o retry dentro de sendPurchaseCapi cobre uma
 * instabilidade passageira, mas se TODAS as tentativas falham o webhook ainda
 * responde 200 (o pagamento aconteceu — não dá pra pedir reenvio do evento
 * inteiro à Stripe). Sem mais nada, a venda ficaria perdida na Meta.
 *
 * A rede de segurança tem três camadas:
 *   1. envio inline com retry (aqui, via sendPurchaseCapi)
 *   2. LEDGER de idempotência no metadata da sessão (capiSent): marca quando um
 *      envio REAL deu certo. É o que o cron usa pra saber o que ainda falta —
 *      sem depender do Supabase (que está desligado).
 *   3. cron diário de reconciliação (/api/cron/capi-reconcile) reenvia toda
 *      venda paga sem capiSent. Como a Meta deduplica por event_id, reenviar é
 *      inofensivo; o ledger evita reenviar o que já foi (e contar duas vezes).
 *
 * Falha que sobrevive vira `capi_falhou` na planilha (alerta humano).
 */

// Chave gravada no metadata da sessão do Stripe quando um envio REAL confirma.
// Envio de teste (test_event_code) NUNCA marca: vai pro ambiente de teste e não
// pode bloquear o envio de produção depois (ex: backfill da Patrícia).
export const CAPI_SENT_METADATA_KEY = "capiSent"

export function hasCapiSent(session: Stripe.Checkout.Session): boolean {
  return Boolean(session.metadata?.[CAPI_SENT_METADATA_KEY])
}

/**
 * Horário REAL da confirmação do pagamento (unix, segundos): created do charge
 * → do payment_intent → da sessão. Precisa da sessão com
 * expand ["payment_intent.latest_charge"] pra achar o charge.
 */
export function paymentTimeSeconds(session: Stripe.Checkout.Session): number {
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

async function markCapiSent(sessionId: string, eventTimeSeconds: number): Promise<void> {
  try {
    // update mescla metadata: seta só esta chave, mantém as outras.
    await getStripe().checkout.sessions.update(sessionId, {
      metadata: { [CAPI_SENT_METADATA_KEY]: String(eventTimeSeconds) },
    })
  } catch (error) {
    // Não crítico: se marcar falhar, o pior caso é o cron reenviar (a Meta
    // deduplica pelo event_id). Nunca deixa isso derrubar o fluxo.
    console.error("[capi] falha ao marcar capiSent (não crítico):", error)
  }
}

/**
 * Envia o Purchase, marca o ledger em sucesso REAL e registra capi_falhou em
 * falha. Nunca lança. Usado pelo webhook, pelo cron e pela rota admin.
 */
export async function dispatchPurchaseCapi(
  session: Stripe.Checkout.Session,
  eventTimeSeconds: number,
  options: { testEventCode?: string } = {}
): Promise<CapiResult> {
  const isTest = Boolean(options.testEventCode)

  const result = await sendPurchaseCapi(
    capiInputFromSession(session, eventTimeSeconds),
    { testEventCode: options.testEventCode }
  )

  if (result.ok) {
    if (!isTest) await markCapiSent(session.id, eventTimeSeconds)
    console.log("[capi] Purchase enviado", {
      sessionId: session.id,
      attempts: result.attempts,
      test: isTest,
    })
    return result
  }

  if (result.skipped) {
    console.log("[capi] envio desligado (sem PIXEL_ID/token)", { sessionId: session.id })
    return result
  }

  console.error("[capi] capi_falhou", {
    sessionId: session.id,
    status: result.status,
    attempts: result.attempts,
    detail: result.detail,
  })

  const metadata = session.metadata ?? {}
  await saveCapiFailure({
    leadId: metadata.leadId ?? "",
    name: metadata.name ?? session.customer_details?.name ?? "",
    email: session.customer_details?.email ?? session.customer_email ?? "",
    phone: metadata.phone ?? "",
    amountCents: typeof session.amount_total === "number" ? session.amount_total : null,
    stripeSessionId: session.id,
    stripePaymentIntent:
      typeof session.payment_intent === "string" ? session.payment_intent : "",
    detail: `${result.status ?? "no-status"} ${result.detail ?? ""}`.trim(),
  })

  return result
}
