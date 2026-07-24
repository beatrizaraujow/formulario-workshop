// ══════════════════════════════════════════════════════════════════════
// Este arquivo é para ser COLADO no editor de código do Framer
// (Code Component) e arrastado UMA VEZ pra dentro da página
// /obrigado-workshop. Ele não roda dentro deste projeto Next.js — o
// Next.js aqui é só o backend publicado no Vercel.
//
// O que ele faz: confirma no backend (que fala com a Stripe usando a chave
// secreta) se a sessão do checkout foi mesmo paga e, só nesse caso, manda o
// evento `purchase_workshop` pro dataLayer do GTM.
//
// Por que existe: antes o GTM disparava Purchase só por a URL /obrigado-workshop
// ter sido aberta — ou seja, quem abrisse o link direto ou desse F5 virava uma
// compra falsa no relatório. Aqui quem decide se houve compra é a Stripe.
//
// IMPORTANTE: no GTM, troque o gatilho do Purchase de "pageview em
// /obrigado-workshop" para um gatilho de EVENTO PERSONALIZADO chamado
// `purchase_workshop`. Enquanto o gatilho antigo existir, ele continua
// contando compra falsa — este componente não desliga o gatilho por você.
// ══════════════════════════════════════════════════════════════════════
import { useEffect } from "react"

// URL do backend no Vercel — a mesma usada no CheckoutForm. Se trocar de
// projeto, mude aqui e republique o site.
const API_BASE_URL = "https://formulario-workshop.vercel.app"

// Guarda os session_id que já viraram evento, pra um F5 não contar a compra de
// novo. Fica no localStorage (e não em sessionStorage) porque o visitante pode
// fechar a aba e reabrir o link do e-mail horas depois — e isso também não é
// uma compra nova.
const STORAGE_KEY = "cf_purchase_fired"
const MAX_STORED_IDS = 20

// Rede de segurança pro caso de o localStorage estar bloqueado (aba anônima,
// cookies de terceiros restritos, preview do editor): aí a dedupe se apoia só
// na memória, que ao menos cobre o mesmo carregamento.
const firedThisPageLoad = new Set<string>()

// Consultas ao backend que ainda não voltaram. É coisa DIFERENTE de "já
// disparou" e por isso mora num Set separado: se o mesmo marcador servisse pros
// dois, a checagem feita quando a resposta chega encontraria a marca que a
// própria requisição deixou ao sair, e o evento nunca sairia.
const inFlight = new Set<string>()

// ─── LOGS TEMPORÁRIOS DE DIAGNÓSTICO ──────────────────────────────────
// Enquanto investigamos por que o purchase_workshop não dispara em vendas
// reais, DEBUG=true imprime cada etapa no console do navegador da
// /obrigado-workshop. Quando o problema estiver resolvido, troque para
// false (ou remova este bloco e as chamadas a `log(...)`).
const DEBUG = true
const log = (...args: unknown[]): void => {
    if (DEBUG) console.log("[PurchaseTracking]", ...args)
}

function readFiredIds(): string[] {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        if (!stored) return []
        const parsed = JSON.parse(stored)
        return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
        return []
    }
}

function hasFired(sessionId: string): boolean {
    return firedThisPageLoad.has(sessionId) || readFiredIds().includes(sessionId)
}

function markFired(sessionId: string): void {
    firedThisPageLoad.add(sessionId)
    try {
        // Mantém só os últimos IDs: a lista serve pra deduplicar retorno recente,
        // não pra ser um histórico de vendas — isso quem tem é a Stripe.
        const ids = [...readFiredIds(), sessionId].slice(-MAX_STORED_IDS)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    } catch {
        // localStorage indisponível: segue só com o guard em memória.
    }
}

declare global {
    interface Window {
        dataLayer?: Record<string, unknown>[]
    }
}

export default function PurchaseTracking() {
    useEffect(() => {
        // [LOG 1] componente carregado
        log("componente carregado", { url: window.location.href })

        // Roda em efeito porque `window` não existe no SSR do site publicado.
        const sessionId = new URLSearchParams(window.location.search).get(
            "session_id"
        )

        // Sem session_id não há o que confirmar: alguém abriu a página direto.
        if (!sessionId) {
            log("sem session_id na URL — página aberta direto, nada a confirmar")
            return
        }
        // [LOG 2] session_id encontrado
        log("session_id encontrado", sessionId)

        // Já contamos esta compra (F5, aba reaberta), ou já tem uma consulta no ar
        // por ela (efeito rodando duas vezes no mesmo carregamento).
        if (hasFired(sessionId) || inFlight.has(sessionId)) {
            log("ignorado antes da consulta", {
                jaDisparado: hasFired(sessionId),
                consultaEmAndamento: inFlight.has(sessionId),
            })
            return
        }

        inFlight.add(sessionId)
        log("consultando backend", `${API_BASE_URL}/api/checkout/session`)

        fetch(
            `${API_BASE_URL}/api/checkout/session?session_id=${encodeURIComponent(sessionId)}`
        )
            .then((response) => {
                log("resposta HTTP recebida", {
                    status: response.status,
                    ok: response.ok,
                })
                return response.json()
            })
            .then((result) => {
                // [LOG 3] resposta da API recebida
                log("resposta da API recebida", result)

                // purchase vem null quando a sessão não existe, não foi paga ou
                // está em outra moeda. Nesses casos não há compra pra contar.
                const purchase = result?.purchase
                if (!purchase) {
                    log(
                        "purchase = null → nenhum evento. Motivo do backend:",
                        result?.reason ?? "(sem reason)"
                    )
                    return
                }

                // Confirma pelo ID que a Stripe devolveu, não pelo que veio na
                // URL — é ele que vai no transaction_id.
                if (hasFired(purchase.transactionId)) {
                    log(
                        "ignorado: transactionId já disparado antes",
                        purchase.transactionId
                    )
                    return
                }

                window.dataLayer = window.dataLayer || []
                const evento = {
                    event: "purchase_workshop",
                    // Os dois carregam o mesmo id da sessão, mas servem a coisas
                    // diferentes: transaction_id é a venda (GA4), event_id é o
                    // disparo (Meta Pixel). O Meta usa o event_id pra casar este
                    // Purchase do navegador com o mesmo Purchase vindo da
                    // Conversions API e não contar a venda duas vezes — só bate
                    // se os dois lados mandarem exatamente este valor.
                    event_id: purchase.transactionId,
                    transaction_id: purchase.transactionId,
                    // O backend manda centavos (é assim que a Stripe conta);
                    // o GTM/GA4 espera reais.
                    value: purchase.amountCents / 100,
                    currency: purchase.currency.toUpperCase(),
                }

                // [LOG 4] antes do dataLayer.push
                log("antes do dataLayer.push", evento)
                window.dataLayer.push(evento)
                // [LOG 5] depois do dataLayer.push
                log("depois do dataLayer.push — evento enfileirado no dataLayer", {
                    tamanhoDataLayer: window.dataLayer.length,
                })

                // Item 6: só marca a sessão como disparada DEPOIS que o push
                // aconteceu. Se o push lançasse um erro síncrono, a sessão ficaria
                // sem marca e uma nova tentativa ainda poderia contar a compra —
                // em vez de ser silenciosamente "já disparada" sem nunca ter ido.
                markFired(purchase.transactionId)
            })
            .catch((error) => {
                // Deu ruim na confirmação: melhor não contar a compra do que
                // contar uma que talvez não exista. A venda em si está salva —
                // o webhook da Stripe registra o pagamento por outro caminho.
                log(
                    "FALHA no fetch/confirmação:",
                    error,
                    "— 'Failed to fetch' aqui costuma ser CORS (ALLOWED_ORIGINS no Vercel não inclui o domínio da página) ou API_BASE_URL errado"
                )
                console.error("Falha ao confirmar a compra:", error)
            })
            .finally(() => {
                inFlight.delete(sessionId)
            })

        // Sem cleanup de propósito: o evento é do site, não deste componente. Se
        // ele sair da tela com a resposta ainda no ar, a compra continua tendo
        // acontecido e ainda precisa ser contada — quem impede a duplicata é o
        // hasFired/markFired, não o desmonte.
    }, [])

    // Não desenha nada: o trabalho dele é só falar com o backend e com o GTM.
    // No canvas do Framer ele fica com 0px — pra selecionar, use o painel de
    // camadas (Layers), não o clique na tela.
    return null
}
