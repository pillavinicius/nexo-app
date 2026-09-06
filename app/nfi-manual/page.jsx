export const metadata = {
  title: "Mini Manual NFI | NEXO",
  description: "Guia de leitura do NEXO Flow Intelligence.",
};

const STATES = [
  ["t2_official", "Dado oficial publicado pela B3. Pode alimentar a medição e o histórico."],
  ["t2_pending", "Publicação ainda pendente. O valor fica null; não é estimado nem repetido."],
  ["proxy", "Estimativa identificada como proxy. Não pode se passar por dado oficial."],
];

const RULES = [
  ["Pressão compradora", "Fluxo relativamente alto dentro da distribuição observada."],
  ["Pressão neutra", "Fluxo na faixa central da distribuição; não sustenta narrativa extrema."],
  ["Pressão vendedora", "Fluxo relativamente baixo dentro da distribuição observada."],
  ["Extremo confirmado", "Somente percentil abaixo de 10% ou acima de 90%, calculado com 24 meses oficiais completos."],
];

export default function NfiManualPage() {
  return (
    <main className="manual">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;600&display=swap');
        *{box-sizing:border-box}body{margin:0;background:#131008;color:#D4C9A8;font-family:'Inter',sans-serif}.manual{max-width:900px;margin:auto;padding:22px 16px 56px}
        .top{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #2A2318;padding-bottom:15px}.brand,h1,h2,h3,.back{font-family:'JetBrains Mono',monospace}.brand{font-size:20px;font-weight:700;letter-spacing:3px;color:#E8D5A3}.sub{font:8px 'JetBrains Mono',monospace;letter-spacing:2px;color:#6A5C3A;margin-top:5px}.back{font-size:9px;color:#C9A84C;border:1px solid #6A5C3A;padding:8px 10px;text-decoration:none;height:max-content}
        h1{font-size:clamp(22px,5vw,36px);color:#E8D5A3;margin:24px 0 10px}.lead{color:#A89060;line-height:1.7;max-width:760px}.formula{border-left:3px solid #C9A84C;background:rgba(201,168,76,.06);padding:14px;line-height:1.65;margin:22px 0}.formula code{display:block;color:#E8D5A3;font-weight:700;margin-bottom:5px}
        section{margin-top:28px}h2{font-size:11px;letter-spacing:2px;color:#C9A84C;border-bottom:1px solid #2A2318;padding-bottom:8px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.card{border:1px solid #2A2318;padding:13px}.card h3{font-size:11px;color:#E8D5A3;margin:0 0 7px}.card p{font-size:12px;line-height:1.6;color:#8A7A58;margin:0}.notice{border-left:3px solid #D2A03C;background:rgba(210,160,60,.06);padding:13px;color:#A89060;line-height:1.65;margin-top:14px}.foot{margin-top:30px;border-top:1px solid #2A2318;padding-top:12px;font:9px 'JetBrains Mono',monospace;color:#4A3E28;line-height:1.6}@media(max-width:640px){.grid{grid-template-columns:1fr}.top{flex-direction:column}.back{text-align:center}}
      `}</style>
      <header className="top"><div><div className="brand">NEXO</div><div className="sub">MINI MANUAL · NFI v1.0</div></div><a className="back" href="/">VOLTAR AO APLICATIVO</a></header>
      <h1>Como interpretar o fluxo sem confundi-lo com valor</h1>
      <p className="lead">O NFI mede o fluxo líquido estrangeiro da B3 e sua posição histórica. Ele ajuda a explicar por que o preço se deslocou; não responde se o ativo está barato ou caro.</p>
      <div className="formula"><code>FLUXO → EXPLICAÇÃO DE DESLOCAMENTO</code>Valor intrínseco, score e veredito permanecem fora do cálculo do NFI.</div>
      <section><h2>Estados da fonte</h2><div className="grid">{STATES.map(([title, text]) => <article className="card" key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section><h2>Como ler o resultado</h2><div className="grid">{RULES.map(([title, text]) => <article className="card" key={title}><h3>{title}</h3><p>{text}</p></article>)}</div><div className="notice">Com menos de 24 meses, o percentil aparece como provisório e nunca ativa a explicação de fluxo extremo. Para ativos no exterior, o módulo permanece indisponível nesta fase.</div></section>
      <section><h2>Regra de uso no motor</h2><div className="grid"><article className="card"><h3>Citação permitida</h3><p>Quando o extremo canônico estiver confirmado, a análise pode citar o fluxo como causa provável do deslocamento.</p></article><article className="card"><h3>Citação proibida</h3><p>Fluxo comprador não é motivo isolado de compra; fluxo vendedor não reduz automaticamente valor justo nem score.</p></article></div></section>
      <div className="foot">Manual operacional NFI F1b · fonte oficial B3 · atualização D+2 · domínio opcional do Context Package NMI 1.3.</div>
    </main>
  );
}
