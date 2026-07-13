# Formulário Workshop — API

Backend do formulário de inscrição do workshop. O **formulário em si continua no Framer** (veja [`framer-component/CheckoutForm.tsx`](framer-component/CheckoutForm.tsx)); este projeto Next.js só publica 3 rotas de API no Vercel:

- `POST /api/lead` — grava um lead na planilha do Google assim que a Etapa 1 (nome/e-mail/telefone) é concluída, junto com UTMs, referrer e página de entrada.
- `POST /api/checkout` — cria uma sessão de pagamento no Stripe (R$97, Pix ou cartão) e devolve a URL de checkout.
- `POST /api/webhook/stripe` — recebido diretamente pelo Stripe quando o pagamento é aprovado; grava uma segunda linha na planilha confirmando o pagamento.

Cada envio de formulário gera **duas linhas possíveis** na planilha: `lead_criado` (assim que preenche os dados) e `pagamento_aprovado` (só depois que o Stripe confirma o pagamento). Isso permite calcular a taxa de conversão lead → pagamento e ver quem abandonou o checkout.

---

## 1. Configurar o Google Sheets

1. Crie a planilha no Google Sheets (pode ser em branco). Renomeie a primeira aba para `Respostas` (ou defina `GOOGLE_SHEET_TAB` com o nome que escolher).
2. Na primeira linha, crie o cabeçalho (colunas A→P):
   `Timestamp | Evento | Lead ID | Nome | Email | Telefone | Valor | UTM Source | UTM Medium | UTM Campaign | UTM Term | UTM Content | Referrer | Landing Page | Stripe Session ID | Stripe Payment Intent`
3. Copie o ID da planilha da URL: `docs.google.com/spreadsheets/d/{ESTE_TRECHO}/edit` → variável `GOOGLE_SHEET_ID`.
4. Crie uma conta de serviço no Google Cloud:
   - Acesse [console.cloud.google.com](https://console.cloud.google.com/), crie um projeto (ou use um existente).
   - Ative a **Google Sheets API** (menu "APIs e serviços" → "Ativar APIs e serviços").
   - Vá em "Credenciais" → "Criar credenciais" → "Conta de serviço". Dê um nome qualquer e conclua.
   - Abra a conta de serviço criada → aba "Chaves" → "Adicionar chave" → "Criar nova chave" → JSON. Um arquivo `.json` será baixado.
5. Abra o `.json` baixado: copie o `client_email` para `GOOGLE_CLIENT_EMAIL` e o `private_key` para `GOOGLE_PRIVATE_KEY` (mantenha as quebras de linha `\n` como estão).
6. **Compartilhe a planilha** com o e-mail da conta de serviço (o `client_email`), com permissão de **Editor** — do contrário a API não consegue gravar nada.

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

1. Preencha a Etapa 1 do formulário publicado → confira se uma linha `lead_criado` apareceu na planilha.
2. Clique em "Ir para o pagamento" → complete o pagamento com um [cartão de teste do Stripe](https://docs.stripe.com/testing#cards) (ex: `4242 4242 4242 4242`, qualquer data futura e CVC).
3. Confira se uma linha `pagamento_aprovado` apareceu na planilha e se o Stripe redirecionou para `STRIPE_SUCCESS_URL`.
4. Teste também com parâmetros UTM na URL, ex: `?utm_source=instagram&utm_medium=bio&utm_campaign=lancamento`, e confira se essas colunas foram preenchidas.
5. Quando tudo estiver validado, troque a chave do Stripe de `sk_test_...` para `sk_live_...` (e refaça o webhook em modo live — os webhooks de teste e produção são independentes no Stripe).

---

## O que dá pra melhorar depois

- **Anti-spam mais forte**: já tem um campo honeypot; para tráfego pago vale considerar reCAPTCHA/hCaptcha se começar a aparecer lead falso na planilha.
- **Confirmação automática**: hoje ninguém recebe e-mail/WhatsApp automático após o pagamento. Dá pra plugar Resend/SendGrid no webhook do Stripe, ou uma automação de WhatsApp.
- **Pixel de conversão server-side**: disparar Meta Conversions API / Google Ads Enhanced Conversions a partir do webhook do Stripe (não do navegador) é mais confiável que pixel client-side, porque não depende de ad blocker nem de o usuário fechar a aba antes de carregar o pixel.
- **Domínio próprio**: hoje a API fica em `*.vercel.app`; dá pra apontar um subdomínio seu (ex: `api.seudominio.com`) no Vercel para ficar mais profissional e não depender do domínio da Vercel.
- **Dashboard simples**: um painel autenticado que lê a planilha (ou um banco) e mostra o funil (leads → pagos, por UTM) sem precisar abrir o Google Sheets.
- **Monitoramento de erro**: setar algo como Sentry nas rotas de API para saber na hora se o Stripe ou o Google Sheets começarem a falhar, em vez de descobrir só quando notar a planilha "parada".
- **Migrar para banco de dados** se o volume de inscrições crescer bastante: a Sheets API tem limite de ~300 requisições/min por projeto, tranquilo para um workshop mas não para escala maior.
