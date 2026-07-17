import { describe, expect, it } from "vitest"
import { contactSchema, visitSchema } from "@/lib/validation"
import { FBCLID, LANDING_URL, UTM_ID, metaClickBody } from "./fixtures"

describe("contactSchema", () => {
  it("aceita o clique da Meta com utm_id e fbclid juntos", () => {
    const parsed = contactSchema.safeParse(metaClickBody)

    // Este é o teste que teria pego o bug: antes, o landingUrl com fbclid
    // passava de 300 chars e reprovava o body inteiro -> 400 no checkout.
    expect(parsed.success).toBe(true)
  })

  it("preserva utm_id dígito por dígito, como texto", () => {
    const data = contactSchema.parse(metaClickBody)

    expect(data.utmId).toBe(UTM_ID)
    expect(typeof data.utmId).toBe("string")
    // Number() arredondaria pra 120255825436830000: id parecido, campanha errada.
    expect(data.utmId).not.toBe(String(Number(UTM_ID)))
  })

  it("preserva o fbclid de 212 caracteres inteiro", () => {
    const data = contactSchema.parse(metaClickBody)

    expect(data.fbclid).toBe(FBCLID)
    expect(data.fbclid).toHaveLength(212)
  })

  it("preserva a landing URL com fbclid, sem cortar", () => {
    const data = contactSchema.parse(metaClickBody)

    expect(data.landingUrl).toBe(LANDING_URL)
    expect(data.landingUrl.length).toBeGreaterThan(300)
  })

  it("aceita cada parâmetro sozinho, isolado", () => {
    // Espelha os testes manuais: utm_id sozinho e fbclid sozinho, que falhavam.
    const soUtmId = contactSchema.safeParse({
      ...metaClickBody,
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      fbclid: "",
      landingUrl: `https://carbone.com.br/workshop?utm_id=${UTM_ID}`,
    })
    const soFbclid = contactSchema.safeParse({
      ...metaClickBody,
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmId: "",
      landingUrl: `https://carbone.com.br/workshop?fbclid=${FBCLID}`,
    })

    expect(soUtmId.success).toBe(true)
    expect(soFbclid.success).toBe(true)
  })

  it("converte utm_id numérico em string em vez de reprovar", () => {
    // Um cliente que mande utm_id como número JSON não pode derrubar o checkout.
    const data = contactSchema.parse({ ...metaClickBody, utmId: 120255825436830002 })

    expect(typeof data.utmId).toBe("string")
  })

  it("nunca reprova por causa de rastreamento — corta e segue", () => {
    const data = contactSchema.parse({
      ...metaClickBody,
      // Lixo de todo tipo nos campos de rastreamento.
      utmSource: null,
      utmMedium: { objeto: "estranho" },
      utmCampaign: ["a", "b"],
      fbclid: "x".repeat(5000),
      landingUrl: `https://carbone.com.br/?q=${"y".repeat(9000)}`,
    })

    expect(data.utmSource).toBe("")
    expect(data.utmMedium).toBe("")
    expect(data.utmCampaign).toBe("")
    expect(data.fbclid).toHaveLength(512)
    expect(data.landingUrl).toHaveLength(2000)
  })

  it("aceita body sem nenhum campo de rastreamento", () => {
    // Regressão: no Zod v4 um z.unknown() sem .optional() reprova a chave
    // AUSENTE. Um utm_term omitido chegava a derrubar o checkout inteiro.
    const parsed = contactSchema.safeParse({
      leadId: metaClickBody.leadId,
      name: metaClickBody.name,
      email: metaClickBody.email,
      phone: metaClickBody.phone,
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.utmId).toBe("")
    expect(parsed.data?.fbclid).toBe("")
  })

  it("continua reprovando dados da pessoa que estão errados", () => {
    // Tolerância vale só pro rastreamento: e-mail inválido ainda é 400.
    const parsed = contactSchema.safeParse({ ...metaClickBody, email: "não-é-email" })

    expect(parsed.success).toBe(false)
  })
})

describe("visitSchema", () => {
  it("aceita a visita vinda de um anúncio com fbclid", () => {
    const parsed = visitSchema.safeParse({
      leadId: metaClickBody.leadId,
      utmId: UTM_ID,
      fbclid: FBCLID,
      landingUrl: LANDING_URL,
    })

    expect(parsed.success).toBe(true)
  })
})
