export const metadata = {
  title: "Mini Manual HDL | NEXO",
  description: "Guia de aplicação e interpretação do Hurdle do Leviatã do método NEXO.",
};

const ASSET_GUIDANCE = [
  [
    "Ações maduras",
    "Aplicável",
    "Construa a TIR com fluxo distribuível, crescimento sustentável e valor terminal normalizado. Evite perpetuar um ano excepcional.",
  ],
  [
    "Bancos e seguradoras",
    "Aplicável",
    "Use lucro distribuível, crescimento patrimonial e retorno sobre capital normalizados, respeitando capital regulatório e custo de crédito.",
  ],
  [
    "Cíclicas e commodities",
    "Aplicável com cautela",
    "Use premissas de ciclo médio. Preço de commodity, margem ou câmbio de pico não devem sustentar sozinhos a TIR esperada.",
  ],
  [
    "Empresas de crescimento",
    "Aplicável com cautela",
    "Trabalhe com cenários e explicite quanto da TIR depende do valor terminal. Quanto maior essa dependência, menor a observabilidade.",
  ],
  [
    "FIIs",
    "Aplicável",
    "Combine rendimentos reais sustentáveis com a variação plausível do valor patrimonial ou preço de saída, considerando vacância, revisões e alavancagem.",
  ],
  [
    "Ativos internacionais",
    "Não aplicável na F1a",
    "Retorno em moeda estrangeira não pode ser comparado diretamente à curva real brasileira. Será necessária uma curva soberana coerente com a moeda da tese.",
  ],
];

const MACRO_GUIDANCE = [
  ["Juro real elevado", "Aumenta o custo de oportunidade e exige que a tese entregue retorno real superior sem depender de premissas frágeis."],
  ["Curva inclinada ou invertida", "Exige atenção ao vértice compatível com o horizonte; não autoriza escolher a menor taxa disponível."],
  ["Inflação instável", "Reduz a confiança da TIR real quando preços, custos ou contratos não possuem repasse econômico consistente."],
  ["Recessão ou desaceleração", "Exige normalizar lucros, ocupação, inadimplência e fluxo de caixa antes de calcular a TIR."],
  ["Expansão excepcional", "Resultados de pico não devem ser perpetuados sem evidência estrutural de capacidade e demanda."],
  ["Risco fiscal ou mudança de regime", "Pode deslocar a curva soberana. A data da curva precisa permanecer visível para revelar eventual defasagem."],
];

const RULES = [
  ["Mesma base", "Compare retorno real com juro real, na mesma moeda e em horizontes compatíveis."],
  ["Sem extrapolação", "Fora do intervalo da curva, o HDL fica não calculável. O Scan continua permitido; o Deep brasileiro fica bloqueado."],
  ["TIR fundamentada", "O HDL não cria a TIR. Ela deve vir de premissas econômicas explícitas da análise."],
  ["Sem veredito automático", "Superar o soberano não melhora score nem promove a classificação. Não superar exige explicação, mas não constitui veto isolado."],
];

export default function HdlManualPage() {
  return (
    <main className="manual">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');
        *{box-sizing:border-box} body{margin:0;background:#131008;color:#D4C9A8;font-family:'Inter',sans-serif}
        .manual{max-width:960px;margin:0 auto;padding:22px 16px 56px}
        .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid #2A2318;padding-bottom:15px;margin-bottom:20px}
        .brand{font:700 20px 'JetBrains Mono',monospace;letter-spacing:3px;color:#E8D5A3}.eyebrow{font:500 8px 'JetBrains Mono',monospace;letter-spacing:2px;text-transform:uppercase;color:#6A5C3A;margin-top:5px}
        .back{font:700 9px 'JetBrains Mono',monospace;color:#C9A84C;border:1px solid #6A5C3A;padding:8px 10px;text-decoration:none;text-transform:uppercase;letter-spacing:1px}
        h1{font:700 clamp(22px,5vw,38px) 'JetBrains Mono',monospace;color:#E8D5A3;line-height:1.15;margin:0 0 10px}.lead{color:#A89060;line-height:1.7;font-size:14px;max-width:780px;margin:0 0 24px}
        .formula{border-left:3px solid #C9A84C;background:rgba(201,168,76,.06);padding:14px;color:#D4C9A8;line-height:1.65;font-size:13px;margin-bottom:24px}.formula code{display:block;color:#E8D5A3;font:700 13px 'JetBrains Mono',monospace;margin-bottom:5px}
        section{margin-top:28px}h2{font:700 11px 'JetBrains Mono',monospace;letter-spacing:2px;text-transform:uppercase;color:#C9A84C;border-bottom:1px solid #2A2318;padding-bottom:8px;margin:0 0 12px}
        .table-wrap{overflow-x:auto;border:1px solid #2A2318}table{width:100%;border-collapse:collapse;min-width:690px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #2A2318;padding:11px 12px}th{font:700 8px 'JetBrains Mono',monospace;letter-spacing:1.2px;text-transform:uppercase;color:#6A5C3A}td{font-size:12px;line-height:1.55;color:#8A7A58}td:first-child{font:700 11px 'JetBrains Mono',monospace;color:#E8D5A3;width:190px}td:nth-child(2){font:700 9px 'JetBrains Mono',monospace;color:#C9A84C;width:150px}tr:last-child td{border-bottom:0}
        .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.card{border:1px solid #2A2318;padding:13px;min-width:0}.card h3{font:700 11px 'JetBrains Mono',monospace;color:#E8D5A3;margin:0 0 7px}.card p{font-size:12px;line-height:1.6;color:#8A7A58;margin:0;overflow-wrap:anywhere}
        .reading{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.result{border:1px solid #2A2318;border-top:2px solid;padding:13px}.result.pass{border-top-color:#6DB46D}.result.attention{border-top-color:#D2A03C}.result.fail{border-top-color:#C87070}.result b{font:700 10px 'JetBrains Mono',monospace;color:#E8D5A3}.result p{font-size:12px;line-height:1.55;color:#8A7A58;margin:7px 0 0}
        .notice{border:1px solid rgba(210,160,60,.25);border-left:3px solid #D2A03C;background:rgba(210,160,60,.06);padding:12px 14px;color:#A89060;line-height:1.65;font-size:12px;margin-top:12px}.notice strong{color:#D2A03C}
        .foot{margin-top:30px;border-top:1px solid #2A2318;padding-top:12px;font:400 9px 'JetBrains Mono',monospace;color:#4A3E28;line-height:1.6}
        @media(max-width:640px){.grid,.reading{grid-template-columns:1fr}.top{align-items:stretch;flex-direction:column}.back{text-align:center}.table-wrap{margin-left:-4px;margin-right:-4px}.lead{font-size:13px}}
      `}</style>

      <header className="top">
        <div><div className="brand">NEXO</div><div className="eyebrow">Mini manual · HDL v1.0</div></div>
        <a className="back" href="/">Voltar ao aplicativo</a>
      </header>

      <h1>Como aplicar o Hurdle do Leviatã</h1>
      <p className="lead">O HDL compara a TIR real esperada da tese com o retorno real soberano disponível no mesmo horizonte. Ele mede custo de oportunidade: não substitui valuation, qualidade, risco ou investigação.</p>
      <div className="formula">
        <code>ALFA HDL = TIR REAL ESPERADA − JURO REAL SOBERANO</code>
        Um alfa positivo diz que a projeção supera matematicamente o Tesouro. Não prova, sozinho, que a diferença remunera todos os riscos do ativo.
      </div>

      <section>
        <h2>Aplicação por classe e perfil econômico</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Classe ou perfil</th><th>Condição F1a</th><th>Como construir e testar</th></tr></thead>
            <tbody>{ASSET_GUIDANCE.map(([asset, status, guidance]) => <tr key={asset}><td>{asset}</td><td>{status}</td><td>{guidance}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Leitura conforme o cenário macro</h2>
        <div className="grid">{MACRO_GUIDANCE.map(([scenario, guidance]) => <article className="card" key={scenario}><h3>{scenario}</h3><p>{guidance}</p></article>)}</div>
        <div className="notice"><strong>Evite dupla contagem:</strong> o cenário macro qualifica a confiança nas premissas, mas não adiciona um prêmio arbitrário à fórmula. SIM, SDS-M e NEXO-Regime continuam responsáveis pela leitura sistêmica.</div>
      </section>

      <section>
        <h2>Regras operacionais</h2>
        <div className="grid">{RULES.map(([title, guidance]) => <article className="card" key={title}><h3>{title}</h3><p>{guidance}</p></article>)}</div>
      </section>

      <section>
        <h2>Como ler o resultado</h2>
        <div className="reading">
          <article className="result pass"><b>ALFA POSITIVO</b><p>A tese supera o soberano nas premissas informadas. Ainda é necessário avaliar robustez, margem e dependência do cenário.</p></article>
          <article className="result attention"><b>ALFA PRÓXIMO DE ZERO</b><p>A vantagem pode ser insuficiente diante da incerteza do ativo. Trate como resultado marginal, não como aprovação econômica.</p></article>
          <article className="result fail"><b>ALFA ZERO OU NEGATIVO</b><p>A tese não supera o soberano. O Deep deve reconhecer isso ou justificar, com evidência, por que a investigação continua.</p></article>
        </div>
      </section>

      <div className="foot">Manual operacional HDL F1a. A curva, a interpolação e o alfa são calculados deterministicamente; a interpretação não altera score ou veredito de forma automática.</div>
    </main>
  );
}
