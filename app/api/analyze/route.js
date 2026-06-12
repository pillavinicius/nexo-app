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

    const SCAN_PROMPT = "You are the NEXO investment analyst. Auto-detect the asset type and segment from the ticker: BR FII, BR stock (Utilities/Varejo/Saude/Tech/Industria/Banco/Commodity), international ETF, or international stock. If ticker does not exist return {\"ticker_invalido\":true}. Return ONLY valid JSON matching this schema: " + SCAN_SCHEMA + " Rules by type: FII(liquidity<R$300k=VETO,Gov5dims,KPIs:P/VP,DY12m,spread-NTN-B,vacancia,prazo-contratos), BR-stock(liquidity<R$300k=VETO,Gov5dims,segment-KPIs), ETF(KPIs:TER,tracking-diff,AUM,domicilio,ACC/DIST,score_max=25,governanca=[]), Intl-stock(ADV<1M=VETO,Gov:board/CEO/Big4/Wells-Notice,thematic-purity,score_max=50). Always: score_dimensoes 5-6 items, tese=2 lines perception-vs-reality, 3 lacunas_deep. Respond in Portuguese. Be concise.";

    const DEEP_PROMPT = "You are the NEXO deep analyst. Return ONLY valid JSON: " + DEEP_SCHEMA + " Use scan context to apply correct price model. FII: C1=P/VP-cycle,C2=yield-spread-NTN-B,C3=moat. BR-stock: C1/C2/C3 by segment. ETF: C1=cost,C2=concentration,C3=Markowitz. Intl: theme-model. BESST=15-25%below-zone. Answer each lacuna with specific numbers. Max 2 sensibilidade scenarios. Max 3 proximos_passos. Respond Portuguese. Be very concise.";

    const systemPrompt = phase === "deep" ? DEEP_PROMPT : SCAN_PROMPT;

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
