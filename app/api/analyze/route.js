export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json();
    const assetType = body.assetType || "fii";
    const phase = body.phase || "scan";
    const ticker = body.ticker || "";
    const extraCtx = body.extraCtx || "";
    const scanSummary = body.scanSummary || null;

    let riContent = "";
    if (body.riUrl && body.riUrl.startsWith("http")) {
      try {
        const r = await fetch(body.riUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(4000)
        });
        const html = await r.text();
        riContent = " RI:" + html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1000);
      } catch(e) {}
    }

    const userContent = "Analyze ticker: " + ticker +
      (extraCtx ? " Focus: " + extraCtx : "") +
      (scanSummary ? " SCAN_CONTEXT:" + scanSummary : "") +
      riContent;

    // Compact JSON schemas
    const SCAN_SCHEMA = '{"ticker":"","nome":"","segmento":"","veredito":"APROVADO|WATCHLIST|VETADO","motivo_veto":null,"score_total":0,"score_max":30,"score_resumo":"","filtros":[{"nome":"","valor":"","status":"PASS|FAIL","nota":""}],"governanca":[{"dimensao":"","nota":0,"obs":""}],"kpis":[{"nome":"","valor":"","benchmark":"","status":"PASS|FAIL|ALERTA"}],"score_dimensoes":[{"nome":"","nota":0,"obs":""}],"tese":"","catalisadores":[{"descricao":"","prazo":"","impacto":""}],"riscos":[{"descricao":"","severidade":"ALTO|MEDIO|BAIXO","probabilidade":""}],"lacunas_deep":["","",""]}';

    const DEEP_SCHEMA = '{"ticker":"","veredito_final":"COMPRAR|MONITORAR|AGUARDAR|EVITAR","lacunas_respondidas":[{"lacuna":"","resposta":""}],"modelo_preco":[{"camada":"C1","valor_justo":"","metodologia":"","premissas":""},{"camada":"C2","valor_justo":"","metodologia":"","premissas":""},{"camada":"C3","valor_justo":"","metodologia":"","premissas":""}],"zona_convergida":"","zona_besst":"","desconto_atual":"","sensibilidade":[{"cenario":"","impacto":"","detalhe":""}],"catalisadores":[{"descricao":"","prazo":"","impacto":""}],"riscos":[{"descricao":"","severidade":"ALTO|MEDIO|BAIXO","gatilho":""}],"proximos_passos":["","",""]}';

    const S = SCAN_SCHEMA;
    const D = DEEP_SCHEMA;
    var INVALID = '{"ticker_invalido":true}';
    const scans = {
      "fii":       "NEXO FII analyst. JSON only: " + S + " If unknown return " + INVALID + ". Rules: liq<R$300k=VETO,gov5dims-nota1=VETO,KPIs:P/VP+DY12m+spreadNTN-B+vacancia+prazo,6 score_dims,tese=2lines,3 lacunas. Portuguese.",
      "acao-br":   "NEXO BR stock analyst. JSON only: " + S + " If unknown return " + INVALID + ". detect-segment,liq<R$300k=VETO,gov5dims-nota1=VETO,segment-KPIs,6 score_dims,tese=2lines,3 lacunas. Portuguese.",
      "etf-ext":   "NEXO ETF analyst. JSON only: " + S + " score_max=25,governanca=[]. If unknown return " + INVALID + ". KPIs:TER+TD+AUM+domicilio+ACC/DIST+top10,5 score_dims,tese=2lines,2 lacunas. Portuguese.",
      "stock-ext": "NEXO stock analyst. JSON only: " + S + " score_max=50. If unknown return " + INVALID + ". ADV<1M=VETO,gov(board+CEO+Big4+Wells=VETO),thematic-purity>50%,KPIs-by-theme,6 score_dims,tese=2lines,3 lacunas. Portuguese.",
    };
    const deeps = {
      "fii":       "NEXO FII deep. JSON only: " + D + " C1=P/VP-Soros,C2=yield-NTN-B,C3=moat. BESST=15-25%below. Answer lacunas. 2 sensib. 3 steps. Portuguese.",
      "acao-br":   "NEXO BR stock deep. JSON only: " + D + " Segment model from context. BESST=15-25%below. Answer lacunas. 2 sensib. 3 steps. Portuguese.",
      "etf-ext":   "NEXO ETF deep. JSON only: " + D + " C1=cost,C2=concentration,C3=Markowitz. Trilho1 sizing. 2 sensib. 3 steps. Portuguese.",
      "stock-ext": "NEXO stock deep. JSON only: " + D + " Theme model. Max5-7%portfolio. Answer lacunas. 2 sensib. 3 steps. Portuguese.",
    };
    const systemPrompt = phase === "deep"
      ? (deeps[assetType] || deeps["fii"])
      : (scans[assetType] || scans["acao-br"]);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: AbortSignal.timeout(50000),
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
    } catch(err) {
      return Response.json({ error: { message: "JSON truncado. Tente novamente." } });
    }

  } catch (err) {
    return Response.json({ error: { message: err.message } }, { status: 500 });
  }
}
