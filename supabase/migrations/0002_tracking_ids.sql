-- ══════════════════════════════════════════════════════════════════════
-- Guarda os dois identificadores de clique da Meta no lead.
--
-- AMBOS SÃO text, e isso não é preguiça de tipagem:
--
--   utm_id  — id da campanha na Meta, 18 dígitos (ex: 120255825436830002).
--             Cabe em bigint, mas não em integer, e nunca entra em conta:
--             não se soma nem se ordena um id. Como number no JavaScript ele
--             passa de 2^53 e é arredondado em silêncio — o id gravado vira
--             OUTRO id, e a atribuição aponta pra campanha errada sem erro
--             nenhum aparecer. Como texto, o valor que a Meta mandou é o
--             valor que fica.
--
--   fbclid  — click id da Meta. 200+ caracteres de letras, números, "_" e "-".
--             Não tem representação numérica possível.
--
-- Sem limite de tamanho de propósito: o fbclid muda de formato quando a Meta
-- quer, e um varchar(n) apertado voltaria a derrubar gravação por tamanho.
-- ══════════════════════════════════════════════════════════════════════

alter table public.leads add column if not exists utm_id text;
alter table public.leads add column if not exists fbclid text;

-- Relatório por campanha da Meta é a razão de existir do utm_id.
create index if not exists leads_utm_id_idx on public.leads (utm_id);
