import { describe, expect, it } from "vitest"
import { contactSchema } from "@/lib/validation"
import { REAL_META_URL, realMetaBody } from "./fixtures"

/**
 * A URL REAL do anúncio em produção, reportada pelo cliente. 528 caracteres.
 *
 * Vale mais que qualquer caso inventado: tem um `Ç` sem encoding, `+` como
 * espaço, `/` dentro do utm_term, colchetes por toda parte e um `#inscricao`
 * no fim. É a URL que a Meta realmente entrega.
 */
describe("URL real do anúncio (528 chars)", () => {
  it("passa pela validação inteira, sem reprovar", () => {
    const result = contactSchema.safeParse(realMetaBody)

    // Se falhar, mostra QUAL campo — erro de Zod genérico não ajuda ninguém.
    expect(result.error?.issues ?? []).toEqual([])
    expect(result.success).toBe(true)
  })

  it("preserva a landing URL de 528 chars sem cortar", () => {
    const parsed = contactSchema.parse(realMetaBody)

    expect(parsed.landingUrl).toBe(REAL_META_URL)
    expect(parsed.landingUrl.length).toBe(528)
  })

  it("preserva o utm_id dígito por dígito", () => {
    const parsed = contactSchema.parse(realMetaBody)

    expect(parsed.utmId).toBe("120255825436830002")
  })

  it("preserva o fbclid de 212 chars inteiro", () => {
    const parsed = contactSchema.parse(realMetaBody)

    expect(parsed.fbclid).toBe(realMetaBody.fbclid)
    expect(parsed.fbclid.length).toBe(212)
  })

  it("preserva acento e colchetes do utm_content", () => {
    const parsed = contactSchema.parse(realMetaBody)

    expect(parsed.utmContent).toBe("[AD024] [VID] [WORKSHOP] [VOCE TEM DUAS OPÇOES]")
  })
})
