export const maxDuration = 60;

export async function POST(req) {
  try {
    const { assetType, phase, ticker, riUrl, extraCtx, scanSummary } = await req.json();

    const PROMPTS = {
      "scan-fii": "You are a Brazilian FII investment analyst using the NEXO framework. Return ONLY a valid JSON object (no markdown, no explanation). If ticker is invalid return {\"ticker_invalido\":true}. JSON schema: {\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":30,\"score_resumo\":\"string\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string\"}],\"governanca\":[{\"dimensao\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\"]}. Rules: liquidity <R$300k/day=VETO. Governance 5 dims nota 1=VETO. Respond in Portuguese.",

      "scan-acao-br": "You are a Brazilian stock analyst using the NEXO framework. Return ONLY valid JSON (no markdown). If ticker invalid return {\"ticker_invalido\":true}. Auto-detect segment (Utilities/Varejo/Saude/Tech/Industria/Banco/Commodity). JSON: {\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":30,\"score_resumo\":\"string\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string\"}],\"governanca\":[{\"dimensao\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\"]}. Rules: liquidity <R$300k=VETO. Governance 5 dims nota 1=VETO. Respond in Portuguese.",

      "scan-etf-ext": "You are an ETF analyst using the NEXO framework. Return ONLY valid JSON. If invalid return {\"ticker_invalido\":true}. JSON: {\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":25,\"score_resumo\":\"string\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string\"}],\"governanca\":[],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\"]}. Respond in Portuguese.",

      "scan-stock-ext": "You are an international stock analyst using the NEXO framework. Return ONLY valid JSON. If invalid return {\"ticker_invalido\":true}. JSON: {\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":50,\"score_resumo\":\"string\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string\"}],\"governanca\":[{\"dimensao\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\"]}. Respond in Portuguese.",

      "deep-fii": "You are a Brazilian FII deep analyst using NEXO framework. Return ONLY valid JSON. JSON: {\"ticker\":\"string\",\"veredito_final\":\"COMPRAR|MONITORAR|AGUARDAR|EVITAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string\"}],\"modelo_preco\":[{\"camada\":\"string\",\"valor_justo\":\"string\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"string\",\"zona_besst\":\"string\",\"desconto_atual\":\"string\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\"]}. Price model: C1=P/VP Soros cycle, C2=yield spread vs NTN-B, C3=location moat. BESST=15-25% below converged zone. Respond in Portuguese.",

      "deep-acao-br": "You are a Brazilian stock deep analyst using NEXO framework. Return ONLY valid JSON. JSON: {\"ticker\":\"string\",\"veredito_final\":\"COMPRAR|MONITORAR|AGUARDAR|EVITAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string\"}],\"modelo_preco\":[{\"camada\":\"string\",\"valor_justo\":\"string\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"string\",\"zona_besst\":\"string\",\"desconto_atual\":\"string\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\"]}. Apply correct 3-layer model by segment. BESST=15-25% below converged. Respond in Portuguese.",

      "deep-etf-ext": "You are an ETF deep analyst using NEXO framework. Return ONLY valid JSON. JSON: {\"ticker\":\"string\",\"veredito_final\":\"APORTAR|MONITORAR|AGUARDAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string\"}],\"modelo_preco\":[{\"camada\":\"string\",\"valor_justo\":\"string\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"string\",\"zona_besst\":\"string\",\"desconto_atual\":\"string\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\"]}. Focus: total cost, Markowitz diversification, Trilho 1 sizing. Respond in Portuguese.",

      "deep-stock-ext": "You are an international stock deep analyst using NEXO framework. Return ONLY valid JSON. JSON: {\"ticker\":\"string\",\"veredito_final\":\"POSICAO_PLENA|POSICAO_PARCIAL|WATCHLIST|EVITAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string\"}],\"modelo_preco\":[{\"camada\":\"string\",\"valor_justo\":\"string\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"string\",\"zona_besst\":\"string\",\"desconto_atual\":\"string\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\"]}. Respond in Portuguese.",

      "followup": "You are the NEXO investment analyst. Answer the user question concisely with data and numbers. Return JSON: {\"resposta\":\"string in Portuguese with line breaks for readability\"}."
    };

    // Support both "scan"+"fii" and "scan-fii" formats
    const key = (phase + "-" + assetType).replace("followup-", "followup");
    const systemPrompt = PROMPTS[key] || PROMPTS[phase + "-fii"] || PROMPTS["scan-fii"];

    let riContent = "";
    if (riUrl && riUrl.startsWith("http")) {
      try {
        const r = await fetch(riUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(5000)
        });
        const html = await r.text();
        riContent = "\nRI: " + html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2000);
      } catch(e) {}
    }

    const userContent = (scanSummary ? "SCAN:\n" + scanSummary + "\n\n" : "") +
      "Ticker: " + ticker +
      (extraCtx ? "\nFocus: " + extraCtx : "") +
      riContent;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: AbortSignal.timeout(55000),
    });

    const data = await response.json();

    if (data.error) {
      return Response.json({ error: { message: data.error.type + ": " + data.error.message } });
    }

    let raw = (data.content && data.content[0]) ? data.content[0].text : "{}";

    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s !== -1 && e !== -1) raw = raw.slice(s, e + 1);

    raw = raw.replace(/,(\s*[}\]])/g, "$1");

    try {
      return Response.json(JSON.parse(raw));
    } catch(err) {
      return Response.json({ error: { message: "Formato invalido. Tente novamente." } });
    }

  } catch (err) {
    return Response.json({ error: { message: err.message } }, { status: 500 });
  }
}
