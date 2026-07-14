# Formulário Workshop — API

Backend do formulário de inscrição do workshop. O **formulário em si continua no Framer** (veja [`framer-component/CheckoutForm.tsx`](framer-component/CheckoutForm.tsx)); este projeto Next.js só publica as rotas de API no Vercel:

- `POST /api/visit` — grava uma linha assim que alguém **chega na página** (antes mesmo de preencher qualquer coisa), com UTMs e referrer. Só dispara uma vez por visitante/campanha (não a cada F5).
- `POST /api/lead` — grava um lead na planilha do Google assim que a Etapa 1 (nome/e-mail/telefone) é concluída, junto com UTMs, referrer e página de entrada.
- `POST /api/checkout` — cria uma sessão de pagamento no Stripe (R$97, Pix ou cartão) e devolve a URL de checkout.
- `POST /api/webhook/stripe` — recebido diretamente pelo Stripe quando o pagamento é aprovado; grava uma linha na planilha confirmando o pagamento.

Cada visitante pode gerar até **três linhas** na planilha: `visita_pagina` (chegou), `lead_criado` (preencheu os dados) e `pagamento_aprovado` (pagou). Isso dá o funil completo — quantos chegaram, quantos preencheram, quantos pagaram — e de onde veio cada um (UTM).

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

## 2. Configurar o Stripe

1. Crie uma conta em [dashboard.stripe.com](https://dashboard.stripe.com/register) (ou use a existente).
2. Em modo de **teste** (toggle no canto superior direito), pegue a chave secreta em "Developers" → "API keys" → `Secret key` (`sk_test_...`) → variável `STRIPE_SECRET_KEY`.
3. Para aceitar **Pix**, ative-o em "Settings" → "Payment methods" (precisa de conta Stripe com país Brasil).
4. Você pode deixar o preço "solto" (usa `STRIPE_AMOUNT=9700` + `STRIPE_CURRENCY=brl`, já configurado) ou criar um Produto/Preço fixo em "Product catalog" e usar o `price_...` gerado em `STRIPE_PRICE_ID`.
5. Defina `STRIPE_SUCCESS_URL` e `STRIPE_CANCEL_URL` com páginas reais do seu site no Framer (ex: uma página "Obrigado" e a própria página de inscrição).
6. O **webhook** só pode ser criado depois do deploy (ele precisa de uma URL pública). Veja o passo 4 abaixo.

## 3. Rodar localmente (opcional)

```bash
cp .env.example .env.local
# preencha .env.local com os valores reais
npm install
npm run dev
```

O `.env.local` nunca é commitado (está no `.gitignore`).

## 4. Deploy no Vercel

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

## 5. Atualizar o componente no Framer

1. Abra [`framer-component/CheckoutForm.tsx`](framer-component/CheckoutForm.tsx) neste repositório.
2. Troque a constante `API_BASE_URL` no topo do arquivo pela URL do seu projeto no Vercel.
3. Cole o conteúdo inteiro no editor de Code Component do Framer, substituindo o componente atual.
4. Publique o site.

## 6. Testar de ponta a ponta

1. Abra a página publicada → confira se uma linha `visita_pagina` apareceu na planilha (só na primeira vez; um F5 não gera outra).
2. Preencha a Etapa 1 → confira se uma linha `lead_criado` apareceu na planilha.
3. Clique em "Ir para o pagamento" → complete o pagamento com um [cartão de teste do Stripe](https://docs.stripe.com/testing#cards) (ex: `4242 4242 4242 4242`, qualquer data futura e CVC).
4. Confira se uma linha `pagamento_aprovado` apareceu na planilha e se o Stripe redirecionou para `STRIPE_SUCCESS_URL`.
5. Teste também com parâmetros UTM na URL, ex: `?utm_source=instagram&utm_medium=bio&utm_campaign=lancamento`, e confira se essas colunas foram preenchidas nas três linhas.
6. Quando tudo estiver validado, troque a chave do Stripe de `sk_test_...` para `sk_live_...` (e refaça o webhook em modo live — os webhooks de teste e produção são independentes no Stripe).

---

## O que dá pra melhorar depois

- **Anti-spam mais forte**: já tem um campo honeypot; para tráfego pago vale considerar reCAPTCHA/hCaptcha se começar a aparecer lead falso na planilha.
- **Confirmação automática**: hoje ninguém recebe e-mail/WhatsApp automático após o pagamento. Dá pra plugar Resend/SendGrid no webhook do Stripe, ou uma automação de WhatsApp.
- **Pixel de conversão server-side**: disparar Meta Conversions API / Google Ads Enhanced Conversions a partir do webhook do Stripe (não do navegador) é mais confiável que pixel client-side, porque não depende de ad blocker nem de o usuário fechar a aba antes de carregar o pixel.
- **Domínio próprio**: hoje a API fica em `*.vercel.app`; dá pra apontar um subdomínio seu (ex: `api.seudominio.com`) no Vercel para ficar mais profissional e não depender do domínio da Vercel.
- **Dashboard simples**: um painel autenticado que lê a planilha (ou um banco) e mostra o funil (leads → pagos, por UTM) sem precisar abrir o Google Sheets.
- **Monitoramento de erro**: setar algo como Sentry nas rotas de API para saber na hora se o Stripe ou o Apps Script começarem a falhar, em vez de descobrir só quando notar a planilha "parada".
- **Migrar para banco de dados** se o volume de inscrições crescer bastante: o Apps Script tem cota diária de execuções (generosa para um workshop, mas não pensada para alto volume/escala).
