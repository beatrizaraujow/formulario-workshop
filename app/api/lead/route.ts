import { z } from "zod"
import { appendSheetRow } from "@/lib/sheets"
import { contactSchema } from "@/lib/validation"
import { handlePreflight, jsonResponse } from "@/lib/cors"

export async function OPTIONS(request: Request) {
  return handlePreflight(request)
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(request, { ok: false, error: "JSON inválido." }, { status: 400 })
  }

  const parsed = contactSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse(
      request,
      { ok: false, error: "Dados inválidos.", issues: z.flattenError(parsed.error) },
      { status: 400 }
    )
  }

  const data = parsed.data

  // Honeypot preenchido = bot. Responde ok sem gravar nada, sem avisar o bot.
  if (data.honeypot) {
    return jsonResponse(request, { ok: true })
  }

  try {
    await appendSheetRow({
      event: "lead_criado",
      leadId: data.leadId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
      utmTerm: data.utmTerm,
      utmContent: data.utmContent,
      referrer: data.referrer,
      landingUrl: data.landingUrl,
    })
  } catch (error) {
    // Não bloqueia a conversão do usuário por causa de um erro na planilha.
    console.error("Falha ao gravar lead na planilha:", error)
  }

  return jsonResponse(request, { ok: true })
}
