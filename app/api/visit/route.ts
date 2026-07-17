import { z } from "zod"
import { saveVisit } from "@/lib/store"
import { visitSchema } from "@/lib/validation"
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

  const parsed = visitSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse(
      request,
      { ok: false, error: "Dados inválidos.", issues: z.flattenError(parsed.error) },
      { status: 400 }
    )
  }

  const data = parsed.data

  if (data.honeypot) {
    return jsonResponse(request, { ok: true })
  }

  // saveVisit não lança: uma falha de registro vira log e não atrapalha a visita.
  await saveVisit({
    leadId: data.leadId,
    utmSource: data.utmSource,
    utmMedium: data.utmMedium,
    utmCampaign: data.utmCampaign,
    utmTerm: data.utmTerm,
    utmContent: data.utmContent,
    utmId: data.utmId,
    fbclid: data.fbclid,
    referrer: data.referrer,
    landingUrl: data.landingUrl,
  })

  return jsonResponse(request, { ok: true })
}
