# Formulário Workshop — API

Backend do formulário de inscrição do workshop. O **formulário em si continua no Framer** (veja [`framer-component/CheckoutForm.tsx`](framer-component/CheckoutForm.tsx)); este projeto Next.js só publica as rotas de API no Vercel:

- `POST /api/visit` — registra alguém que **chegou na página** (antes mesmo de preencher qualquer coisa), com UTMs e referrer. Só dispara uma vez por visitante/campanha (não a cada F5).
- `POST /api/lead` — registra o lead assim que a Etapa 1 (nome/e-mail/telefone) é concluída, junto com UTMs, referrer e página de entrada.
- `POST /api/checkout` — cria uma sessão de pagamento no Stripe (R$97, Pix ou cartão) e devolve a URL de checkout.
- `GET /api/checkout/session?session_id=...` — confirma com o Stripe se aquela sessão foi mesmo paga. Serve ao rastreamento: é o que autoriza a página de obrigado a mandar a compra pro GTM (veja [Rastreamento da compra](#rastreamento-da-compra-gtm)).
- `POST /api/webhook/stripe` — recebido diretamente pelo Stripe quando o pagamento muda de estado; registra o pagamento.

Cada visitante pode gerar até **três eventos**: `visita_pagina` (chegou), `lead_criado` (preencheu os dados) e `pagamento_aprovado` (pagou). Isso dá o funil completo — quantos chegaram, quantos preencheram, quantos pagaram — e de onde veio cada um (UTM).

### Onde os dados são gravados

Todo evento vai para **dois destinos ao mesmo tempo**, em paralelo e de forma independente:

| Destino | Papel |
| --- | --- |
| **Supabase** (Postgres) | Fonte de verdade. É o que dá para consultar com SQL, cruzar por UTM e ligar num dashboard. |
| **Planilha do Google** | Cópia para consulta no dia a dia, sem precisar saber SQL. |

Os dois não se derrubam: se a planilha estiver fora do ar, o pagamento ainda é gravado no banco, e vice-versa. Uma falha de registro nunca quebra o checkout de quem está comprando — ela vira log. Quem faz esse fan-out é [`lib/store.ts`](lib/store.ts), ponto único de gravação usado pelas três rotas.

---

## 1. Configurar o Google Sheets (via Apps Script — sem Google Cloud)

Nada de Google Cloud Console, API key ou service account: o script roda direto de dentro da planilha, com as permissões do próprio dono dela.

1. Crie a planilha no Google Sheets (pode ser em branco).
2. Menu **Extensões → Apps Script**. Apague o conteúdo padrão do editor e cole o conteúdo de [`google-apps-script/Code.gs`](google-apps-script/Code.gs) deste repositório.
3. Salve (ícone de disquete). Dê um nome ao projeto se pedir (ex: "Formulário Workshop").
4. Clique em **Implantar → Nova implantação**. Em "Tipo", escolha **App da Web**. Configure:
   - Executar como: **Eu (seu e-mail)**
   - Quem pode acessar: **Qualquer pessoa**
5. Clique em Implantar, autorize o acesso quando o Google pedir (é o seu próprio script, pode aceitar), e copie a **URL do app da Web** gerada (termina em `/exec`) → variável `GOOGLE_SHEETS_WEBHOOK_URL`.
6. Pronto — o próprio script cria a aba `Respostas` e o cabeçalho automaticamente na primeira chamada. Pra testar, cole a URL `/exec` no navegador: deve aparecer `{"ok":true,"message":"Endpoint ativo..."}`.

> Sempre que editar o `Code.gs`, é preciso **implantar de novo** ("Gerenciar implantações" → editar → nova versão) para as mudanças valerem na URL publicada.

## 2. Configurar o Supabase

### 2.1 Criar o projeto

1. Crie uma conta em [supabase.com](https://supabase.com) e clique em **New project**.
2. Preencha:
   - **Name**: ex. `formulario-workshop`.
   - **Database Password**: gere uma senha forte e guarde num gerenciador de senhas. Este projeto não usa ela (a API usa outra chave), mas é a única forma de acessar o Postgres direto — e o Supabase não mostra ela de novo depois.
   - **Region**: **South America (São Paulo)**. O servidor mais perto dos seus clientes é o que responde mais rápido.
3. Espere ~2 minutos até o projeto subir.

### 2.2 Criar as tabelas

1. No menu lateral: **SQL Editor** → **New query**.
2. Abra [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) deste repositório, copie o **conteúdo inteiro** e cole no editor.
3. Clique em **Run** (ou `Ctrl+Enter`). Deve aparecer *"Success. No rows returned"*.
4. Confira em **Table Editor**: devem existir as tabelas `leads` e `payments`.

Rodar de novo não quebra nada — o script é idempotente (`create table if not exists`, `create or replace function`), então dá pra reaplicar sem medo se ficar na dúvida.

### 2.3 Pegar as credenciais

Em **Project Settings** (engrenagem) → **API**:

| No Dashboard do Supabase | Variável de ambiente |
| --- | --- |
| **Project URL** (ex: `https://abcdefgh.supabase.co`) | `SUPABASE_URL` |
| **Project API keys** → `service_role` (clique em *Reveal*) | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ **A `service_role` key ignora todas as regras de segurança do banco e lê/escreve tudo.** Trate como senha:
> - só nas variáveis de ambiente do servidor (`.env.local` local, Vercel em produção);
> - **nunca** cole no componente do Framer — ele roda no navegador do visitante;
> - **nunca** use num nome que comece com `NEXT_PUBLIC_`, porque o Next expõe essas variáveis pro navegador.
>
> A `anon` key não é usada aqui: o navegador nunca fala com o banco, só com `/api`.

### 2.4 (Opcional) Conectar o MCP do Supabase ao Claude Code

Isso **não é necessário para o site funcionar**. Serve só para o Claude Code conseguir consultar e alterar o banco daqui, sem você levar SQL pro Dashboard na mão.

1. Gere um **Personal Access Token**: avatar (canto superior direito) → **Account Preferences** → **Access Tokens** → **Generate new token**. Começa com `sbp_` e **só aparece uma vez**.
2. Pegue o **project ref**: é o pedaço na URL do Dashboard — `supabase.com/dashboard/project/`**`<ESTE-PEDAÇO>`**.
3. Copie [`.mcp.json.example`](.mcp.json.example) para `.mcp.json` na raiz do projeto e troque `sbp_SEU_TOKEN_AQUI` e `SEU_PROJECT_REF` pelos valores reais.
4. **Reinicie o Claude Code.** Ele lê o `.mcp.json` só na abertura da sessão, e vai pedir sua aprovação na primeira vez que vir o servidor.
5. Rode `/mcp` para confirmar que `supabase` aparece conectado.

Quer um MCP que só lê o banco (mais seguro, mas não aplica migrations)? Acrescente `"--read-only"` na lista de `args`.

> O `.mcp.json` está no `.gitignore` justamente porque guarda esse token em texto plano, e ele dá acesso **administrativo à sua conta Supabase inteira** — não só a este projeto. Se preferir não ter isso no disco, pule esta seção: tudo dá pra fazer pelo SQL Editor do Dashboard.

## 3. Configurar o Stripe

1. Crie uma conta em [dashboard.stripe.com](https://dashboard.stripe.com/register) (ou use a existente).
2. Em modo de **teste** (toggle no canto superior direito), pegue a chave secreta em "Developers" → "API keys" → `Secret key` (`sk_test_...`) → variável `STRIPE_SECRET_KEY`.
3. Para aceitar **Pix**, ative-o em "Settings" → "Payment methods" (precisa de conta Stripe com país Brasil).
4. Você pode deixar o preço "solto" (usa `STRIPE_AMOUNT=9700` + `STRIPE_CURRENCY=brl`, já configurado) ou criar um Produto/Preço fixo em "Product catalog" e usar o `price_...` gerado em `STRIPE_PRICE_ID`.
5. Defina `STRIPE_SUCCESS_URL` e `STRIPE_CANCEL_URL` com páginas reais do seu site no Framer (ex: uma página "Obrigado" e a própria página de inscrição).
6. O **webhook** só pode ser criado depois do deploy (ele precisa de uma URL pública). Veja o passo 5 abaixo.

## 4. Rodar localmente (opcional)

```bash
cp .env.example .env.local
# preencha .env.local com os valores reais
npm install
npm run dev
```

O `.env.local` nunca é commitado (está no `.gitignore`).

## 5. Deploy no Vercel

```bash
npx vercel login      # autentica sua conta (abre o navegador)
npx vercel link        # associa esta pasta a um projeto Vercel
npx vercel env add     # repita para cada variável do .env.example (ambiente Production e Preview)
npx vercel --prod       # deploy de produção
```

Alternativa mais visual: suba este repositório para o GitHub e importe em [vercel.com/new](https://vercel.com/new) — daí as variáveis de ambiente são preenchidas pela interface web (Project Settings → Environment Variables) e cada `git push` gera um deploy novo automaticamente.

Depois do primeiro deploy:

1. Copie a URL gerada (ex: `https://formulario-workshop-api.vercel.app`).
2. Em "Developers" → "Webhooks" no Stripe, crie um endpoint apontando para `https://SUA-URL.vercel.app/api/webhook/stripe`, escutando o evento `checkout.session.completed`.
3. Copie o "Signing secret" (`whsec_...`) gerado e adicione como `STRIPE_WEBHOOK_SECRET` nas variáveis de ambiente do Vercel — depois faça um novo deploy (`npx vercel --prod`) para a variável entrar em vigor.
4. Defina `ALLOWED_ORIGINS` com o domínio publicado do seu site no Framer (ex: `https://seusite.framer.website`), para travar o CORS por segurança.

## 6. Atualizar o componente no Framer

São **dois** componentes, um em cada página:

| Arquivo | Onde vai |
| --- | --- |
| [`framer-component/CheckoutForm.tsx`](framer-component/CheckoutForm.tsx) | Página de inscrição (o formulário + pagamento). |
| [`framer-component/PurchaseTracking.tsx`](framer-component/PurchaseTracking.tsx) | Página `/obrigado-workshop`. Não desenha nada — só manda a compra pro GTM. |

Para cada um:

1. Abra o arquivo neste repositório.
2. Troque a constante `API_BASE_URL` no topo pela URL do seu projeto no Vercel.
3. Cole o conteúdo inteiro no editor de Code Component do Framer, substituindo o componente atual.
4. Publique o site.

O `PurchaseTracking` tem 0px na tela: para arrastá-lo pra dentro da página de obrigado, use o painel **Layers**, não o clique no canvas.

## 7. Rastreamento da compra (GTM)

O evento de compra **não pode** sair só porque a página `/obrigado-workshop` foi aberta — quem abrisse o link direto ou desse F5 viraria uma compra falsa no relatório. Quem decide se houve compra é o Stripe:

1. O `POST /api/checkout` cria a sessão com `return_url` = `STRIPE_SUCCESS_URL` + `?session_id={CHECKOUT_SESSION_ID}` (o `session_id` é anexado pela API — **não** o coloque na env var).
2. O Stripe devolve o visitante pra `/obrigado-workshop?session_id=cs_...`.
3. O `PurchaseTracking` pega esse `session_id` e pergunta ao `GET /api/checkout/session`, que consulta o Stripe **com a chave secreta**, no servidor.
4. Só se a sessão vier `metadata.product=workshop_carbone` **e** `status=complete` **e** `payment_status=paid` **e** na moeda esperada, o componente manda pro dataLayer:

```js
window.dataLayer.push({
  event: "purchase_workshop",
  event_id: session.id,        // dedupe do Meta Pixel × Conversions API
  transaction_id: session.id,  // a venda, pro GA4
  value: session.amount_total / 100,
  currency: session.currency.toUpperCase(),
})
```

A checagem do `metadata.product` existe porque a conta Stripe é a mesma pra tudo que a Carbone vende: sem ela, uma compra qualquer em BRL — outro produto, outro funil — dispararia o Purchase do Workshop. O carimbo é gravado pelo `POST /api/checkout` (constante `WORKSHOP_PRODUCT_TAG` em [`lib/stripe.ts`](lib/stripe.ts)), nunca vem do visitante.

O mesmo `session_id` só dispara uma vez: os IDs já contados ficam no `localStorage` (`cf_purchase_fired`), então F5 ou reabrir o link do e-mail não conta a compra de novo.

> **Passo obrigatório no GTM.** No GTM, troque o gatilho do Purchase de *pageview em `/obrigado-workshop`* para um gatilho de **evento personalizado** chamado `purchase_workshop`. Enquanto o gatilho antigo existir, ele continua contando compra falsa — o componente não desliga o gatilho por você.

**O valor não é travado em R$97.** O checkout aceita cupom (`allow_promotion_codes`), então o evento leva o valor **realmente pago** — travar em 9700 faria toda compra com desconto sumir do relatório.

**Pix:** quando o Pix estiver ativo, o visitante volta pra página de obrigado com o QR Code ainda não pago (`payment_status=unpaid`) — e aí, corretamente, nenhuma compra é contada. O pagamento que compensa depois é registrado pelo webhook (Supabase/planilha), mas **não** gera `purchase_workshop` no GTM, porque nesse momento não há navegador na página pra rodar o dataLayer.

Se o Pix virar a forma principal, a compra tem que ser enviada **de servidor** a partir do webhook (`checkout.session.async_payment_succeeded`), e o destino manda na escolha da ferramenta:

| Destino | Como |
| --- | --- |
| **Meta Ads** | [Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api). É o único jeito de a venda chegar na Meta. |
| **GA4** | [Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4). Serve só pro GA4 — **não** registra nada na Meta. |

Nos dois casos, mande o mesmo `session.id` no `event_id`: é ele que faz a Meta casar o evento do servidor com o do navegador e não contar a venda duas vezes.

## 8. Testar de ponta a ponta

Confira **os dois destinos** em cada passo — planilha e Supabase (**Table Editor**). Se um gravou e o outro não, o problema é só naquele destino; olhe os logs da função no Vercel.

1. Abra a página publicada com UTMs na URL, ex: `?utm_source=instagram&utm_medium=bio&utm_campaign=lancamento`.
   - Planilha: linha `visita_pagina` (só na primeira vez; um F5 não gera outra).
   - Supabase: linha nova em `leads`, com `utm_source` etc. preenchidos e `name`/`email`/`phone` ainda nulos.
2. Preencha a Etapa 1.
   - Planilha: linha `lead_criado`.
   - Supabase: **a mesma linha** em `leads` agora com nome/e-mail/telefone. Não é uma linha nova — o `id` é o mesmo, e os UTMs da visita continuam lá.
3. Complete o pagamento com um [cartão de teste do Stripe](https://docs.stripe.com/testing#cards) (`4242 4242 4242 4242`, qualquer data futura e CVC).
   - Planilha: linha `pagamento_aprovado`, e o Stripe redireciona pra `STRIPE_SUCCESS_URL`.
   - Supabase: linha em `payments` com `status = paid`, `amount_cents = 9700` e `lead_id` apontando pro lead do passo 2.
   - GTM: abra o **Preview/Tag Assistant** e confira que saiu **um** `purchase_workshop`, com `value: 97` e `currency: "BRL"`. Dê **F5 na página de obrigado**: não pode sair um segundo evento. Abra `/obrigado-workshop` **sem** `?session_id=` na URL: não pode sair nada.
4. **Se o Pix estiver ativo**, teste ele também: o `payments` deve nascer `pending` (só emitiu o QR Code) e virar `paid` quando compensar. Um pagamento que já está `paid` nunca volta pra `pending`, mesmo que o Stripe reentregue os eventos fora de ordem.
5. Quando tudo estiver validado, troque a chave do Stripe de `sk_test_...` para `sk_live_...` e refaça o webhook em modo live — os webhooks de teste e produção são independentes no Stripe.

### Consultas úteis (SQL Editor)

```sql
-- Funil por campanha: quantos chegaram, quantos viraram lead, quantos pagaram
select
  coalesce(nullif(l.utm_source, ''), 'direto')             as origem,
  l.utm_campaign                                            as campanha,
  count(*)                                                  as visitas,
  count(l.email)                                            as leads,
  count(*) filter (where p.status = 'paid')                 as pagos,
  sum(p.amount_cents) filter (where p.status = 'paid') / 100.0 as receita_reais
from public.leads l
left join public.payments p on p.lead_id = l.id
group by 1, 2
order by pagos desc;
```

```sql
-- Quem pagou, mais recente primeiro
select p.created_at, l.name, l.email, l.phone, p.amount_cents / 100.0 as valor
from public.payments p
join public.leads l on l.id = p.lead_id
where p.status = 'paid'
order by p.created_at desc;
```

---

## O que dá pra melhorar depois

- **Anti-spam mais forte**: já tem um campo honeypot; para tráfego pago vale considerar reCAPTCHA/hCaptcha se começar a aparecer lead falso na planilha.
- **Confirmação automática**: hoje ninguém recebe e-mail/WhatsApp automático após o pagamento. Dá pra plugar Resend/SendGrid no webhook do Stripe, ou uma automação de WhatsApp.
- **Pixel de conversão server-side**: disparar Meta Conversions API / Google Ads Enhanced Conversions a partir do webhook do Stripe (não do navegador) é mais confiável que pixel client-side, porque não depende de ad blocker nem de o usuário fechar a aba antes de carregar o pixel.
- **Domínio próprio**: hoje a API fica em `*.vercel.app`; dá pra apontar um subdomínio seu (ex: `api.seudominio.com`) no Vercel para ficar mais profissional e não depender do domínio da Vercel.
- **Dashboard simples**: um painel autenticado que lê o Supabase e mostra o funil (leads → pagos, por UTM) sem precisar abrir o SQL Editor. As queries do passo 7 já são a base dele.
- **Monitoramento de erro**: setar algo como Sentry nas rotas de API para saber na hora se o Stripe ou o Apps Script começarem a falhar, em vez de descobrir só quando notar a planilha "parada". Hoje uma falha de gravação só aparece no log do Vercel — ninguém é avisado.
- **Aposentar a planilha**: o Apps Script tem cota diária de execuções (generosa para um workshop, mas não pensada para escala) e é o destino mais frágil dos dois. Se o volume crescer, o Supabase já é a fonte de verdade — dá pra remover [`lib/sheets.ts`](lib/sheets.ts) e o fan-out de [`lib/store.ts`](lib/store.ts) sem perder nada.
