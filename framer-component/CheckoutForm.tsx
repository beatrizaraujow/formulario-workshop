// ══════════════════════════════════════════════════════════════════════
// Este arquivo é para ser COLADO no editor de código do Framer
// (Code Component). Ele não roda dentro deste projeto Next.js — o
// Next.js aqui é só o backend (/api/lead, /api/checkout, /api/webhook/stripe)
// publicado no Vercel. Depois do deploy, troque API_BASE_URL abaixo pela
// URL do seu projeto no Vercel.
// ══════════════════════════════════════════════════════════════════════
import React, { useEffect, useRef, useState } from "react"
import { loadStripe, type StripeEmbeddedCheckout } from "@stripe/stripe-js"

// URL do backend no Vercel. Se trocar de projeto, mude aqui e republique o site.
const API_BASE_URL = "https://formulario-workshop.vercel.app"

// Chave PUBLICÁVEL (pk_). É pública por design — pode viver no componente, que roda
// no navegador do visitante. NUNCA coloque aqui a chave secreta (sk_) nem a do
// webhook (whsec_).
//
// Está em modo LIVE, igual ao backend (que cria sessões cs_live_). Os dois PRECISAM
// estar no mesmo modo: a Stripe isola teste e produção, e o Stripe.js recusa uma
// sessão live vinda de chave de teste — o pagamento nem chega a abrir, o visitante
// só vê "Não foi possível abrir o pagamento agora". Se um dia voltar pra teste,
// troque a pk_ daqui e a sk_ do backend JUNTAS, nunca uma só.
const STRIPE_PUBLISHABLE_KEY =
    "pk_live_51TrfmfFBqnhDILMZytL4J32K1sD13V97D8wIVnbpFMwXgPmbohgfXT6PvsLvYQFUa61WviDkYG9NgwKlK7XAxFZJ00Ew0F1tZg"

// Fora do componente de propósito: carrega o Stripe.js uma vez só, não a cada render.
const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY)

interface FormData {
    name: string
    email: string
    phone: string
}

interface Attribution {
    leadId: string
    utmSource: string
    utmMedium: string
    utmCampaign: string
    utmTerm: string
    utmContent: string
    // Sempre string. Nunca Number()/parseInt(): utm_id tem 18 dígitos e como
    // number o JavaScript o arredonda em silêncio, virando outro id.
    utmId: string
    fbclid: string
    referrer: string
    landingUrl: string
}

const ATTRIBUTION_STORAGE_KEY = "cf_attribution"
// utm_id e fbclid entram aqui junto com os UTMs: um anúncio da Meta pode mandar
// só fbclid, e sem isso esse clique seria tratado como "sem toque novo" e
// herdaria a atribuição antiga do localStorage.
const UTM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "fbclid",
]

function createLeadId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID()
    }
    return `lead_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

// Todo campo de atribuição vira string, sempre — inclusive utm_id, que parece
// número mas é identificador.
const asText = (value: unknown): string =>
    typeof value === "string" ? value : ""

function normalize(stored: unknown): Attribution {
    const raw = (stored ?? {}) as Record<string, unknown>
    return {
        leadId: asText(raw.leadId) || createLeadId(),
        utmSource: asText(raw.utmSource),
        utmMedium: asText(raw.utmMedium),
        utmCampaign: asText(raw.utmCampaign),
        utmTerm: asText(raw.utmTerm),
        utmContent: asText(raw.utmContent),
        utmId: asText(raw.utmId),
        fbclid: asText(raw.fbclid),
        referrer: asText(raw.referrer),
        landingUrl: asText(raw.landingUrl),
    }
}

// Primeiro toque: guarda a origem (UTMs) no localStorage e reaproveita
// enquanto o visitante não chegar por um link com novos UTMs. "isNew"
// indica se é um toque novo (pra só contar 1 visita por pessoa/campanha,
// não uma a cada F5).
function readAttribution(): { attribution: Attribution; isNew: boolean } {
    const params = new URLSearchParams(window.location.search)
    const hasNewUtm = UTM_KEYS.some((key) => params.get(key))

    if (!hasNewUtm) {
        try {
            const stored = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY)
            if (stored) {
                return {
                    // JSON.parse não valida nada, e o que está gravado pode ter
                    // sido escrito por uma versão anterior do componente (sem
                    // utmId/fbclid). Normaliza pra não mandar undefined à API.
                    attribution: normalize(JSON.parse(stored)),
                    isNew: false,
                }
            }
        } catch {
            // localStorage indisponível (ex: preview no editor do Framer)
        }
    }

    const attribution: Attribution = {
        leadId: createLeadId(),
        utmSource: params.get("utm_source") ?? "",
        utmMedium: params.get("utm_medium") ?? "",
        utmCampaign: params.get("utm_campaign") ?? "",
        utmTerm: params.get("utm_term") ?? "",
        utmContent: params.get("utm_content") ?? "",
        // params.get() já devolve string: o valor entra e sai como texto puro.
        utmId: params.get("utm_id") ?? "",
        fbclid: params.get("fbclid") ?? "",
        referrer: document.referrer ?? "",
        landingUrl: window.location.href,
    }

    try {
        window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution))
    } catch {
        // segue sem cache se não puder gravar
    }

    return { attribution, isNew: true }
}

const formatPhone = (value: string): string => {
    const digits = value.replace(/\D/g, "").slice(0, 11)
    if (digits.length === 0) return ""
    if (digits.length <= 2) return `(${digits}`
    if (digits.length <= 3) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
    if (digits.length <= 7)
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3)}`
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`
}

export default function CheckoutForm() {
    const [step, setStep] = useState<1 | 2>(1)
    const [data, setData] = useState<FormData>({
        name: "",
        email: "",
        phone: "",
    })
    const [errors, setErrors] = useState<Partial<FormData>>({})
    const [attribution, setAttribution] = useState<Attribution | null>(null)
    const [honeypot, setHoneypot] = useState("")
    const [isCheckoutReady, setIsCheckoutReady] = useState(false)
    const [paymentError, setPaymentError] = useState<string | null>(null)
    // Incrementado pelo botão "Tentar novamente": muda a dependência do efeito e
    // força uma nova tentativa de montar o checkout.
    const [retryKey, setRetryKey] = useState(0)
    // Onde a Stripe injeta o formulário, e a instância viva (pra destruir depois).
    const checkoutRef = useRef<HTMLDivElement | null>(null)
    const embeddedRef = useRef<StripeEmbeddedCheckout | null>(null)

    useEffect(() => {
        // Lê URL/localStorage (indisponíveis durante SSR do site publicado no
        // Framer), por isso precisa ser em efeito e não em estado inicial.
        const { attribution: attr, isNew } = readAttribution()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAttribution(attr)

        if (!isNew || API_BASE_URL.includes("SEU-PROJETO")) return

        // Registra a visita (quem chegou e por onde) em segundo plano.
        // Só dispara no primeiro toque — um F5 na mesma sessão não conta de novo.
        fetch(`${API_BASE_URL}/api/visit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                leadId: attr.leadId,
                utmSource: attr.utmSource,
                utmMedium: attr.utmMedium,
                utmCampaign: attr.utmCampaign,
                utmTerm: attr.utmTerm,
                utmContent: attr.utmContent,
                utmId: attr.utmId,
                fbclid: attr.fbclid,
                referrer: attr.referrer,
                landingUrl: attr.landingUrl,
            }),
        }).catch((error) => {
            console.error("Falha ao registrar visita:", error)
        })
    }, [])

    const handleChange =
        (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
            setData({ ...data, [field]: e.target.value })
            if (errors[field]) setErrors({ ...errors, [field]: undefined })
        }

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setData({ ...data, phone: formatPhone(e.target.value) })
        if (errors.phone) setErrors({ ...errors, phone: undefined })
    }

    const validate = (): boolean => {
        const newErrors: Partial<FormData> = {}
        if (data.name.trim().length < 3)
            newErrors.name = "Digite seu nome completo"
        if (!/^\S+@\S+\.\S+$/.test(data.email))
            newErrors.email = "Digite um e-mail válido"
        if (data.phone.replace(/\D/g, "").length !== 11)
            newErrors.phone = "Use o formato (99) 9 9999-9999"
        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    const handleContinue = () => {
        if (!validate()) return
        setStep(2)

        if (!attribution || API_BASE_URL.includes("SEU-PROJETO")) return

        // Registra o lead na planilha em segundo plano — não trava a navegação
        // do usuário caso a rede esteja lenta ou a API esteja fora do ar.
        fetch(`${API_BASE_URL}/api/lead`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                leadId: attribution.leadId,
                name: data.name,
                email: data.email,
                phone: data.phone,
                utmSource: attribution.utmSource,
                utmMedium: attribution.utmMedium,
                utmCampaign: attribution.utmCampaign,
                utmTerm: attribution.utmTerm,
                utmContent: attribution.utmContent,
                utmId: attribution.utmId,
                fbclid: attribution.fbclid,
                referrer: attribution.referrer,
                landingUrl: attribution.landingUrl,
                honeypot,
            }),
        }).catch((error) => {
            console.error("Falha ao registrar lead:", error)
        })
    }

    // Monta o Checkout da Stripe dentro da caixa da etapa 2: o pagamento acontece
    // aqui mesmo, sem mandar o visitante pro site do Stripe. Depois de concluído, a
    // própria Stripe redireciona pro return_url definido no backend.
    useEffect(() => {
        if (step !== 2 || !attribution) return

        let cancelled = false

        const mountCheckout = async () => {
            try {
                const stripe = await stripePromise
                if (!stripe) throw new Error("Stripe.js não carregou")

                const checkout = await stripe.createEmbeddedCheckoutPage({
                    // A Stripe chama isto pra obter a sessão criada pelo nosso backend.
                    fetchClientSecret: async () => {
                        const response = await fetch(
                            `${API_BASE_URL}/api/checkout`,
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    leadId: attribution.leadId,
                                    name: data.name,
                                    email: data.email,
                                    phone: data.phone,
                                    utmSource: attribution.utmSource,
                                    utmMedium: attribution.utmMedium,
                                    utmCampaign: attribution.utmCampaign,
                                    utmTerm: attribution.utmTerm,
                                    utmContent: attribution.utmContent,
                                    utmId: attribution.utmId,
                                    fbclid: attribution.fbclid,
                                    referrer: attribution.referrer,
                                    landingUrl: attribution.landingUrl,
                                    honeypot,
                                }),
                            }
                        )

                        const result = await response.json()
                        if (!response.ok || !result.clientSecret) {
                            throw new Error(
                                result.error ?? "Erro ao iniciar pagamento"
                            )
                        }
                        return result.clientSecret as string
                    },
                })

                // Se o visitante voltou pra etapa 1 enquanto carregava, descarta.
                if (cancelled || !checkoutRef.current) {
                    checkout.destroy()
                    return
                }

                embeddedRef.current = checkout
                checkout.mount(checkoutRef.current)
                setIsCheckoutReady(true)
            } catch (error) {
                console.error("Falha ao montar o checkout:", error)
                if (!cancelled) {
                    setPaymentError(
                        "Não foi possível abrir o pagamento agora. Tente novamente em instantes."
                    )
                }
            }
        }

        mountCheckout()

        // Sem isto, voltar pra etapa 1 e avançar de novo deixaria um checkout órfão.
        return () => {
            cancelled = true
            embeddedRef.current?.destroy()
            embeddedRef.current = null
            setIsCheckoutReady(false)
        }
    }, [step, attribution, data, honeypot, retryKey])

    const progress = step === 1 ? 50 : 100

    return (
        <>
            <style>{`
        .cf-outer {
          width: 100%;
          container-type: inline-size;
        }

        .cf-wrapper {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          font-family:
            'SF Pro Display',
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            Roboto,
            Helvetica,
            Arial,
            sans-serif;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
        }

        .cf-wrapper *, .cf-wrapper *::before, .cf-wrapper *::after {
          box-sizing: border-box;
        }

        /* ══════════ PAINEL ESQUERDO (copy) ══════════ */
        .cf-left {
          background-color: #0f0f0f;
          padding: 48px 44px;
          display: flex;
          flex-direction: column;
        }

        .cf-brand {
          font-size: 15px;
          font-weight: bold;
          letter-spacing: 3px;
          color: #ffffff;
          margin: 0 0 20px 0;
        }

        .cf-headline {
          font-size: 30px;
          font-weight: bold;
          color: #ffffff;
          line-height: 1.25;
          margin: 0 0 28px 0;
        }

        .cf-check-item {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 16px;
        }

        .cf-check-mark {
          color: #c9a84c;
          font-size: 17px;
          font-weight: bold;
          line-height: 1.5;
          flex-shrink: 0;
        }

        .cf-check-text {
          font-size: 17px;
          color: #e8e8e8;
          line-height: 1.5;
          margin: 0;
        }

        .cf-divider {
          height: 1px;
          background-color: #2a2a2a;
          margin: 28px 0;
        }

        .cf-why-title {
          font-size: 16px;
          font-weight: bold;
          color: #c9a84c;
          margin: 0 0 12px 0;
        }

        .cf-why-text {
          font-size: 15.5px;
          color: #b8b8b8;
          line-height: 1.65;
          margin: 0 0 20px 0;
        }

        /* ── Como funciona (passo a passo) ── */
        .cf-how-title {
          font-size: 16px;
          font-weight: bold;
          color: #c9a84c;
          margin: 0 0 14px 0;
        }

        /* Nomes cf-step-* não colidem com .cf-step-label/.cf-step-pct, que são
           da barra de progresso "Etapa 1 de 2" no painel branco. */
        .cf-step-row {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 14px;
        }

        .cf-step-num {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background-color: #1a1a1a;
          border: 1px solid #c9a84c;
          color: #c9a84c;
          font-size: 13px;
          font-weight: bold;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .cf-step-copy {
          font-size: 15.5px;
          color: #b8b8b8;
          line-height: 1.55;
          margin: 0;
        }

        /* ── Selo de garantia ── */
        .cf-badge {
          display: flex;
          align-items: center;
          gap: 14px;
          background-color: #1a1a1a;
          border: 1px solid #2b2b2b;
          border-radius: 12px;
          padding: 14px 18px;
        }

        .cf-badge-icon {
          flex-shrink: 0;
        }

        .cf-badge-title {
          font-size: 15px;
          font-weight: bold;
          color: #f0f0f0;
          line-height: 1.3;
          margin: 0 0 3px 0;
        }

        .cf-badge-sub {
          font-size: 13.5px;
          color: #999;
          line-height: 1.4;
          margin: 0;
        }

        /* ══════════ PAINEL DIREITO (form) ══════════ */
        .cf-right {
          background-color: #ffffff;
          padding: 44px 44px 36px 44px;
          display: flex;
          flex-direction: column;
        }

        .cf-form-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 22px;
        }

        .cf-form-title {
          font-size: 22px;
          font-weight: bold;
          color: #1a1a1a;
          margin: 0;
        }

        .cf-price {
          font-size: 16px;
          font-weight: bold;
          color: #2e9e5b;
          margin: 0;
        }

        /* Barra de etapas */
        .cf-steps {
          margin-bottom: 28px;
        }

        .cf-steps-labels {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .cf-step-label {
          font-size: 13.5px;
          color: #555;
          margin: 0;
        }

        .cf-step-pct {
          font-size: 13.5px;
          color: #888;
          margin: 0;
        }

        .cf-bar-track {
          height: 8px;
          background-color: #e8e4da;
          border-radius: 4px;
          overflow: hidden;
        }

        .cf-bar-fill {
          height: 100%;
          background-color: #2e9e5b;
          border-radius: 4px;
          transition: width 0.4s ease;
        }

        /* Campos */
        .cf-field {
          margin-bottom: 20px;
        }

        .cf-label {
          display: block;
          font-size: 15px;
          font-weight: bold;
          color: #1a1a1a;
          margin-bottom: 8px;
        }

        /* font-size 16px evita o zoom automático do iOS ao focar */
        .cf-input {
          width: 100%;
          padding: 14px 16px;
          font-size: 16px;
          font-family: inherit;
          color: #1a1a1a;
          background-color: #ffffff;
          border: 1px solid #d5d0c4;
          border-radius: 10px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .cf-input:focus {
          border-color: #c9a84c;
          box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.18);
        }

        .cf-input.error {
          border-color: #d64545;
        }

        .cf-error-msg {
          font-size: 13px;
          color: #d64545;
          margin: 6px 0 0 0;
        }

        /* Botões */
        /* Mesmo verde do preço e da barra de progresso (#2e9e5b), pra não criar
           um terceiro tom no componente. O texto segue escuro de propósito: sobre
           esse verde ele tem contraste 5.1:1 (passa no WCAG AA), enquanto texto
           branco daria só 3.4:1 e reprovaria neste tamanho de fonte. */
        .cf-btn {
          width: 100%;
          padding: 16px;
          font-size: 17px;
          font-weight: bold;
          font-family: inherit;
          color: #1a1a1a;
          background-color: #2e9e5b;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: background-color 0.2s, transform 0.15s;
          margin-top: 8px;
          -webkit-tap-highlight-color: transparent;
        }

        .cf-btn:hover {
          background-color: #35b268;
        }

        .cf-btn:active {
          transform: scale(0.99);
        }

        .cf-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .cf-btn-back {
          width: 100%;
          padding: 12px;
          font-size: 14.5px;
          font-family: inherit;
          color: #888;
          background: none;
          border: none;
          cursor: pointer;
          margin-top: 12px;
          -webkit-tap-highlight-color: transparent;
        }

        .cf-btn-back:hover {
          color: #555;
        }

        /* Etapa 2: resumo + checkout */
        .cf-summary {
          background-color: #faf8f2;
          border: 1px solid #e8e4da;
          border-radius: 10px;
          padding: 18px 20px;
          margin-bottom: 20px;
        }

        .cf-summary-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 14.5px;
          margin-bottom: 8px;
        }

        .cf-summary-row:last-child {
          margin-bottom: 0;
        }

        .cf-summary-key {
          color: #888;
          flex-shrink: 0;
        }

        .cf-summary-val {
          color: #1a1a1a;
          font-weight: bold;
          text-align: right;
          overflow-wrap: anywhere;
        }

        .cf-checkout-box {
          border: 2px dashed #d5d0c4;
          border-radius: 10px;
          padding: 28px 20px;
          text-align: center;
          font-size: 14px;
          color: #999;
          line-height: 1.6;
          margin-bottom: 8px;
        }

        /* Caixa onde a Stripe injeta o iframe do pagamento. O iframe se
           dimensiona sozinho; aqui só garantimos que ele nunca estoure a
           largura do cartão no mobile. */
        .cf-checkout-mount {
          width: 100%;
          max-width: 100%;
          overflow-x: hidden;
        }

        .cf-checkout-mount iframe {
          width: 100% !important;
          max-width: 100% !important;
        }

        /* ══════════ Responsivo — pela largura do COMPONENTE (Framer) ══════════ */
        @container (max-width: 700px) {
          .cf-wrapper {
            grid-template-columns: 1fr;
          }

          .cf-left {
            padding: 30px 24px 26px 24px;
          }

          .cf-right {
            padding: 28px 20px 26px 20px;
          }

          .cf-brand {
            font-size: 13px;
          }

          .cf-headline {
            font-size: 23px;
            margin-bottom: 20px;
          }

          .cf-check-item {
            gap: 12px;
            margin-bottom: 12px;
          }

          .cf-check-mark,
          .cf-check-text {
            font-size: 15px;
          }

          .cf-divider {
            margin: 20px 0;
          }

          .cf-why-title {
            font-size: 15px;
          }

          .cf-why-text {
            font-size: 14.5px;
            margin-bottom: 16px;
          }

          .cf-how-title {
            font-size: 15px;
            margin-bottom: 12px;
          }

          .cf-step-row {
            gap: 12px;
            margin-bottom: 12px;
          }

          .cf-step-num {
            width: 22px;
            height: 22px;
            font-size: 12px;
          }

          .cf-step-copy {
            font-size: 14.5px;
          }

          .cf-badge {
            gap: 12px;
            padding: 13px 16px;
          }

          .cf-badge-title {
            font-size: 14.5px;
          }

          .cf-badge-sub {
            font-size: 13px;
          }

          .cf-form-title {
            font-size: 19px;
          }

          .cf-price {
            font-size: 14px;
          }

          .cf-steps {
            margin-bottom: 22px;
          }

          .cf-field {
            margin-bottom: 16px;
          }
        }

        /* ══════════ Responsivo — pela largura da TELA (fallback) ══════════ */
        @media (max-width: 700px) {
          .cf-wrapper {
            grid-template-columns: 1fr;
          }

          .cf-left {
            padding: 30px 24px 26px 24px;
          }

          .cf-right {
            padding: 28px 20px 26px 20px;
          }

          .cf-brand {
            font-size: 13px;
          }

          .cf-headline {
            font-size: 23px;
            margin-bottom: 20px;
          }

          .cf-check-item {
            gap: 12px;
            margin-bottom: 12px;
          }

          .cf-check-mark,
          .cf-check-text {
            font-size: 15px;
          }

          .cf-divider {
            margin: 20px 0;
          }

          .cf-why-title {
            font-size: 15px;
          }

          .cf-why-text {
            font-size: 14.5px;
            margin-bottom: 16px;
          }

          .cf-how-title {
            font-size: 15px;
            margin-bottom: 12px;
          }

          .cf-step-row {
            gap: 12px;
            margin-bottom: 12px;
          }

          .cf-step-num {
            width: 22px;
            height: 22px;
            font-size: 12px;
          }

          .cf-step-copy {
            font-size: 14.5px;
          }

          .cf-badge {
            gap: 12px;
            padding: 13px 16px;
          }

          .cf-badge-title {
            font-size: 14.5px;
          }

          .cf-badge-sub {
            font-size: 13px;
          }

          .cf-form-title {
            font-size: 19px;
          }

          .cf-price {
            font-size: 14px;
          }

          .cf-steps {
            margin-bottom: 22px;
          }

          .cf-field {
            margin-bottom: 16px;
          }
        }
      `}</style>

            <div className="cf-outer">
                <div className="cf-wrapper">
                    {/* ══════════ ESQUERDA: COPY ══════════ */}
                    <div className="cf-left">
                        <p className="cf-brand">CARBONE · WORKSHOP</p>
                        <h2 className="cf-headline">
                            Garanta sua vaga na próxima turma
                        </h2>

                        <div className="cf-check-item">
                            <span className="cf-check-mark">✓</span>
                            <p className="cf-check-text">
                                Encontro presencial de 4hrs
                            </p>
                        </div>
                        <div className="cf-check-item">
                            <span className="cf-check-mark">✓</span>
                            <p className="cf-check-text">
                                Você sai com um plano de vendas e uma parceria
                                real
                            </p>
                        </div>
                        <div className="cf-check-item">
                            <span className="cf-check-mark">✓</span>
                            <p className="cf-check-text">
                                Diagnóstico do seu negócio
                            </p>
                        </div>

                        <div className="cf-divider" />

                        <p className="cf-how-title">Como funciona?</p>

                        <div className="cf-step-row">
                            <span className="cf-step-num">1</span>
                            <p className="cf-step-copy">Faça sua inscrição.</p>
                        </div>
                        <div className="cf-step-row">
                            <span className="cf-step-num">2</span>
                            <p className="cf-step-copy">
                                Após a confirmação do pagamento, nossa equipe
                                libera as datas disponíveis.
                            </p>
                        </div>
                        <div className="cf-step-row">
                            <span className="cf-step-num">3</span>
                            <p className="cf-step-copy">
                                Você escolhe o melhor horário para participar.
                            </p>
                        </div>

                        <div className="cf-divider" />

                        <p className="cf-why-title">Por que R$97?</p>
                        <p className="cf-why-text">
                            R$97 é simbólico. É o compromisso que você assume
                            com o resultado da sua empresa.
                        </p>

                        <div className="cf-badge">
                            <svg
                                className="cf-badge-icon"
                                width="28"
                                height="28"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#c9a84c"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M12 2l8 3.5v5.2c0 4.9-3.4 9.4-8 11.3-4.6-1.9-8-6.4-8-11.3V5.5L12 2z" />
                                <path d="M8.5 12l2.4 2.4 4.6-4.8" />
                            </svg>
                            <div>
                                <p className="cf-badge-title">
                                    Participou e não fez sentido?
                                </p>
                                <p className="cf-badge-sub">
                                    Seu dinheiro de volta, sem perguntas.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ══════════ DIREITA: FORM EM 2 ETAPAS ══════════ */}
                    <div className="cf-right">
                        <div className="cf-form-header">
                            <h3 className="cf-form-title">
                                {step === 1 ? "Inscrição" : "Pagamento"}
                            </h3>
                            <p className="cf-price">R$97,00 · cartão de crédito</p>
                        </div>

                        <div className="cf-steps">
                            <div className="cf-steps-labels">
                                <p className="cf-step-label">
                                    Etapa {step} de 2
                                </p>
                                <p className="cf-step-pct">{progress}%</p>
                            </div>
                            <div className="cf-bar-track">
                                <div
                                    className="cf-bar-fill"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>

                        {step === 1 ? (
                            /* ─── ETAPA 1: DADOS ─── */
                            <div>
                                <div className="cf-field">
                                    <label
                                        className="cf-label"
                                        htmlFor="cf-name"
                                    >
                                        Nome completo
                                    </label>
                                    <input
                                        id="cf-name"
                                        className={`cf-input${errors.name ? " error" : ""}`}
                                        type="text"
                                        autoComplete="name"
                                        value={data.name}
                                        onChange={handleChange("name")}
                                        placeholder="Seu nome"
                                    />
                                    {errors.name && (
                                        <p className="cf-error-msg">
                                            {errors.name}
                                        </p>
                                    )}
                                </div>

                                <div className="cf-field">
                                    <label
                                        className="cf-label"
                                        htmlFor="cf-email"
                                    >
                                        E-mail
                                    </label>
                                    <input
                                        id="cf-email"
                                        className={`cf-input${errors.email ? " error" : ""}`}
                                        type="email"
                                        autoComplete="email"
                                        value={data.email}
                                        onChange={handleChange("email")}
                                        placeholder="seu@email.com"
                                    />
                                    {errors.email && (
                                        <p className="cf-error-msg">
                                            {errors.email}
                                        </p>
                                    )}
                                </div>

                                <div className="cf-field">
                                    <label
                                        className="cf-label"
                                        htmlFor="cf-phone"
                                    >
                                        Telefone (WhatsApp)
                                    </label>
                                    <input
                                        id="cf-phone"
                                        className={`cf-input${errors.phone ? " error" : ""}`}
                                        type="tel"
                                        inputMode="numeric"
                                        autoComplete="tel"
                                        maxLength={16}
                                        value={data.phone}
                                        onChange={handlePhoneChange}
                                        placeholder="(11) 9 9999-9999"
                                    />
                                    {errors.phone && (
                                        <p className="cf-error-msg">
                                            {errors.phone}
                                        </p>
                                    )}
                                </div>

                                {/* Honeypot anti-spam: invisível para pessoas, tentador para bots */}
                                <input
                                    type="text"
                                    name="company"
                                    value={honeypot}
                                    onChange={(e) =>
                                        setHoneypot(e.target.value)
                                    }
                                    tabIndex={-1}
                                    autoComplete="off"
                                    aria-hidden="true"
                                    style={{
                                        position: "absolute",
                                        left: "-9999px",
                                        width: 1,
                                        height: 1,
                                        opacity: 0,
                                        pointerEvents: "none",
                                    }}
                                />

                                <button
                                    className="cf-btn"
                                    onClick={handleContinue}
                                >
                                    Continuar
                                </button>
                            </div>
                        ) : (
                            /* ─── ETAPA 2: CHECKOUT ─── */
                            <div>
                                <div className="cf-summary">
                                    <div className="cf-summary-row">
                                        <span className="cf-summary-key">
                                            Nome
                                        </span>
                                        <span className="cf-summary-val">
                                            {data.name}
                                        </span>
                                    </div>
                                    <div className="cf-summary-row">
                                        <span className="cf-summary-key">
                                            E-mail
                                        </span>
                                        <span className="cf-summary-val">
                                            {data.email}
                                        </span>
                                    </div>
                                    <div className="cf-summary-row">
                                        <span className="cf-summary-key">
                                            Telefone
                                        </span>
                                        <span className="cf-summary-val">
                                            {data.phone}
                                        </span>
                                    </div>
                                    <div className="cf-summary-row">
                                        <span className="cf-summary-key">
                                            Valor
                                        </span>
                                        <span className="cf-summary-val">
                                            R$97,00
                                        </span>
                                    </div>
                                </div>

                                {paymentError ? (
                                    <div>
                                        <p className="cf-error-msg">
                                            {paymentError}
                                        </p>
                                        <button
                                            className="cf-btn"
                                            onClick={() => {
                                                setPaymentError(null)
                                                setRetryKey((key) => key + 1)
                                            }}
                                        >
                                            Tentar novamente
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {!isCheckoutReady && (
                                            <div className="cf-checkout-box">
                                                Carregando pagamento seguro…
                                            </div>
                                        )}
                                        {/* A Stripe injeta o formulário de pagamento aqui dentro */}
                                        <div
                                            className="cf-checkout-mount"
                                            ref={checkoutRef}
                                        />
                                    </>
                                )}

                                <button
                                    className="cf-btn-back"
                                    onClick={() => setStep(1)}
                                >
                                    ← Voltar e editar dados
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}
