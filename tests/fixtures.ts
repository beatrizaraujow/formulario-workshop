/**
 * Os valores REAIS que derrubaram o checkout em produção.
 *
 * Não "melhore" nem encurte: são o caso de teste. O fbclid tem 212 caracteres
 * — sozinho já estoura qualquer limite pensado para um UTM comum, e foi
 * exatamente assim que o `.max(300)` do landingUrl passou despercebido.
 */
export const UTM_ID = "120255825436830002"

export const FBCLID =
  "PAdGRleATHBHZwZG9mAmZkaWQWUKvtMX7ZUruWBDAXnH7vr08rKhxyQGV4dG4DYWVtATAAYWRpZAGrPAooCS6Cc3J0YwZhcHBfaWQPMTI0MDI0NTc0Mjg3NDE0AAGnp-sZQwcMtCSvoaG-Gy1yGnDSCcAJM07dgoxyMp3XtZ08DKyNMi04-pegkQ4_aem_v5cdWuvz0AJ6SIwtA5tRPA"

/**
 * A URL como a Meta realmente entrega: UTMs completas + utm_id + fbclid.
 *
 * 365 caracteres — é ESTA combinação que estourava o `.max(300)` do landingUrl
 * e derrubava o body inteiro no Zod. Medido, não estimado: só o fbclid (251)
 * ainda cabia em 300, por isso o limite passou tanto tempo despercebido.
 */
export const LANDING_URL =
  `https://www.carbone.com.br/workshop` +
  `?utm_source=meta&utm_medium=paid&utm_campaign=workshop-julho&utm_content=criativo-01` +
  `&utm_id=${UTM_ID}&fbclid=${FBCLID}`

/**
 * A URL REAL do anúncio, reportada pelo cliente em produção. 528 caracteres.
 *
 * Repare no `Ç` cru em "OPÇOES": a Meta não fez o encoding. O navegador
 * conserta sozinho ao carregar a página (vira %C3%87), então o que o
 * formulário lê de window.location.href é a versão codificada, mais longa
 * ainda. Também tem `+` como espaço, `/` no utm_term e um `#inscricao` no fim.
 */
export const REAL_META_URL =
  `https://carboneeducacao.com.br/carbone-workshop` +
  `?utm_source=meta&utm_medium=paid_social` +
  `&utm_campaign=007+%5BLEADS%5D+%5BLP%5D+%5BFRIO%5D+%5BWORKSHOP%5D` +
  `&utm_content=%5BAD024%5D+%5BVID%5D+%5BWORKSHOP%5D+%5BVOCE+TEM+DUAS+OPÇOES%5D` +
  `&utm_term=02+%5BWK%5D+%5BABERTO%5D.HM.30/60.RN` +
  `&utm_id=${UTM_ID}` +
  `&fbclid=PAdGRleATHEopwZG9mAmZkaWQWUKshzjijFOF0naNNNTKVRu5TDWWNOmV4dG4DYWVtATAAYWRpZAGrPAooMZ4Sc3J0YwZhcHBfaWQPMTI0MDI0NTc0Mjg3NDE0AAGn4WXxd9gjw1mlgKo_sJDjP7t-xlLzfm5JKAV21qdHCP3fCmzBeuTH2S56W9E_aem_9cpAIuPpFVPWqV_um-9bNw` +
  `#inscricao`

/** O body que o formulário monta a partir da URL real acima. */
export const realMetaBody = {
  leadId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  name: "Maria Silva",
  email: "maria@exemplo.com.br",
  phone: "(11) 9 8888-7777",
  utmSource: "meta",
  utmMedium: "paid_social",
  utmCampaign: "007 [LEADS] [LP] [FRIO] [WORKSHOP]",
  utmContent: "[AD024] [VID] [WORKSHOP] [VOCE TEM DUAS OPÇOES]",
  utmTerm: "02 [WK] [ABERTO].HM.30/60.RN",
  utmId: UTM_ID,
  fbclid:
    "PAdGRleATHEopwZG9mAmZkaWQWUKshzjijFOF0naNNNTKVRu5TDWWNOmV4dG4DYWVtATAAYWRpZAGrPAooMZ4Sc3J0YwZhcHBfaWQPMTI0MDI0NTc0Mjg3NDE0AAGn4WXxd9gjw1mlgKo_sJDjP7t-xlLzfm5JKAV21qdHCP3fCmzBeuTH2S56W9E_aem_9cpAIuPpFVPWqV_um-9bNw",
  referrer: "https://l.facebook.com/",
  landingUrl: REAL_META_URL,
  honeypot: "",
}

/** Um lead válido chegando por um anúncio da Meta, com os dois parâmetros. */
export const metaClickBody = {
  leadId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  name: "Maria Silva",
  email: "maria@exemplo.com.br",
  phone: "(11) 9 8888-7777",
  utmSource: "meta",
  utmMedium: "paid",
  utmCampaign: "workshop-julho",
  utmTerm: "",
  utmContent: "",
  utmId: UTM_ID,
  fbclid: FBCLID,
  referrer: "https://l.facebook.com/",
  landingUrl: LANDING_URL,
  honeypot: "",
}
