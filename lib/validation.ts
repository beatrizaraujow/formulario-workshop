import { z } from "zod"

/**
 * Campos de rastreamento (UTMs, fbclid, referrer, landing URL).
 *
 * Regra central: rastreamento NUNCA reprova a requisição. Ele é um detalhe de
 * atribuição — quem está pagando não pode ser barrado porque a Meta colou um
 * fbclid de 212 caracteres na URL. Valor ausente, longo demais ou de tipo
 * errado vira "" (ou é cortado) e a requisição segue.
 *
 * Foi exatamente isso que quebrou o checkout: um `.max(300)` no landingUrl
 * derrubava o body inteiro no Zod, e a rota respondia 400 antes de falar com
 * o Stripe.
 *
 * `z.unknown()` em vez de `z.string()` de propósito: assim null, número ou
 * objeto não geram issue, são normalizados.
 *
 * O `.optional()` NÃO é decorativo: no Zod v4 um `z.unknown()` solto dentro de
 * um object REPROVA quando a chave não vem ("expected nonoptional, received
 * undefined"). Sem ele, omitir um utm_term derrubaria o checkout inteiro —
 * de novo.
 */
const tracking = (max: number) =>
  z.unknown().optional().transform((value) => {
    if (typeof value === "string") return value.trim().slice(0, max)
    // utm_id e fbclid são identificadores OPACOS, nunca números. Se algum
    // cliente mandar 120255825436830002 como número JSON, vira string aqui —
    // Number()/parseInt() estourariam a precisão de 64 bits e corromperiam o id.
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value).slice(0, max)
    }
    return ""
  })

// Limites generosos e só para conter abuso: cortam o valor, não rejeitam.
// URLs precisam de folga porque fbclid + UTMs juntos passam fácil de 500 chars.
const TRACKING_MAX = 300
const ID_MAX = 100
const FBCLID_MAX = 512
const URL_MAX = 2000

const attributionFields = {
  // leadId é o nosso id interno e continua estrito: é a chave primária do lead
  // no banco e o client_reference_id no Stripe. Sem ele não há o que gravar.
  leadId: z.string().trim().min(1).max(ID_MAX),
  utmSource: tracking(TRACKING_MAX),
  utmMedium: tracking(TRACKING_MAX),
  utmCampaign: tracking(TRACKING_MAX),
  utmTerm: tracking(TRACKING_MAX),
  utmContent: tracking(TRACKING_MAX),
  // utm_id: id numérico da campanha na Meta, tratado como texto de ponta a ponta.
  utmId: tracking(ID_MAX),
  // fbclid: click id da Meta. Longo (200+ chars) e essencial para a atribuição
  // — por isso não é removido da URL, só precisa não quebrar nada.
  fbclid: tracking(FBCLID_MAX),
  referrer: tracking(URL_MAX),
  landingUrl: tracking(URL_MAX),
  // honeypot: campo invisível no formulário. Se vier preenchido, é bot.
  honeypot: z.string().optional().default(""),
}

// Usado quando alguém só chega na página (ainda não preencheu nada).
export const visitSchema = z.object(attributionFields)

// Usado nas etapas que já têm nome/e-mail/telefone (lead e checkout).
export const contactSchema = z.object({
  ...attributionFields,
  name: z.string().trim().min(3, "Nome muito curto").max(200),
  email: z.email("E-mail inválido").trim().max(200),
  phone: z
    .string()
    .trim()
    .min(8, "Telefone inválido")
    .max(30),
})

export type VisitInput = z.infer<typeof visitSchema>
export type ContactInput = z.infer<typeof contactSchema>
