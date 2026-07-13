import { google, sheets_v4 } from "googleapis"

let cachedClient: sheets_v4.Sheets | null = null

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient

  const email = process.env.GOOGLE_CLIENT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n")

  if (!email || !privateKey) {
    throw new Error(
      "Credenciais do Google não configuradas (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY)."
    )
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })

  cachedClient = google.sheets({ version: "v4", auth })
  return cachedClient
}

const SHEET_TAB = process.env.GOOGLE_SHEET_TAB ?? "Respostas"

/**
 * Layout de colunas da aba (deixe essa ordem no cabeçalho da planilha):
 * A: Timestamp | B: Evento | C: Lead ID | D: Nome | E: Email | F: Telefone
 * G: Valor (R$) | H: UTM Source | I: UTM Medium | J: UTM Campaign
 * K: UTM Term | L: UTM Content | M: Referrer | N: Landing Page
 * O: Stripe Session ID | P: Stripe Payment Intent
 */
export type SheetRow = {
  event: "lead_criado" | "pagamento_aprovado"
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
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID não configurado.")
  }

  const sheets = getSheetsClient()

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_TAB}!A:A`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          new Date().toISOString(),
          row.event,
          row.leadId,
          row.name,
          row.email,
          row.phone,
          row.amount ?? "",
          row.utmSource ?? "",
          row.utmMedium ?? "",
          row.utmCampaign ?? "",
          row.utmTerm ?? "",
          row.utmContent ?? "",
          row.referrer ?? "",
          row.landingUrl ?? "",
          row.stripeSessionId ?? "",
          row.stripePaymentIntent ?? "",
        ],
      ],
    },
  })
}
