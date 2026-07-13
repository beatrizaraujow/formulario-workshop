import { z } from "zod"

const trimmedOptional = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((value) => value ?? "")

export const contactSchema = z.object({
  leadId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(3, "Nome muito curto").max(200),
  email: z.string().trim().email("E-mail inválido").max(200),
  phone: z
    .string()
    .trim()
    .min(8, "Telefone inválido")
    .max(30),
  utmSource: trimmedOptional,
  utmMedium: trimmedOptional,
  utmCampaign: trimmedOptional,
  utmTerm: trimmedOptional,
  utmContent: trimmedOptional,
  referrer: trimmedOptional,
  landingUrl: trimmedOptional,
  // honeypot: campo invisível no formulário. Se vier preenchido, é bot.
  honeypot: z.string().optional().default(""),
})

export type ContactInput = z.infer<typeof contactSchema>
