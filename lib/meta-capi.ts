import { createHash } from "node:crypto"
import type Stripe from "stripe"

/**
 * Envio do Purchase para a API de Conversões da Meta (CAPI), servidor-a-servidor.
 *
 * Por que existe: o Purchase do NAVEGADOR (Pixel via GTM, disparado pela
 * /obrigado-workshop) depende de uma corrente frágil — redirect da Stripe,
 * componente publicado no Framer, fetch cross-origin, adblock, iOS. Qualquer
 * elo que quebre some com a venda no Gerenciador de Eventos, em silêncio.
 *
 * Aqui o webhook do Stripe — que já sabe de TODA venda real — manda o mesmo
 * Purchase de novo, pelo servidor, usando `event_id = session.id`, EXATAMENTE
 * o mesmo id que o navegador usa. A Meta deduplica pelos dois (event_name +
 * event_id): se os dois chegam, conta 1; se só o servidor chega, conta 1. O
 * servidor vira o piso garantido — o número na Meta passa a bater com o Stripe.
 *
 * Nada aqui lança: falha da Meta não pode derrubar o registro da venda nem a
 * resposta 200 do webhook do Stripe. Quem chama trata o resultado (grava
 * capi_falhou e permite reenvio).
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0"

// A página de retorno onde o Pixel do navegador dispara o mesmo Purchase.
// Precisa casar com o event_source_url do lado do navegador pra qualidade de
// correspondência; por isso é fixo (com override por env, se um dia mudar).
const EVENT_SOURCE_URL =
  process.env.META_EVENT_SOURCE_URL ?? "https://carboneeducacao.com.br/obrigado-workshop"

// Tentativas dentro da própria requisição: cobre instabilidade passageira da
// Meta (timeout, 5xx, 429). Erro de payload (4xx) não é reenviado — reenviar
// não conserta dado errado. Falha que sobrevive às tentativas vira capi_falhou
// no chamador, pra reenvio posterior.
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [300, 900]

export function isCapiConfigured(): boolean {
  return Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN)
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

// E-mail: a normalização que a Meta espera é aparar espaços e minúsculo. Nada
// de remover pontos/“+alias” — a Meta faz o casamento com o hash exato.
export function hashEmail(email: string | null | undefined): string | undefined {
  const normalized = (email ?? "").trim().toLowerCase()
  if (!normalized || !normalized.includes("@")) return undefined
  return sha256(normalized)
}

// Telefone: só dígitos, com código do país. O formulário coleta 11 dígitos
// (DDD + 9). A Meta quer 55 + número. Se já vier com 55 na frente, mantém.
export function hashPhone(phone: string | null | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "")
  if (!digits) return undefined
  let e164: string
  if (digits.length === 11) e164 = `55${digits}`
  else if (digits.length === 10) e164 = `55${digits}`
  else if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) e164 = digits
  else e164 = digits
  return sha256(e164)
}

/** Dado de correspondência já normalizado, pronto pra virar user_data da Meta. */
export type CapiPurchaseInput = {
  sessionId: string
  // Segundos (unix). É o horário REAL da confirmação do pagamento — vem do
  // event.created do webhook (ou do charge, no reenvio), nunca de "agora".
  eventTimeSeconds: number
  value: number // em reais (amount_total / 100)
  currency: string // "BRL"
  email?: string
  phone?: string
  // Cookies capturados no navegador (_fbc/_fbp) e guardados no metadata da
  // sessão. A Meta espera fbc — NUNCA o fbclid cru num campo "fbclid".
  fbc?: string
  fbp?: string
  // Só usado pra CONSTRUIR um fbc quando o cookie _fbc não foi capturado.
  fbclid?: string
  clientIp?: string
  clientUa?: string
}

function buildUserData(input: CapiPurchaseInput): Record<string, unknown> {
  const userData: Record<string, unknown> = {}

  const em = hashEmail(input.email)
  if (em) userData.em = [em]

  const ph = hashPhone(input.phone)
  if (ph) userData.ph = [ph]

  // fbc do cookie _fbc é o ideal. Sem ele, mas com fbclid, dá pra montar o
  // formato que a Meta usa: fb.1.<timestamp_ms>.<fbclid>. O cookie sempre ganha.
  const fbc = input.fbc?.trim()
  if (fbc) userData.fbc = fbc
  else if (input.fbclid?.trim()) {
    userData.fbc = `fb.1.${input.eventTimeSeconds * 1000}.${input.fbclid.trim()}`
  }

  if (input.fbp?.trim()) userData.fbp = input.fbp.trim()
  if (input.clientIp?.trim()) userData.client_ip_address = input.clientIp.trim()
  if (input.clientUa?.trim()) userData.client_user_agent = input.clientUa.trim()

  return userData
}

function buildPayload(input: CapiPurchaseInput, testEventCode?: string) {
  const event = {
    event_name: "Purchase",
    event_time: input.eventTimeSeconds,
    // Mesma chave de dedupe do navegador.
    event_id: input.sessionId,
    action_source: "website",
    event_source_url: EVENT_SOURCE_URL,
    user_data: buildUserData(input),
    custom_data: {
      currency: input.currency.toUpperCase(),
      value: input.value,
      order_id: input.sessionId,
    },
  }

  const payload: Record<string, unknown> = { data: [event] }
  if (testEventCode) payload.test_event_code = testEventCode
  return payload
}

/** Extrai os dados de correspondência da sessão do Stripe (metadata + Stripe). */
export function capiInputFromSession(
  session: Stripe.Checkout.Session,
  eventTimeSeconds: number
): CapiPurchaseInput {
  const metadata = session.metadata ?? {}
  return {
    sessionId: session.id,
    eventTimeSeconds,
    value:
      typeof session.amount_total === "number" ? session.amount_total / 100 : 0,
    currency: session.currency ?? "brl",
    email: session.customer_details?.email ?? session.customer_email ?? undefined,
    phone: metadata.phone ?? session.customer_details?.phone ?? undefined,
    fbc: metadata.fbc ?? undefined,
    fbp: metadata.fbp ?? undefined,
    fbclid: metadata.fbclid ?? undefined,
    clientIp: metadata.clientIp ?? undefined,
    clientUa: metadata.clientUa ?? undefined,
  }
}

export type CapiResult = {
  ok: boolean
  // Configuração ausente (sem PIXEL_ID/token): não é erro, é "desligado".
  skipped?: boolean
  status?: number
  attempts: number
  // fbtrace_id / mensagem da Meta, útil no log quando falha.
  detail?: string
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Envia o Purchase pra Meta. Nunca lança. Reenvia em falha transitória
 * (rede/5xx/429), até MAX_ATTEMPTS. Retorna o desfecho pro chamador decidir se
 * grava capi_falhou.
 */
export async function sendPurchaseCapi(
  input: CapiPurchaseInput,
  options: { testEventCode?: string } = {}
): Promise<CapiResult> {
  const pixelId = process.env.META_PIXEL_ID
  const token = process.env.META_CAPI_TOKEN
  if (!pixelId || !token) {
    return { ok: false, skipped: true, attempts: 0 }
  }

  const testEventCode = options.testEventCode ?? process.env.META_TEST_EVENT_CODE
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`
  const body = JSON.stringify(buildPayload(input, testEventCode || undefined))

  let lastDetail = ""
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })

      if (response.ok) {
        return { ok: true, status: response.status, attempts: attempt }
      }

      const text = await response.text()
      lastDetail = `${response.status} ${text}`.slice(0, 500)

      // 4xx que não seja 429 é payload/credencial errada: reenviar não resolve.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return { ok: false, status: response.status, attempts: attempt, detail: lastDetail }
      }
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error)
    }

    if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1] ?? 900)
  }

  return { ok: false, attempts: MAX_ATTEMPTS, detail: lastDetail }
}
