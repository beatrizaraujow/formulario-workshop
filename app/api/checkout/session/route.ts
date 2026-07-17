import { handlePreflight, jsonResponse } from "@/lib/cors"
import { getStripe, WORKSHOP_CURRENCY, WORKSHOP_PRODUCT_TAG } from "@/lib/stripe"

export async function OPTIONS(request: Request) {
  return handlePreflight(request)
}

/**
 * Confirma, com a chave secreta, se uma sessão de checkout foi realmente paga.
 *
 * Existe por causa do rastreamento: a página de obrigado não pode disparar o
 * `purchase_workshop` só porque alguém abriu a URL — abrir ou dar F5 em
 * /obrigado-workshop viraria uma compra falsa no relatório. Quem decide se
 * houve compra é o Stripe, aqui no servidor, e não a URL que o navegador pediu.
 *
 * O `session_id` chega na URL de retorno, então é um dado que o visitante vê e
 * pode adulterar. Por isso nada aqui confia nele: ele só serve pra perguntar ao
 * Stripe, e a resposta é montada a partir do que o Stripe devolveu.
 */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id")

  if (!sessionId || !sessionId.startsWith("cs_")) {
    return jsonResponse(request, { ok: true, purchase: null, reason: "sem_session_id" })
  }

  let session
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId)
  } catch (error) {
    // ID inexistente/inválido é rotina (link velho, URL digitada na mão): responde
    // "não houve compra" e pronto. Só falha de verdade — Stripe fora do ar, chave
    // errada — vira 502, pra não mascarar problema de infra como "não pagou".
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "resource_missing"
    ) {
      return jsonResponse(request, { ok: true, purchase: null, reason: "sessao_inexistente" })
    }

    console.error("Falha ao consultar sessão de checkout no Stripe:", error)
    return jsonResponse(
      request,
      { ok: false, error: "Não foi possível confirmar o pagamento." },
      { status: 502 }
    )
  }

  // A sessão é DESTE produto? A conta Stripe é a mesma para tudo que a Carbone
  // vende, então sem este carimbo uma compra qualquer em BRL — outro produto,
  // outro funil — dispararia o Purchase do Workshop. O `metadata.product` é
  // gravado pelo nosso próprio backend em /api/checkout, não vem do visitante.
  if (session.metadata?.product !== WORKSHOP_PRODUCT_TAG) {
    return jsonResponse(request, { ok: true, purchase: null, reason: "outro_produto" })
  }

  // As três condições que definem "comprou": o checkout terminou, o dinheiro
  // entrou e está na moeda certa. Pix pago depois cai aqui como `unpaid` no
  // retorno — e não deve mesmo disparar compra nesse momento.
  const isPaid = session.status === "complete" && session.payment_status === "paid"
  const hasExpectedCurrency = (session.currency ?? "").toLowerCase() === WORKSHOP_CURRENCY.toLowerCase()
  const amountCents = session.amount_total

  if (!isPaid || !hasExpectedCurrency || typeof amountCents !== "number" || amountCents <= 0) {
    return jsonResponse(request, { ok: true, purchase: null, reason: "nao_pago" })
  }

  // Só o mínimo que o dataLayer precisa. O resto da sessão (e-mail, endereço,
  // payment_intent) não sai daqui: quem pede este endpoint é o navegador, e
  // basta ter o session_id na mão pra perguntar.
  return jsonResponse(request, {
    ok: true,
    purchase: {
      transactionId: session.id,
      // Valor REAL pago, em centavos. Não é fixado em 9700 de propósito: o
      // checkout aceita cupom (allow_promotion_codes), e travar no valor cheio
      // faria toda compra com desconto sumir do relatório.
      amountCents,
      currency: session.currency,
    },
  })
}
