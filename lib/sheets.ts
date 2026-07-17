/**
* Grava linhas na planilha via um Google Apps Script Web App (funcao doPost
* em `google-apps-script/Code.gs`, colada direto no editor de Apps Script da
* propria planilha - sem Google Cloud Console, sem service account).
*
* Layout de colunas da aba (deixe essa ordem no cabecalho da planilha):
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
  // Pix e assincrono: fica "pendente" enquanto o cliente nao compensa o QR Code.
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

const MAX_ATTEMPTS = 3

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A planilha usa um lock (LockService) no Apps Script pra evitar corrida entre
// gravacoes simultaneas - por exemplo lead_criado e checkout_iniciado chegando
// quase ao mesmo tempo. Quando isso acontece, o Apps Script pode responder que
// esta ocupado; tentamos de novo em vez de simplesmente perder a linha.
export async function appendSheetRow(row: SheetRow): Promise<void> {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  if (!webhookUrl) {
    throw new Error("GOOGLE_SHEETS_WEBHOOK_URL nao configurado.")
  }

const payload = JSON.stringify({
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
})

let lastError: unknown = null

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: payload,
    })

  if (response.ok) {
    const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!result || result.ok !== false) return
    lastError = new Error(result.error ?? "Apps Script retornou ok: false")
  } else {
    lastError = new Error(`Apps Script respondeu ${response.status}: ${await response.text()}`)
  }
  } catch (err) {
    lastError = err
  }

  if (attempt < MAX_ATTEMPTS) {
    await wait(attempt * 700)
  }
}

throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
