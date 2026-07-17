/**
 * Ponto único de gravação dos eventos do funil (visita, lead, pagamento).
 *
 * Cada evento vai para DOIS destinos, em paralelo e de forma independente:
 *   Supabase — fonte de verdade, é o que as queries e relatórios leem
 *   Planilha — cópia para consulta no dia a dia
 *
 * Os destinos não se derrubam: usar Promise.allSettled (e não Promise.all)
 * significa que a planilha fora do ar não impede a gravação do pagamento no
 * banco. Nenhuma função aqui lança erro — uma falha de registro nunca pode
 * quebrar o checkout de quem está comprando. As falhas viram log.
 */
import { appendSheetRow, type SheetRow } from "@/lib/sheets"
import {
  recordPayment,
  statusFromSheetEvent,
  upsertLead,
  type LeadRecord,
} from "@/lib/supabase"

type Target = { name: string; run: () => Promise<void> }

async function fanOut(event: string, targets: Target[]): Promise<void> {
  const active = targets.filter((target) => target.name !== "supabase" || isSupabaseConfigured())
  const results = await Promise.allSettled(active.map((target) => target.run()))

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`[${event}] destino "${active[index].name}" falhou:`, result.reason)
    }
  })
}

// Evita encher o log de erro em ambiente onde o Supabase ainda não foi
// configurado (ex: rodando local só para mexer no formulário).
function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export type VisitInput = Omit<LeadRecord, "name" | "email" | "phone">

/** Alguém abriu a página (primeiro toque). Só temos a atribuição, ainda não a pessoa. */
export async function saveVisit(input: VisitInput): Promise<void> {
  await fanOut("visita_pagina", [
    { name: "supabase", run: () => upsertLead(input) },
    {
      name: "planilha",
      run: () =>
        appendSheetRow({
          event: "visita_pagina",
          leadId: input.leadId,
          name: "",
          email: "",
          phone: "",
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          utmTerm: input.utmTerm,
          utmContent: input.utmContent,
          utmId: input.utmId,
          fbclid: input.fbclid,
          referrer: input.referrer,
          landingUrl: input.landingUrl,
        }),
    },
  ])
}

export type LeadInput = LeadRecord & { name: string; email: string; phone: string }

/** A pessoa preencheu nome/e-mail/telefone e avançou para o pagamento. */
export async function saveLead(input: LeadInput): Promise<void> {
  await fanOut("lead_criado", [
    { name: "supabase", run: () => upsertLead(input) },
    {
      name: "planilha",
      run: () =>
        appendSheetRow({
          event: "lead_criado",
          leadId: input.leadId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          utmTerm: input.utmTerm,
          utmContent: input.utmContent,
          utmId: input.utmId,
          fbclid: input.fbclid,
          referrer: input.referrer,
          landingUrl: input.landingUrl,
        }),
    },
  ])
}

export type PaymentInput = {
  event: Extract<
    SheetRow["event"],
    "pagamento_pendente" | "pagamento_aprovado" | "pagamento_falhou"
  >
  leadId: string
  name: string
  email: string
  phone: string
  amountCents: number | null
  currency: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string
  utmContent: string
  utmId: string
  fbclid: string
  stripeSessionId: string
  stripePaymentIntent: string
}

/** O Stripe avisou que um pagamento mudou de estado. */
export async function savePayment(input: PaymentInput): Promise<void> {
  const status = statusFromSheetEvent(input.event)

  await fanOut(input.event, [
    {
      name: "supabase",
      run: async () => {
        if (!status) return
        await recordPayment({
          leadId: input.leadId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          stripeSessionId: input.stripeSessionId,
          stripePaymentIntent: input.stripePaymentIntent,
          status,
          amountCents: input.amountCents,
          currency: input.currency,
        })
      },
    },
    {
      name: "planilha",
      run: () =>
        appendSheetRow({
          event: input.event,
          leadId: input.leadId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          // A planilha mostra reais para leitura humana; o banco guarda centavos.
          amount: input.amountCents === null ? "" : (input.amountCents / 100).toFixed(2),
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          utmTerm: input.utmTerm,
          utmContent: input.utmContent,
          utmId: input.utmId,
          fbclid: input.fbclid,
          stripeSessionId: input.stripeSessionId,
          stripePaymentIntent: input.stripePaymentIntent,
        }),
    },
  ])
}
