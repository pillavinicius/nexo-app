export const metadata = {
  title: "Mini Manual TDN | NEXO",
  description: "Guia de interpretação do Teste de Defesa Nominal do método NEXO.",
};

const PROFILES = [
  ["Empresa operacional", "Aplicável", "Compara receita real, margem bruta, margem operacional e capital de giro sobre receita."],
  ["Utility regulada", "Aplicável com defasagem", "Observa também o ano seguinte ao choque, pois o reajuste regulatório pode chegar com atraso."],
  ["Commodity exportadora", "Aplicável com ressalva", "Separa a leitura contábil da atribuição entre inflação doméstica, câmbio e preço internacional. Sem atribuição, o teto é Misto."],
  ["Banco ou seguradora", "Não aplicável na v1", "Margem industrial e capital de giro não representam adequadamente o modelo financeiro; nenhum substituto é inventado."],
  ["FII e ativo exterior", "Fora da v1", "Exigem contratos próprios antes de receber uma classificação comparável."],
];

const METRICS = [
  ["Receita real", "Verifica se a receita acumulada superou o IPCA da janela."],
  ["Margem bruta", "Observa quanto da inflação foi absorvido antes das despesas operacionais."],
  ["Margem operacional", "Testa se o repasse sobreviveu à estrutura operacional."],
  ["Capital de giro / receita", "Detecta se defender preços exigiu mais recursos presos na operação."],
];

export default function TdnManualPage() {
  return (
    <main className="manual">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');
        *{box-sizing:border-box}body{margin:0;background:#131008;color:#D4C9A8;font-family:'Inter',sans-serif}.manual{max-width:920px;margin:0 auto;padding:22px 16px 56px}
        .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid #2A2318;padding-bottom:15px;margin-bottom:20px}.brand{font:700 20px 'JetBrains Mono';letter-spacing:3px;color:#E8D5A3}.eyebrow{font:500 8px 'JetBrains Mono';letter-spacing:2px;text-transform:uppercase;color:#6A5C3A;margin-top:5px}.back{font:700 9px 'JetBrains Mono';color:#C9A84C;border:1px solid #6A5C3A;padding:8px 10px;text-decoration:none;text-transform:uppercase;letter-spacing:1px}
        h1{font:700 clamp(22px,5vw,38px) 'JetBrains Mono';color:#E8D5A3;line-height:1.15;margin:0 0 10px}.lead{color:#A89060;line-height:1.7;font-size:14px;max-width:780px;margin:0 0 20px}.formula{border-left:3px solid #C9A84C;background:rgba(201,168,76,.06);padding:14px;line-height:1.65;font-size:13px}.formula b{display:block;color:#E8D5A3;font:700 12px 'JetBrains Mono';margin-bottom:5px}
        section{margin-top:28px}h2{font:700 11px 'JetBrains Mono';letter-spacing:2px;text-transform:uppercase;color:#C9A84C;border-bottom:1px solid #2A2318;padding-bottom:8px;margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.card{border:1px solid #2A2318;padding:13px}.card h3{font:700 11px 'JetBrains Mono';color:#E8D5A3;margin:0 0 7px}.card p{font-size:12px;line-height:1.6;color:#8A7A58;margin:0}
        .table-wrap{overflow-x:auto;border:1px solid #2A2318}table{width:100%;border-collapse:collapse;min-width:660px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #2A2318;padding:11px 12px}th{font:700 8px 'JetBrains Mono';letter-spacing:1px;text-transform:uppercase;color:#6A5C3A}td{font-size:12px;line-height:1.55;color:#8A7A58}td:first-child{font:700 11px 'JetBrains Mono';color:#E8D5A3;width:180px}td:nth-child(2){font:700 9px 'JetBrains Mono';color:#C9A84C;width:160px}tr:last-child td{border-bottom:0}.notice{border-left:3px solid #D2A03C;background:rgba(210,160,60,.06);padding:12px 14px;color:#A89060;line-height:1.65;font-size:12px;margin-top:12px}.foot{margin-top:30px;border-top:1px solid #2A2318;padding-top:12px;font:400 9px 'JetBrains Mono';color:#4A3E28;line-height:1.6}
        @media(max-width:640px){.grid{grid-template-columns:1fr}.top{align-items:stretch;flex-direction:column}.back{text-align:center}}
      `}</style>
      <header className="top"><div><div className="brand">NEXO</div><div className="eyebrow">Mini manual · TDN v1.0</div></div><a className="back" href="/">Voltar ao aplicativo</a></header>
      <h1>Como ler o Teste de Defesa Nominal</h1>
      <p className="lead">O TDN verifica, com demonstrações financeiras conhecidas em cada data, se a empresa protegeu sua economia real durante choques inflacionários. Ele testa comportamento observado; não presume proteção pela fama do setor.</p>
      <div className="formula"><b>J1 · 2015–2016 &nbsp; | &nbsp; J2 · 2021–2022</b>As duas janelas são obrigatórias. Cobertura parcial produz “dados insuficientes”, nunca um score estimado.</div>
      <section><h2>O que o servidor mede</h2><div className="grid">{METRICS.map(([title,text])=><article className="card" key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section><h2>Tratamento por perfil econômico</h2><div className="table-wrap"><table><thead><tr><th>Perfil</th><th>Condição</th><th>Tratamento</th></tr></thead><tbody>{PROFILES.map(([profile,status,text])=><tr key={profile}><td>{profile}</td><td>{status}</td><td>{text}</td></tr>)}</tbody></table></div></section>
      <section><h2>Como interpretar</h2><div className="grid"><article className="card"><h3>Defesa real</h3><p>O conjunto de métricas preservou capacidade econômica nas duas janelas.</p></article><article className="card"><h3>Misto</h3><p>A proteção foi parcial, desigual entre métricas/janelas ou não pôde ser atribuída com segurança.</p></article><article className="card"><h3>Defesa nominal</h3><p>O crescimento nominal não se converteu em preservação econômica suficiente.</p></article><article className="card"><h3>Dados insuficientes</h3><p>Falta cobertura compatível; o motor se abstém em vez de preencher a lacuna por inferência.</p></article></div><div className="notice"><strong>Governança:</strong> o código calcula e a IA interpreta. O TDN não altera automaticamente o score nem o veredito global do Deep.</div></section>
      <div className="foot">Fonte histórica: DFP/CVM versionada com controle point-in-time. Atualização por coletor offline; nenhuma coleta ocorre durante a análise na Vercel.</div>
    </main>
  );
}
