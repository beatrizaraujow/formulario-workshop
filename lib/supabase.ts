import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { SheetRow } from "@/lib/sheets"

/**
 * Acesso ao Supabase a partir do backend (rotas /api).
 *
 * ATENÇÃO: usa a SERVICE ROLE KEY, que ignora o RLS e lê/escreve tudo.
 * Ela só pode existir no servidor — nunca importe este arquivo em código
 * que roda no navegador, e nunca cole essa chave no componente do Framer.
 * O componente do Framer não fala com o Supabase: ele fala com /api, e o
 * /api fala com o banco.
 */
let cachedClient: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados.")
  }

  cachedClient = createClient(url, key, {
    // Backend sem sessão de usuário: não há o que persistir nem renovar.
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedClient
}

export type LeadRecord = {
  leadId: string
  name?: string
  email?: string
  phone?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  // Ambos são texto, sempre. utm_id é um id de campanha da Meta com 18 dígitos:
  // como número ele passa de 2^53 e o JavaScript o arredonda em silêncio,
  // trocando o id por outro parecido. fbclid nem número é.
  utmId?: string
  fbclid?: string
  referrer?: string
  landingUrl?: string
}

// Converte "" em null: o formulário manda string vazia nos campos que a pessoa
// não preencheu, e vazio no banco é ruído — null diz "não sabemos".
const orNull = (value: string | undefined): string | null =>
  value && value.trim() !== "" ? value.trim() : null

/**
 * Cria ou atualiza o lead. Chamado na visita (só atribuição) e na etapa 1
 * (com nome/e-mail/telefone), sempre com o mesmo id vindo do navegador.
 *
 * Só manda as colunas que conhece: as demais ficam intactas num update,
 * então a etapa 1 não apaga os UTMs gravados na visita.
 */
export async function upsertLead(record: LeadRecord): Promise<void> {
  const row: Record<string, string | null> = { id: record.leadId }

  if (record.name !== undefined) row.name = orNull(record.name)
  if (record.email !== undefined) row.email = orNull(record.email)
  if (record.phone !== undefined) row.phone = orNull(record.phone)
  if (record.utmSource !== undefined) row.utm_source = orNull(record.utmSource)
  if (record.utmMedium !== undefined) row.utm_medium = orNull(record.utmMedium)
  if (record.utmCampaign !== undefined) row.utm_campaign = orNull(record.utmCampaign)
  if (record.utmTerm !== undefined) row.utm_term = orNull(record.utmTerm)
  if (record.utmContent !== undefined) row.utm_content = orNull(record.utmContent)
  if (record.utmId !== undefined) row.utm_id = orNull(record.utmId)
  if (record.fbclid !== undefined) row.fbclid = orNull(record.fbclid)
  if (record.referrer !== undefined) row.referrer = orNull(record.referrer)
  if (record.landingUrl !== undefined) row.landing_url = orNull(record.landingUrl)

  const { error } = await getSupabase().from("leads").upsert(row, { onConflict: "id" })
  if (error) {
    throw new Error(`Supabase upsertLead falhou: ${error.message}`)
  }
}

export type PaymentRecord = {
  leadId: string
  name: string
  email: string
  phone: string
  stripeSessionId: string
  stripePaymentIntent: string
  status: "pending" | "paid" | "failed"
  amountCents: number | null
  currency: string
}

// Os nomes de evento da planilha e os status do banco são vocabulários
// diferentes de propósito: a planilha é lida por pessoas, o banco por queries.
export function statusFromSheetEvent(
  event: SheetRow["event"]
): PaymentRecord["status"] | null {
  if (event === "pagamento_aprovado") return "paid"
  if (event === "pagamento_pendente") return "pending"
  if (event === "pagamento_falhou") return "failed"
  return null
}

/**
 * Grava o pagamento via a função record_payment (veja o porquê em
 * supabase/migrations/0001_init.sql): ela cria o lead se preciso e nunca
 * rebaixa um pagamento já aprovado, tudo num comando atômico.
 */
export async function recordPayment(record: PaymentRecord): Promise<void> {
  const { error } = await getSupabase().rpc("record_payment", {
    p_lead_id: record.leadId,
    p_name: record.name,
    p_email: record.email,
    p_phone: record.phone,
    p_stripe_session_id: record.stripeSessionId,
    p_stripe_payment_intent: record.stripePaymentIntent,
    p_status: record.status,
    p_amount_cents: record.amountCents,
    p_currency: record.currency,
  })

  if (error) {
    throw new Error(`Supabase recordPayment falhou: ${error.message}`)
  }
}
