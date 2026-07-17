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
  // Colunas Q e R. Entraram no fim porque coluna nova no meio desalinha todas
  // as linhas já gravadas.
  "UTM ID",
  "fbclid",
]

// Coluna Q (17) e R (18): as duas que guardam id opaco.
var TEXT_COLUMN_START = 17
var TEXT_COLUMN_COUNT = 2

function getSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME)
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS)
  } else if (sheet.getLastColumn() < HEADERS.length) {
    // Planilha criada antes de UTM ID/fbclid existirem: completa o cabeçalho
    // sem tocar nas linhas de dados.
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
  }

  // Formatar a coluna inteira como texto simples ANTES de escrever é o que
  // impede o Sheets de "ajudar" e transformar o utm_id de 18 dígitos em
  // notação científica, perdendo os dígitos finais para sempre.
  sheet
    .getRange(1, TEXT_COLUMN_START, sheet.getMaxRows(), TEXT_COLUMN_COUNT)
    .setNumberFormat("@")

  return sheet
}

function doPost(e) {
  var sheet = getSheet_()
  var data = JSON.parse(e.postData.contents)

  // String(...) explícito: o utm_id chega como texto do /api e tem que
  // continuar texto aqui.
  var utmId = data.utmId ? String(data.utmId) : ""
  var fbclid = data.fbclid ? String(data.fbclid) : ""

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
    utmId,
    fbclid,
  ])

  // Cinto e suspensório: reescreve as duas células já com o formato de texto
  // aplicado. Se alguém desfizer a formatação da coluna na mão, o valor ainda
  // entra íntegro em vez de virar 1,20256E+17.
  var row = sheet.getLastRow()
  sheet
    .getRange(row, TEXT_COLUMN_START, 1, TEXT_COLUMN_COUNT)
    .setNumberFormat("@")
    .setValues([[utmId, fbclid]])

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
