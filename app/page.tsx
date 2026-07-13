export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "80px auto",
        padding: "0 24px",
        color: "#1a1a1a",
      }}
    >
      <h1 style={{ fontSize: 22 }}>Formulário Workshop — API</h1>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        Este projeto é o backend do formulário de inscrição (o formulário em
        si vive no Framer). Ele expõe as rotas abaixo, consumidas pelo
        componente do formulário:
      </p>
      <ul style={{ lineHeight: 1.8 }}>
        <li>
          <code>POST /api/lead</code> — grava um lead na planilha assim que a
          etapa 1 é concluída
        </li>
        <li>
          <code>POST /api/checkout</code> — cria a sessão de pagamento no
          Stripe
        </li>
        <li>
          <code>POST /api/webhook/stripe</code> — recebe a confirmação de
          pagamento do Stripe e atualiza a planilha
        </li>
      </ul>
      <p style={{ color: "#888", fontSize: 14 }}>
        Veja o README do repositório para instruções de configuração.
      </p>
    </main>
  )
}
