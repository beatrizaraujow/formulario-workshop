import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { appendSheetRow } from "@/lib/sheets"
import { FBCLID, UTM_ID } from "./fixtures"

/**
 * A planilha é o destino em uso enquanto o Supabase não é aplicado, então
 * utm_id e fbclid precisam chegar nela íntegros — e como TEXTO.
 *
 * O risco aqui não é o Zod, é a aritmética: utm_id tem 18 dígitos e passa de
 * 2^53, então qualquer Number() no caminho devolve outro id, parecido o
 * bastante para ninguém notar até a atribuição da Meta não bater.
 */
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))

// O corpo JSON que o lib/sheets mandou pro Apps Script na última chamada.
const lastPayload = (): Record<string, unknown> => {
  const call = fetchMock.mock.calls.at(-1) as unknown as [string, { body: string }] | undefined
  if (!call) throw new Error("appendSheetRow não chegou a chamar o Apps Script")
  return JSON.parse(call[1].body)
}

const trackingRow = {
  event: "lead_criado",
  leadId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  name: "Maria Silva",
  email: "maria@exemplo.com.br",
  phone: "(11) 9 8888-7777",
  utmId: UTM_ID,
  fbclid: FBCLID,
} as const

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("GOOGLE_SHEETS_WEBHOOK_URL", "https://script.google.com/macros/s/fake/exec")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("appendSheetRow com utm_id e fbclid da Meta", () => {
  it("manda o utm_id como string, dígito por dígito", async () => {
    await appendSheetRow(trackingRow)

    const utmId = lastPayload().utmId
    expect(utmId).toBe(UTM_ID)
    expect(typeof utmId).toBe("string")
  })

  it("não arredonda o utm_id (o que Number() faria em silêncio)", async () => {
    await appendSheetRow(trackingRow)

    // Prova de que o perigo é real: o mesmo id como número volta diferente.
    expect(String(Number(UTM_ID))).not.toBe(UTM_ID)
    expect(lastPayload().utmId).toBe("120255825436830002")
  })

  it("manda o fbclid de 212 caracteres inteiro, sem cortar", async () => {
    await appendSheetRow(trackingRow)

    const fbclid = lastPayload().fbclid
    expect(fbclid).toBe(FBCLID)
    expect(String(fbclid)).toHaveLength(FBCLID.length)
  })

  it("manda string vazia, e não undefined, quando não veio rastreamento", async () => {
    await appendSheetRow({
      event: "visita_pagina",
      leadId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
      name: "",
      email: "",
      phone: "",
    })

    const payload = lastPayload()
    expect(payload.utmId).toBe("")
    expect(payload.fbclid).toBe("")
    // undefined sumiria do JSON e o Apps Script gravaria a coluna desalinhada.
    expect(payload).toHaveProperty("utmId")
    expect(payload).toHaveProperty("fbclid")
  })
})
