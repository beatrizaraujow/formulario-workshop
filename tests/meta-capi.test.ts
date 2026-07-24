import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { hashEmail, hashPhone } from "@/lib/meta-capi"

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex")

describe("hashEmail", () => {
  it("normaliza (trim + minúsculo) antes do SHA-256", () => {
    const expected = sha256("foo@bar.com")
    expect(hashEmail("  Foo@Bar.com ")).toBe(expected)
    expect(hashEmail("foo@bar.com")).toBe(expected)
  })

  it("devolve 64 chars hex minúsculo", () => {
    expect(hashEmail("a@b.com")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("vazio ou sem @ vira undefined (não manda hash de lixo)", () => {
    expect(hashEmail("")).toBeUndefined()
    expect(hashEmail(undefined)).toBeUndefined()
    expect(hashEmail("naoehemail")).toBeUndefined()
  })
})

describe("hashPhone", () => {
  it("11 dígitos ganham o código do país 55 antes do hash", () => {
    const expected = sha256("5511988887777")
    expect(hashPhone("(11) 9 8888-7777")).toBe(expected)
  })

  it("número que já vem com 55 não duplica o código", () => {
    const expected = sha256("5511988887777")
    expect(hashPhone("5511988887777")).toBe(expected)
    // mesmo telefone, formatos diferentes → mesmo hash
    expect(hashPhone("(11) 9 8888-7777")).toBe(hashPhone("+55 11 98888-7777"))
  })

  it("vazio vira undefined", () => {
    expect(hashPhone("")).toBeUndefined()
    expect(hashPhone(undefined)).toBeUndefined()
  })
})
