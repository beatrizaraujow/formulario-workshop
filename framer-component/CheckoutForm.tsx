// ══════════════════════════════════════════════════════════════════════
// Este arquivo é para ser COLADO no editor de código do Framer
// (Code Component). Ele não roda dentro deste projeto Next.js — o
// Next.js aqui é só o backend (/api/lead, /api/checkout, /api/webhook/stripe)
// publicado no Vercel. Depois do deploy, troque API_BASE_URL abaixo pela
// URL do seu projeto no Vercel.
// ══════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from "react"

// TROQUE pela URL do projeto depois do "vercel --prod"
// (ex: "https://formulario-workshop-api.vercel.app")
const API_BASE_URL = "https://SEU-PROJETO.vercel.app"

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
    referrer: string
    landingUrl: string
}

const ATTRIBUTION_STORAGE_KEY = "cf_attribution"
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]

function createLeadId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID()
    }
    return `lead_${Date.now()}_${Math.random().toString(16).slice(2)}`
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
                return { attribution: JSON.parse(stored) as Attribution, isNew: false }
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
    const [isRedirecting, setIsRedirecting] = useState(false)
    const [paymentError, setPaymentError] = useState<string | null>(null)

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
                referrer: attribution.referrer,
                landingUrl: attribution.landingUrl,
                honeypot,
            }),
        }).catch((error) => {
            console.error("Falha ao registrar lead:", error)
        })
    }

    const handlePayment = async () => {
        if (!attribution || isRedirecting) return

        if (API_BASE_URL.includes("SEU-PROJETO")) {
            setPaymentError(
                "API_BASE_URL ainda não foi configurada neste componente."
            )
            return
        }

        setPaymentError(null)
        setIsRedirecting(true)

        try {
            const response = await fetch(`${API_BASE_URL}/api/checkout`, {
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
                    referrer: attribution.referrer,
                    landingUrl: attribution.landingUrl,
                    honeypot,
                }),
            })

            const result = await response.json()
            if (!response.ok || !result.url) {
                throw new Error(result.error ?? "Erro ao iniciar pagamento")
            }

            window.location.href = result.url
        } catch (error) {
            console.error("Falha ao iniciar checkout:", error)
            setPaymentError(
                "Não foi possível abrir o pagamento agora. Tente novamente em instantes."
            )
            setIsRedirecting(false)
        }
    }

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
        .cf-btn {
          width: 100%;
          padding: 16px;
          font-size: 17px;
          font-weight: bold;
          font-family: inherit;
          color: #1a1a1a;
          background-color: #c9a84c;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: background-color 0.2s, transform 0.15s;
          margin-top: 8px;
          -webkit-tap-highlight-color: transparent;
        }

        .cf-btn:hover {
          background-color: #d9b95e;
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
                            <p className="cf-price">R$97,00 · Pix ou cartão</p>
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

                                <div className="cf-checkout-box">
                                    Pagamento seguro via Stripe (Pix ou
                                    cartão).
                                    <br />
                                    Você será redirecionado para concluir o
                                    pagamento. A vaga é confirmada após o
                                    pagamento aprovado.
                                </div>

                                {paymentError && (
                                    <p className="cf-error-msg">
                                        {paymentError}
                                    </p>
                                )}

                                <button
                                    className="cf-btn"
                                    onClick={handlePayment}
                                    disabled={isRedirecting}
                                >
                                    {isRedirecting
                                        ? "Redirecionando..."
                                        : "Ir para o pagamento"}
                                </button>

                                <button
                                    className="cf-btn-back"
                                    onClick={() => setStep(1)}
                                    disabled={isRedirecting}
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
