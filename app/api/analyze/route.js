export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const SCAN_S = '{"ticker":"","nome":"","segmento":"","veredito":"APROVADO|WATCHLIST|VETADO","motivo_veto":null,"score_total":0,"score_max":30,"score_resumo":"","filtros":[{"nome":"","valor":"","status":"PASS|FAIL","nota":""}],"governanca":[{"dimensao":"","nota":0,"obs":""}],"kpis":[{"nome":"","valor":"","benchmark":"","status":"PASS|FAIL|ALERTA"}],"score_dimensoes":[{"nome":"","nota":0,"obs":""}],"tese":"","catalisadores":[{"descricao":"","prazo":"","impacto":""}],"riscos":[{"descricao":"","severidade":"ALTO|MEDIO|BAIXO","probabilidade":""}],"lacunas_deep":["",""]}';

const DEEP_S = '{"ticker":"","veredito_final":"COMPRAR|MONITORAR|AGUARDAR|EVITAR","lacunas":[{"q":"","r":""}],"preco":[{"c":"C1","vj":"","met":"","prem":""},{"c":"C2","vj":"","met":"","prem":""},{"c":"C3","vj":"","met":"","prem":""}],"zona":"","besst":"","desconto":"","macro":[{"s":"","i":""}],"catalisadores":[{"d":"","p":""}],"riscos":[{"d":"","sev":"ALTO|MEDIO|BAIXO","g":""}],"passos":[""]}';

const INV = '{"ticker_invalido":true}';

const SCANS = {
  "fii":       "NEXO FII analyst. JSON only: " + SCAN_S + " If unknown: " + INV + ". Rules: liq<R$300k=VETO,gov5dims(estrutura/gestor/conselho/auditoria/concentracao)-nota1=VETO,KPIs:P/VP+DY12m+spreadNTN-B+vacancia+prazo,6 score_dims,tese=2lines,2 lacunas. Portuguese.",
  "acao-br":   "NEXO BR stock analyst. JSON only: " + SCAN_S + " If unknown: " + INV + ". detect-segment,liq<R$300k=VETO,gov5dims-nota1=VETO,segment-KPIs,6 score_dims,tese=2lines,2 lacunas. Portuguese.",
  "etf-ext":   "NEXO ETF analyst. JSON only: " + SCAN_S + " score_max=25,governanca=[]. If unknown: " + INV + ". KPIs:TER+TD+AUM+domicilio+ACC/DIST+top10,5 score_dims,tese=2lines,2 lacunas. Portuguese.",
  "stock-ext": "NEXO stock analyst. JSON only: " + SCAN_S + " score_max=50. If unknown: " + INV + ". ADV<1M=VETO,gov4dims,thematic-purity,KPIs-by-theme,6 score_dims,tese=2lines,2 lacunas. Portuguese."
};

const DEEPS = {
  "fii":       "NEXO FII deep analyst. JSON only: " + DEEP_S + " C1=P/VP-Soros,C2=yield-NTN-B,C3=moat. BESST=15-25%below. Answer 2 lacunas concisely. 2 macro. 2 catalisadores. 2 riscos. 2 passos. Portuguese.",
  "acao-br":   "NEXO BR stock deep analyst. JSON only: " + DEEP_S + " Segment model from scan. BESST=15-25%below. Answer 2 lacunas concisely. 2 macro. 2 catalisadores. 2 riscos. 2 passos. Portuguese.",
  "etf-ext":   "NEXO ETF deep analyst. JSON only: " + DEEP_S + " C1=cost,C2=concentration,C3=Markowitz. 2 macro. 2 passos. Portuguese.",
  "stock-ext": "NEXO stock deep analyst. JSON only: " + DEEP_S + " Theme model. Answer 2 lacunas. 2 macro. 2 passos. Portuguese."
};

export async function POST(req) {
  try {
    const body = await req.json();
    const { phase, assetType, ticker, scanSummary, extraCtx, riUrl } = body;

    // If no phase/assetType, it's a direct proxy call (legacy)
    if (!phase || !assetType) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return Response.json(data);
    }

    const systemPrompt = phase === "deep"
      ? (DEEPS[assetType] || DEEPS["fii"])
      : (SCANS[assetType] || SCANS["acao-br"]);

    const userContent = (scanSummary ? "SCAN:" + scanSummary + " " : "") +
      "Analyze: " + ticker +
      (extraCtx ? " Focus: " + extraCtx : "");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await response.json();
    if (data.error) return Response.json({ error: { message: data.error.message } });

    let raw = (data.content && data.content[0]) ? data.content[0].text : "{}";
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s !== -1 && e !== -1) raw = raw.slice(s, e + 1);
    raw = raw.replace(/,(\s*[}\]])/g, "$1");

    try {
      return Response.json(JSON.parse(raw));
    } catch(_) {
      return Response.json({ error: { message: "JSON invalido. Tente novamente." } });
    }

  } catch (err) {
    return Response.json({ error: { message: err.message } }, { status: 500 });
  }
}
