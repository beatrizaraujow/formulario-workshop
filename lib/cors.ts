const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

/**
 * Sem ALLOWED_ORIGINS configurado, libera qualquer origem (útil em dev/preview).
 * Em produção, defina ALLOWED_ORIGINS no Vercel com o(s) domínio(s) do Framer.
 */
export function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }

  if (allowedOrigins.length === 0) {
    headers["Access-Control-Allow-Origin"] = "*"
    return headers
  }

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin
    headers["Vary"] = "Origin"
  }

  return headers
}

export function handlePreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  })
}

export function jsonResponse(
  request: Request,
  body: unknown,
  init: ResponseInit = {}
): Response {
  const headers = {
    ...corsHeaders(request.headers.get("origin")),
    "Content-Type": "application/json",
    ...init.headers,
  }
  return new Response(JSON.stringify(body), { ...init, headers })
}
