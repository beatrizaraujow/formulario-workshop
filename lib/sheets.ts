/**
 * Grava linhas na planilha via um Google Apps Script Web App (função doPost
 * em `google-apps-script/Code.gs`, colada direto no editor de Apps Script da
 * própria planilha — sem Google Cloud Console, sem service account).
 *
 * Layout de colunas da aba (deixe essa ordem no cabeçalho da planilha):
 * A: Timestamp | B: Evento | C: Lead ID | D: Nome | E: Email | F: Telefone
 * G: Valor (R$) | H: UTM Source | I: UTM Medium | J: UTM Campaign
 * K: UTM Term | L: UTM Content | M: Referrer | N: Landing Page
 * O: Stripe Session ID | P: Stripe Payment Intent
 */
export type SheetRow = {
  event:
    | "visita_pagina"
    | "lead_criado"
    | "checkout_iniciado"
    // Pix é assíncrono: fica "pendente" enquanto o cliente não compensa o QR Code.
    | "pagamento_pendente"
    | "pagamento_aprovado"
    | "pagamento_falhou"
  leadId: string
  name: string
  email: string
  phone: string
  amount?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  referrer?: string
  landingUrl?: string
  stripeSessionId?: string
  stripePaymentIntent?: string
}

export async function appendSheetRow(row: SheetRow): Promise<void> {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  if (!webhookUrl) {
    throw new Error("GOOGLE_SHEETS_WEBHOOK_URL não configurado.")
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "follow",
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      event: row.event,
      leadId: row.leadId,
      name: row.name,
      email: row.email,
      phone: row.phone,
      amount: row.amount ?? "",
      utmSource: row.utmSource ?? "",
      utmMedium: row.utmMedium ?? "",
      utmCampaign: row.utmCampaign ?? "",
      utmTerm: row.utmTerm ?? "",
      utmContent: row.utmContent ?? "",
      referrer: row.referrer ?? "",
      landingUrl: row.landingUrl ?? "",
      stripeSessionId: row.stripeSessionId ?? "",
      stripePaymentIntent: row.stripePaymentIntent ?? "",
    }),
  })

  if (!response.ok) {
    throw new Error(`Apps Script respondeu ${response.status}: ${await response.text()}`)
  }
}
