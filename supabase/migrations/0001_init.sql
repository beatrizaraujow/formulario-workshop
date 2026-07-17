-- ══════════════════════════════════════════════════════════════════════
-- Banco do formulário do Workshop.
--
-- Duas tabelas:
--   leads    — uma linha por pessoa (identidade + de onde ela veio)
--   payments — uma linha por sessão de checkout do Stripe
--
-- Quem escreve aqui é só o backend em /api, usando a service role key.
-- O navegador nunca fala direto com o banco.
-- ══════════════════════════════════════════════════════════════════════

-- ─── leads ────────────────────────────────────────────────────────────
create table if not exists public.leads (
  -- O id é gerado no navegador (crypto.randomUUID(), com um fallback
  -- "lead_<timestamp>_<random>" em navegadores antigos). Como o fallback
  -- não é um UUID válido, a coluna é text — se fosse uuid, esses leads
  -- seriam rejeitados na hora de gravar.
  id           text primary key,
  name         text,
  email        text,
  phone        text,
  -- Atribuição de primeiro toque: o componente guarda os UTMs no
  -- localStorage e reenvia sempre os mesmos, então estes campos contam
  -- por onde a pessoa chegou na PRIMEIRA vez, não na última.
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  referrer     text,
  landing_url  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists leads_email_idx      on public.leads (email);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- ─── payments ─────────────────────────────────────────────────────────
-- Enum em vez de text: o banco recusa um status escrito errado em vez de
-- aceitar calado e estragar os relatórios.
do $$ begin
  create type public.payment_status as enum ('pending', 'paid', 'failed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               text references public.leads (id) on delete set null,
  -- Unique é o que torna o webhook idempotente: o Stripe reenvia o mesmo
  -- evento quando acha que falhou, e reenviar não pode virar linha nova.
  stripe_session_id     text not null unique,
  stripe_payment_intent text,
  status                public.payment_status not null,
  -- Em centavos, igual o Stripe manda (R$97,00 = 9700). Guardar o inteiro
  -- evita erro de arredondamento de float em dinheiro.
  amount_cents          integer,
  currency              text,
  customer_email        text,
  customer_name         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists payments_lead_id_idx    on public.payments (lead_id);
create index if not exists payments_status_idx     on public.payments (status);
create index if not exists payments_created_at_idx on public.payments (created_at desc);

-- ─── updated_at automático ────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function public.touch_updated_at();

-- ─── record_payment ───────────────────────────────────────────────────
-- Grava (ou atualiza) um pagamento a partir do webhook do Stripe.
--
-- Existe como função no banco, e não como código no /api, por causa de um
-- detalhe do Pix: ele gera DOIS eventos — "completed" (só emitiu o QR Code,
-- status pending) e depois "async_payment_succeeded" (compensou, status paid).
-- O Stripe não garante a ordem de entrega, então o "pending" pode chegar
-- DEPOIS do "paid" e marcar como não-pago quem já pagou.
--
-- O CASE abaixo impede isso: uma vez 'paid', continua 'paid'. Fazer essa
-- checagem em TypeScript (ler o status, decidir, gravar) teria uma corrida
-- entre a leitura e a escrita; aqui é um comando só, atômico.
create or replace function public.record_payment(
  p_lead_id               text,
  p_name                  text,
  p_email                 text,
  p_phone                 text,
  p_stripe_session_id     text,
  p_stripe_payment_intent text,
  p_status                public.payment_status,
  p_amount_cents          integer,
  p_currency              text
)
returns void
language plpgsql
as $$
begin
  -- Garante que o lead existe antes do payment apontar pra ele. Sem isto, um
  -- lead cuja gravação falhou na etapa 1 derrubaria a gravação do pagamento
  -- por violar a foreign key — perder o dado de quem pagou é o pior caso.
  if p_lead_id is not null and p_lead_id <> '' then
    insert into public.leads (id, name, email, phone)
    values (p_lead_id, nullif(p_name, ''), nullif(p_email, ''), nullif(p_phone, ''))
    on conflict (id) do update set
      -- coalesce(excluded, leads): só sobrescreve se o webhook trouxe valor.
      -- Um campo vazio no metadata não pode apagar o que a etapa 1 já gravou.
      -- (Dentro do ON CONFLICT, "leads" é a linha que já existia e "excluded"
      --  é a que tentamos inserir agora.)
      name  = coalesce(excluded.name,  leads.name),
      email = coalesce(excluded.email, leads.email),
      phone = coalesce(excluded.phone, leads.phone);
  end if;

  insert into public.payments (
    lead_id, stripe_session_id, stripe_payment_intent,
    status, amount_cents, currency, customer_email, customer_name
  )
  values (
    nullif(p_lead_id, ''), p_stripe_session_id, nullif(p_stripe_payment_intent, ''),
    p_status, p_amount_cents, nullif(p_currency, ''),
    nullif(p_email, ''), nullif(p_name, '')
  )
  on conflict (stripe_session_id) do update set
    -- Aqui "payments" é a linha que já estava gravada; "excluded", a que chegou agora.
    status = case
      when payments.status = 'paid' then 'paid'::public.payment_status
      else excluded.status
    end,
    stripe_payment_intent = coalesce(excluded.stripe_payment_intent, payments.stripe_payment_intent),
    amount_cents          = coalesce(excluded.amount_cents,          payments.amount_cents),
    currency              = coalesce(excluded.currency,              payments.currency),
    customer_email        = coalesce(excluded.customer_email,        payments.customer_email),
    customer_name         = coalesce(excluded.customer_name,         payments.customer_name),
    lead_id               = coalesce(excluded.lead_id,               payments.lead_id);
end;
$$;

-- ─── RLS ──────────────────────────────────────────────────────────────
-- Liga o RLS e NÃO cria nenhuma policy. Efeito: qualquer chave pública
-- (anon) enxerga zero linhas, mesmo que vaze. A service role key usada
-- pelo /api ignora o RLS e continua escrevendo normalmente.
--
-- Isto é o que impede que os dados de pagamento fiquem legíveis por
-- qualquer um que abra o DevTools do site.
alter table public.leads    enable row level security;
alter table public.payments enable row level security;
