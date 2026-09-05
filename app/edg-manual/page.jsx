import {
  EDGE_INSUMO_METADATA,
  EDGE_TYPE_DESCRIPTIONS,
} from "../../lib/ui/edg_form_adapter.mjs";

export const metadata = {
  title: "Mini Manual EDG | NEXO",
  description: "Guia de preenchimento da Declaração e Governança do Edge do método NEXO.",
};

const TYPES = [
  ["Informacional", "informacional", "Use quando existe informação pública material que ainda não foi incorporada ou foi interpretada de forma incompleta."],
  ["Analítico", "analitico", "Use quando os mesmos dados levam o método NEXO a uma conclusão diferente, reproduzível e comparável."],
  ["Estrutural", "estrutural", "Use quando uma restrição objetiva, como mandato, perímetro ou vendedor forçado, produz a distorção."],
  ["Temporal", "temporal", "Use quando a diferença está no horizonte necessário para a tese se realizar, e não em informação exclusiva."],
  ["Nenhum", "nenhum", "Use quando ainda não existe vantagem verificável. É uma declaração válida e ativa o teto de Watchlist pela regra D2."],
];

const STEPS = [
  ["1", "Escolha o tipo", "Defina de onde vem a vantagem: informação, análise, estrutura ou horizonte."],
  ["2", "Escolha o insumo", "Selecione o módulo NEXO que lastreia a declaração. Não escolha apenas porque o nome parece relacionado."],
  ["3", "Monte a evidência", "Combine um padrão de evidência, uma base objetiva e uma janela de observação."],
  ["4", "Defina a expiração", "Escolha uma métrica com limite e persistência, um evento confirmável ou uma data-limite."],
  ["5", "Execute o Scan", "A validação determinística só aparece depois que o servidor processa o contrato."],
];

const ACTIVE_INPUTS = Object.entries(EDGE_INSUMO_METADATA).filter(([, item]) => item.available);

export default function EdgManualPage() {
  return (
    <main className="manual">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');
        *{box-sizing:border-box} body{margin:0;background:#131008;color:#D4C9A8;font-family:'Inter',sans-serif}
        .manual{max-width:880px;margin:0 auto;padding:22px 16px 56px}
        .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid #2A2318;padding-bottom:15px;margin-bottom:20px}
        .brand{font:700 20px 'JetBrains Mono',monospace;letter-spacing:3px;color:#E8D5A3}.eyebrow{font:500 8px 'JetBrains Mono',monospace;letter-spacing:2px;text-transform:uppercase;color:#6A5C3A;margin-top:5px}
        .back{font:700 9px 'JetBrains Mono',monospace;color:#C9A84C;border:1px solid #6A5C3A;padding:8px 10px;text-decoration:none;text-transform:uppercase;letter-spacing:1px}
        h1{font:700 clamp(22px,5vw,38px) 'JetBrains Mono',monospace;color:#E8D5A3;line-height:1.15;margin:0 0 10px} .lead{color:#A89060;line-height:1.7;font-size:14px;max-width:720px;margin:0 0 24px}
        .notice{border-left:3px solid #C9A84C;background:rgba(201,168,76,.06);padding:12px 14px;color:#D4C9A8;line-height:1.65;font-size:13px;margin-bottom:24px}
        section{margin-top:28px} h2{font:700 11px 'JetBrains Mono',monospace;letter-spacing:2px;text-transform:uppercase;color:#C9A84C;border-bottom:1px solid #2A2318;padding-bottom:8px;margin:0 0 12px}
        .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.card{border:1px solid #2A2318;padding:13px;min-width:0}.card h3{font:700 12px 'JetBrains Mono',monospace;color:#E8D5A3;margin:0 0 7px}.card p{font-size:12px;line-height:1.6;color:#8A7A58;margin:0;overflow-wrap:anywhere}
        .steps{display:grid;gap:8px}.step{display:grid;grid-template-columns:32px 160px 1fr;gap:11px;align-items:start;border:1px solid #2A2318;padding:11px}.num{font:700 13px 'JetBrains Mono',monospace;color:#C9A84C}.step strong{font:700 11px 'JetBrains Mono',monospace;color:#E8D5A3}.step span:last-child{font-size:12px;color:#8A7A58;line-height:1.55}
        .example{border:1px solid #2A2318;padding:14px;margin-bottom:9px}.good{border-left:3px solid #6DB46D}.bad{border-left:3px solid #C87070}.tag{font:700 8px 'JetBrains Mono',monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:7px}.good .tag{color:#6DB46D}.bad .tag{color:#C87070}.example p{margin:4px 0;color:#A89060;font-size:12px;line-height:1.6}.example strong{color:#E8D5A3}
        .rules{display:grid;grid-template-columns:1fr 1fr;gap:9px}.rule{border:1px solid #2A2318;padding:14px}.rule b{font:700 14px 'JetBrains Mono',monospace;color:#C9A84C}.rule p{font-size:12px;line-height:1.6;color:#8A7A58;margin:7px 0 0}
        .foot{margin-top:30px;border-top:1px solid #2A2318;padding-top:12px;font:400 9px 'JetBrains Mono',monospace;color:#4A3E28;line-height:1.6}
        @media(max-width:640px){.grid,.rules{grid-template-columns:1fr}.step{grid-template-columns:28px 1fr}.step span:last-child{grid-column:2}.top{align-items:stretch;flex-direction:column}.back{text-align:center}}
      `}</style>

      <header className="top">
        <div><div className="brand">NEXO</div><div className="eyebrow">Mini manual · EDG v1.0</div></div>
        <a className="back" href="/">Voltar ao aplicativo</a>
      </header>

      <h1>Como declarar um Edge útil</h1>
      <p className="lead">O EDG transforma uma hipótese em um contrato verificável. Ele não inventa uma vantagem e não melhora uma classificação por si só: registra o que diferencia a tese, qual dado sustenta essa diferença e o que faria a vantagem deixar de existir.</p>
      <div className="notice"><strong>Regra prática:</strong> se você não consegue apontar uma evidência verificável e uma condição observável de expiração, selecione “Nenhum edge declarado”. Isso evita que convicção seja confundida com evidência.</div>

      <section>
        <h2>Preenchimento em cinco passos</h2>
        <div className="steps">{STEPS.map(([number, title, text]) => <div className="step" key={number}><span className="num">{number}</span><strong>{title}</strong><span>{text}</span></div>)}</div>
      </section>

      <section>
        <h2>Qual tipo escolher</h2>
        <div className="grid">{TYPES.map(([label, key, guidance]) => <article className="card" key={key}><h3>{label}</h3><p>{EDGE_TYPE_DESCRIPTIONS[key]}</p><p style={{marginTop:7}}><strong>Quando usar:</strong> {guidance}</p></article>)}</div>
      </section>

      <section>
        <h2>Como escolher o insumo</h2>
        <p className="lead">O insumo é o módulo que lastreia a evidência. Escolha aquele cuja saída realmente pode ser consultada para confirmar ou negar a declaração.</p>
        <div className="grid">{ACTIVE_INPUTS.map(([code, item]) => <article className="card" key={code}><h3>{code}</h3><p>{item.description}</p></article>)}</div>
      </section>

      <section>
        <h2>Evidência verificável</h2>
        <div className="example good"><div className="tag">Estrutura adequada</div><p><strong>Padrão:</strong> a diferença que está sendo observada.</p><p><strong>Base:</strong> documento, série, benchmark ou resultado versionado.</p><p><strong>Janela:</strong> o período exato em que a comparação vale.</p></div>
        <div className="example bad"><div className="tag">Evite</div><p>“A empresa é boa”, “o preço está barato”, “o mercado está errado” ou qualquer frase que não indique como a afirmação pode ser conferida.</p></div>
      </section>

      <section>
        <h2>Condição observável de expiração</h2>
        <div className="example good"><div className="tag">Exemplos de formato</div><p><strong>Métrica:</strong> margem cruza um limite por dois trimestres consecutivos.</p><p><strong>Evento:</strong> contrato material é rescindido em fonte oficial.</p><p><strong>Prazo:</strong> catalisador não é confirmado documentalmente até a data definida.</p></div>
        <div className="example bad"><div className="tag">Evite</div><p>“Se piorar”, “se a tese mudar” ou “quando o mercado perceber”. Essas frases não possuem gatilho objetivo nem momento auditável.</p></div>
      </section>

      <section>
        <h2>Regras de governança</h2>
        <div className="rules"><article className="rule"><b>D2</b><p>Sem edge declarado e verificável, o Scan fica limitado a Watchlist e as etapas seguintes não podem emitir classificação favorável acima desse teto.</p></article><article className="rule"><b>D3</b><p>Quando o edge está expirado, o sinal de saída tem precedência sobre uma leitura favorável de preço.</p></article></div>
      </section>

      <div className="foot">Manual operacional do contrato EDG. As opções guiadas organizam a declaração; a validação determinística ocorre no servidor após o Scan.</div>
    </main>
  );
}
