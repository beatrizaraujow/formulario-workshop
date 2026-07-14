// ══════════════════════════════════════════════════════════════════════
// Cole este arquivo inteiro em Extensões > Apps Script, dentro da própria
// planilha do Google Sheets. Não precisa de Google Cloud Console, service
// account nem nada disso — o script roda com as permissões do dono da
// planilha. Depois é só publicar como Web App (veja o README).
// ══════════════════════════════════════════════════════════════════════

var SHEET_NAME = "Respostas"

var HEADERS = [
  "Timestamp",
  "Evento",
  "Lead ID",
  "Nome",
  "Email",
  "Telefone",
  "Valor (R$)",
  "UTM Source",
  "UTM Medium",
  "UTM Campaign",
  "UTM Term",
  "UTM Content",
  "Referrer",
  "Landing Page",
  "Stripe Session ID",
  "Stripe Payment Intent",
]

function getSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME)
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS)
  }
  return sheet
}

function doPost(e) {
  var sheet = getSheet_()
  var data = JSON.parse(e.postData.contents)

  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.event || "",
    data.leadId || "",
    data.name || "",
    data.email || "",
    data.phone || "",
    data.amount || "",
    data.utmSource || "",
    data.utmMedium || "",
    data.utmCampaign || "",
    data.utmTerm || "",
    data.utmContent || "",
    data.referrer || "",
    data.landingUrl || "",
    data.stripeSessionId || "",
    data.stripePaymentIntent || "",
  ])

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
    ContentService.MimeType.JSON
  )
}

// Só pra conseguir abrir a URL no navegador e confirmar que o deploy funcionou.
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, message: "Endpoint ativo. Use POST para gravar linhas." })
  ).setMimeType(ContentService.MimeType.JSON)
}
