import { z } from "zod"

const trimmedOptional = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((value) => value ?? "")

const attributionFields = {
  leadId: z.string().trim().min(1).max(100),
  utmSource: trimmedOptional,
  utmMedium: trimmedOptional,
  utmCampaign: trimmedOptional,
  utmTerm: trimmedOptional,
  utmContent: trimmedOptional,
  referrer: trimmedOptional,
  landingUrl: trimmedOptional,
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
