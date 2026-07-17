import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type Stripe from "stripe"
import { FBCLID, LANDING_URL, UTM_ID, metaClickBody } from "./fixtures"

// A sessão fake que o Stripe "devolve". O teste nunca fala com a rede.
// O tipo do parâmetro é o que dá acesso tipado a client_reference_id e
// metadata em mock.calls — é neles que quase todo teste aqui olha.
const createSession =
  vi.fn<(params: Stripe.Checkout.SessionCreateParams) => Promise<{ client_secret: string }>>(
    async () => ({ client_secret: "cs_test_secret_123" })
  )

vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({ checkout: { sessions: { create: createSession } } }),
}))

const { POST } = await import("@/app/api/checkout/route")

const postCheckout = (body: unknown) =>
  POST(
    new Request("https://api.exemplo.com/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )

// O que a rota passou pro Stripe na última chamada.
const lastSessionParams = (): Stripe.Checkout.SessionCreateParams => {
  const call = createSession.mock.calls.at(-1)
  if (!call) throw new Error("A rota não chegou a chamar checkout.sessions.create")
  return call[0]
}

beforeEach(() => {
  createSession.mockClear()
  vi.stubEnv("STRIPE_SUCCESS_URL", "https://carbone.com.br/obrigado")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("POST /api/checkout", () => {
  it("cria a sessão quando o clique traz utm_id e fbclid", async () => {
    const response = await postCheckout(metaClickBody)

    // O bug em uma linha: isto respondia 400 e o pagamento nunca abria.
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      clientSecret: "cs_test_secret_123",
    })
    expect(createSession).toHaveBeenCalledOnce()
  })

  it("cria a sessão com utm_id sozinho", async () => {
    const response = await postCheckout({
      ...metaClickBody,
      fbclid: "",
      landingUrl: `https://carbone.com.br/workshop?utm_id=${UTM_ID}`,
    })

    expect(response.status).toBe(200)
    expect(lastSessionParams().metadata?.utmId).toBe(UTM_ID)
  })

  it("cria a sessão com fbclid sozinho", async () => {
    const response = await postCheckout({
      ...metaClickBody,
      utmId: "",
      landingUrl: `https://carbone.com.br/workshop?fbclid=${FBCLID}`,
    })

    expect(response.status).toBe(200)
    expect(lastSessionParams().metadata?.fbclid).toBe(FBCLID)
  })

  it("usa o id interno do lead como client_reference_id", async () => {
    await postCheckout(metaClickBody)

    const params = lastSessionParams()

    expect(params.client_reference_id).toBe(metaClickBody.leadId)
    // O que NÃO pode estar ali: dado de terceiro no lugar da nossa chave.
    expect(params.client_reference_id).not.toBe(UTM_ID)
    expect(params.client_reference_id).not.toBe(FBCLID)
    expect(params.client_reference_id).not.toContain("utm_")
    expect(params.client_reference_id).not.toContain("http")
  })

  it("manda utm_id e fbclid como chaves separadas de string na metadata", async () => {
    await postCheckout(metaClickBody)

    const metadata = lastSessionParams().metadata ?? {}

    expect(metadata.utmId).toBe(UTM_ID)
    expect(metadata.fbclid).toBe(FBCLID)
    expect(typeof metadata.utmId).toBe("string")
    expect(typeof metadata.fbclid).toBe("string")
    // Separados de propósito: nada de um blob concatenado nem a URL inteira.
    expect(metadata.utmId).not.toContain(FBCLID)
    expect(Object.values(metadata)).not.toContain(LANDING_URL)
  })

  it("respeita o limite de 500 chars por valor de metadata do Stripe", async () => {
    await postCheckout({ ...metaClickBody, fbclid: "z".repeat(5000) })

    const metadata = lastSessionParams().metadata ?? {}

    for (const value of Object.values(metadata)) {
      expect(String(value).length).toBeLessThanOrEqual(500)
    }
  })

  it("não deixa rastreamento estranho impedir o pagamento", async () => {
    const response = await postCheckout({
      ...metaClickBody,
      utmId: null,
      fbclid: { valor: "inesperado" },
      utmSource: 12345,
      landingUrl: "x".repeat(9000),
    })

    // Rastreamento é secundário; a venda não pode cair junto com ele.
    expect(response.status).toBe(200)
    expect(createSession).toHaveBeenCalledOnce()
  })

  it("loga o erro real do Stripe em vez de engolir", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const { default: Stripe } = await import("stripe")

    createSession.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "parameter_invalid_string_empty",
        param: "metadata[fbclid]",
        message: "Metadata values can have up to 500 characters.",
      })
    )

    const response = await postCheckout(metaClickBody)

    expect(response.status).toBe(502)
    // O visitante vê a mensagem genérica...
    await expect(response.json()).resolves.toMatchObject({ ok: false })

    // ...mas o log tem o motivo, que é o que faltava pra debugar.
    const [, detalhe] = logged.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(detalhe).toMatchObject({
      // A Stripe carimba o type com o nome da classe do erro, não com o
      // "invalid_request_error" que vem no corpo da resposta.
      type: "StripeInvalidRequestError",
      code: "parameter_invalid_string_empty",
      param: "metadata[fbclid]",
      message: "Metadata values can have up to 500 characters.",
    })
  })
})
