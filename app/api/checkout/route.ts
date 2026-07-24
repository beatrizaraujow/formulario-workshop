import { z } from "zod"
import { contactSchema } from "@/lib/validation"
import { handlePreflight, jsonResponse } from "@/lib/cors"
import {
  getStripe,
  WORKSHOP_AMOUNT,
  WORKSHOP_CURRENCY,
  WORKSHOP_PRODUCT_NAME,
  WORKSHOP_PRODUCT_TAG,
} from "@/lib/stripe"
// Import de valor, não `import type`: Stripe.errors.StripeError é usado em
// runtime no catch para logar o erro real da Stripe.
import Stripe from "stripe"

export async function OPTIONS(request: Request) {
  return handlePreflight(request)
}

// O Stripe recusa a sessão inteira se um valor de metadata passar de 500 chars.
// Um fbclid da Meta chega perto disso, então corta aqui, na fronteira com o
// Stripe — o valor completo continua indo inteiro pro nosso banco.
const STRIPE_METADATA_MAX = 500
const clampMetadata = (value: string): string => value.slice(0, STRIPE_METADATA_MAX)

/**
 * client_reference_id é o campo que amarra a sessão do Stripe ao nosso lead.
 * Recebe o id INTERNO do lead (UUID gerado no navegador) — nunca utm_id,
 * fbclid ou a URL: esses são dados de terceiros, mudam a cada clique e não
 * identificam a pessoa. O Stripe aceita até 200 chars; o resto vira "_".
 */
const toClientReferenceId = (leadId: string): string =>
  leadId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200)

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(request, { ok: false, error: "JSON inválido." }, { status: 400 })
  }

  const parsed = contactSchema.safeParse(body)
  if (!parsed.success) {
    // Depois que o rastreamento virou tolerante, só nome/e-mail/telefone podem
    // cair aqui. Logar o campo é o que impede que uma regra de validação nova
    // volte a derrubar checkout em silêncio, como o `.max(300)` do landingUrl fez.
    console.warn("Checkout recusado na validação:", z.flattenError(parsed.error))
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

  // Dados de correspondência da Meta capturados no SERVIDOR, a partir desta
  // requisição — que vem do navegador do comprador (o fetchClientSecret roda no
  // browser). Guardados no metadata da sessão pra que o webhook os reenvie no
  // Purchase do CAPI. O primeiro IP do x-forwarded-for é o do cliente.
  const clientIp = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim()
  const clientUa = request.headers.get("user-agent") ?? ""

  // Cada parâmetro vai como uma chave própria, string pura. Nada de concatenar
  // tudo numa só nem de mandar a URL inteira: chave separada é o que deixa o
  // valor legível no Dashboard e recuperável no webhook sem ter que parsear.
  const metadata = {
    // Marca a sessão como "venda do Workshop". É o que a rota de verificação
    // confere antes de deixar a página de obrigado contar a compra.
    product: WORKSHOP_PRODUCT_TAG,
    leadId: data.leadId,
    name: clampMetadata(data.name),
    phone: clampMetadata(data.phone),
    utmSource: clampMetadata(data.utmSource),
    utmMedium: clampMetadata(data.utmMedium),
    utmCampaign: clampMetadata(data.utmCampaign),
    utmTerm: clampMetadata(data.utmTerm),
    utmContent: clampMetadata(data.utmContent),
    utmId: clampMetadata(data.utmId),
    fbclid: clampMetadata(data.fbclid),
    // Cookies do Pixel (_fbc/_fbp) e ip/ua: só o que o CAPI usa em user_data.
    fbc: clampMetadata(data.fbc),
    fbp: clampMetadata(data.fbp),
    clientIp: clampMetadata(clientIp),
    clientUa: clampMetadata(clientUa),
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
      //
      // Mostra o campo "Adicionar cupom" dentro do checkout. Quem valida o código e
      // aplica o desconto é a própria Stripe; os cupons são criados no Dashboard
      // (Product catalog > Coupons). Sem cupom cadastrado, o campo aparece mas nenhum
      // código funciona.
      allow_promotion_codes: true,
      client_reference_id: toClientReferenceId(data.leadId),
      customer_email: data.email,
      line_items: lineItems,
      metadata,
      return_url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
    })

    return jsonResponse(request, { ok: true, clientSecret: session.client_secret })
  } catch (error) {
    // O visitante continua vendo uma mensagem genérica (não expomos detalhe de
    // infraestrutura no navegador), mas o log recebe o erro REAL do Stripe:
    // type/code/param são o que diz se foi metadata longa demais, chave errada
    // ou moeda inválida. Sem isso, "Something went wrong" não dá o que debugar.
    if (error instanceof Stripe.errors.StripeError) {
      console.error("Stripe recusou a criação da sessão:", {
        type: error.type,
        code: error.code,
        param: error.param,
        statusCode: error.statusCode,
        // requestId é o que a própria Stripe pede no suporte pra achar a chamada.
        requestId: error.requestId,
        message: error.message,
      })
    } else {
      console.error("Falha ao criar sessão de checkout no Stripe:", error)
    }

    return jsonResponse(
      request,
      { ok: false, error: "Não foi possível iniciar o pagamento. Tente novamente." },
      { status: 502 }
    )
  }
}
