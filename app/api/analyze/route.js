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

    const userContent = (scanSummary ? "SCAN:" + scanSummary + " " : "") +
      ticker +
      (extraCtx ? " " + extraCtx : "") +
      riContent;

    // Compact JSON schemas
    const SCAN_SCHEMA = '{"ticker":"","nome":"","segmento":"","veredito":"APROVADO|WATCHLIST|VETADO","motivo_veto":null,"score_total":0,"score_max":30,"score_resumo":"","filtros":[{"nome":"","valor":"","status":"PASS|FAIL","nota":""}],"governanca":[{"dimensao":"","nota":0,"obs":""}],"kpis":[{"nome":"","valor":"","benchmark":"","status":"PASS|FAIL|ALERTA"}],"score_dimensoes":[{"nome":"","nota":0,"obs":""}],"tese":"","catalisadores":[{"descricao":"","prazo":"","impacto":""}],"riscos":[{"descricao":"","severidade":"ALTO|MEDIO|BAIXO","probabilidade":""}],"lacunas_deep":["","",""]}';

    const DEEP_SCHEMA = '{"ticker":"","veredito_final":"COMPRAR|MONITORAR|AGUARDAR|EVITAR","lacunas_respondidas":[{"lacuna":"","resposta":""}],"modelo_preco":[{"camada":"C1","valor_justo":"","metodologia":"","premissas":""},{"camada":"C2","valor_justo":"","metodologia":"","premissas":""},{"camada":"C3","valor_justo":"","metodologia":"","premissas":""}],"zona_convergida":"","zona_besst":"","desconto_atual":"","sensibilidade":[{"cenario":"","impacto":"","detalhe":""}],"catalisadores":[{"descricao":"","prazo":"","impacto":""}],"riscos":[{"descricao":"","severidade":"ALTO|MEDIO|BAIXO","gatilho":""}],"proximos_passos":["","",""]}';

    const systems = {
      "scan-fii": "NEXO FII analyst. Return ONLY JSON matching this schema: " + SCAN_SCHEMA + " Rules: liquidity<R$300k=VETO. Governance 5 dims(estrutura,gestor,conselho,auditoria,concentracao) nota1=VETO. KPIs: P/VP,DY12m,spread-NTN-B(2.5-4pp=ok),vacancia,prazo-contratos. score_dimensoes 6 items. tese=2 lines perception vs reality. 3 lacunas_deep. Respond Portuguese. Be concise.",

      "scan-acao-br": "NEXO BR stock analyst. Return ONLY JSON: " + SCAN_SCHEMA + " Rules: detect segment(Utilities/Varejo/Saude/Tech/Industria/Banco/Commodity) set segmento. liquidity<R$300k=VETO. Gov5dims nota1=VETO. Segment KPIs. score_dimensoes 6 items. tese=2 lines. 3 lacunas_deep. Portuguese. Concise.",

      "scan-etf-ext": "NEXO ETF analyst. Return ONLY JSON: " + SCAN_SCHEMA + " score_max=25. governanca=[]. KPIs: TER,tracking-diff,AUM,domicilio,ACC/DIST,replicacao,top10%. score_dimensoes 5 items. Portuguese. Concise.",

      "scan-stock-ext": "NEXO intl stock analyst. Return ONLY JSON: " + SCAN_SCHEMA + " score_max=50. ADV<1M=VETO. Gov: board,CEO-incentives,Big4,Wells-Notice=VETO. Thematic purity>50%. KPIs by theme. Portuguese. Concise.",

      "deep-fii": "NEXO FII deep analyst. Return ONLY JSON: " + DEEP_SCHEMA + " 3-layer model: C1=P/VP-Soros-cycle, C2=yield-spread-NTN-B, C3=location-moat. BESST=15-25%below. Selic+-200bps sensitivity. Answer each lacuna. Specific numbers. Portuguese.",

      "deep-acao-br": "NEXO BR stock deep analyst. Return ONLY JSON: " + DEEP_SCHEMA + " Apply segment model from scan context. BESST=15-25%below. Macro scenarios. Answer each lacuna. Specific numbers. Portuguese.",

      "deep-etf-ext": "NEXO ETF deep analyst. Return ONLY JSON: " + DEEP_SCHEMA + " C1=total-cost, C2=concentration-risk, C3=Markowitz-fit. Trilho1 sizing. Portuguese.",

      "deep-stock-ext": "NEXO intl stock deep analyst. Return ONLY JSON: " + DEEP_SCHEMA + " Theme price model. Max5-7%portfolio. Answer each lacuna. Portuguese.",
    };

    const systemPrompt = systems[phase + "-" + assetType] || systems["scan-fii"];

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
      return Response.json({ error: { message: "JSON invalido. Tente novamente." } });
    }

  } catch (err) {
    return Response.json({ error: { message: err.message } }, { status: 500 });
  }
}
