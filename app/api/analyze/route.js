export async function POST(req) {
  try {
    const body = await req.json();
    const { assetType, phase, ticker, riUrl, extraCtx, scanSummary } = body;

    let riContent = "";
    if (riUrl && riUrl.startsWith("http")) {
      try {
        const r = await fetch(riUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(6000)
        });
        const html = await r.text();
        riContent = "\n\nRI DATA:\n" + html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000);
      } catch(e) {}
    }

    const ctx = "Ticker: " + ticker +
      (extraCtx ? "\nContext: " + extraCtx : "") +
      riContent;

    const SCAN = {
      "fii": "You are the NEXO motor for Brazilian FIIs (Real Estate Investment Funds). Respond ONLY with a valid JSON object, no text before or after.\n\nIf ticker does not exist: {\"ticker_invalido\": true}\n\nRequired JSON structure:\n{\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":30,\"score_resumo\":\"string\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string\"}],\"governanca\":[{\"dimensao\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\"]}\n\nRules:\n- Liquidez media diaria < R$300k = VETO (veredito=VETADO)\n- Governanca 0B: 5 dimensions, nota 1 in any = VETO\n- Dimensions: 1.Estrutura/regulamento 2.Track record gestor 3.Conselho consultivo 4.Qualidade contabil 5.Concentracao risco\n- KPIs: P/VP, DY 12m, yield spread vs NTN-B (2.5-4pp healthy), vacancia fisica, prazo contratos\n- Principle: 80% of price = human behavior/cycles. Price history = narrative only\n- Respond in Portuguese",

      "acao-br": "You are the NEXO motor for Brazilian stocks (B3). Respond ONLY with valid JSON, no text before or after.\n\nIf ticker does not exist: {\"ticker_invalido\": true}\n\nAuto-detect segment (Utilities/Varejo/Saude/Tech/Industria/Banco/Commodity) and apply correct KPIs.\n\nRequired JSON:\n{\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":30,\"score_resumo\":\"string\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string\"}],\"governanca\":[{\"dimensao\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\"]}\n\nRules:\n- Liquidity < R$300k/day = VETO\n- Governance 0B: 5 dims, nota 1 = VETO: 1.Estrutura/tag-along 2.Conselho independencia 3.Interferencia politica 4.Compliance 5.Auditoria\n- Insider 0C: buying=alignment, selling=alert\n- Apply segment-specific KPIs\n- Respond in Portuguese",

      "etf-ext": "You are the NEXO motor for Exterior ETFs (Track 1). Respond ONLY with valid JSON.\n\nIf ticker invalid: {\"ticker_invalido\": true}\n\nJSON: {\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":25,\"score_resumo\":\"string\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string\"}],\"governanca\":[],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\"]}\n\nKey KPIs: TER, tracking difference, AUM, domicile (Ireland=preferred), ACC vs DIST, replication method, top10 holdings %. Respond in Portuguese.",

      "stock-ext": "You are the NEXO motor for Exterior Stock Picking (Track 2). Respond ONLY with valid JSON.\n\nIf ticker invalid: {\"ticker_invalido\": true}\n\nJSON: {\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":50,\"score_resumo\":\"string\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string\"}],\"governanca\":[{\"dimensao\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\"]}\n\nThematic purity >50% revenue required. Score IA: enabler/aplicador/ameacado. Respond in Portuguese."
    };

    const DEEP = {
      "fii": "You are the NEXO Deep motor for Brazilian FIIs. Respond ONLY with valid JSON.\n\nJSON: {\"ticker\":\"string\",\"veredito_final\":\"COMPRAR|MONITORAR|AGUARDAR|EVITAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string\"}],\"modelo_preco\":[{\"camada\":\"string\",\"valor_justo\":\"string\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"string\",\"zona_besst\":\"string\",\"desconto_atual\":\"string\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\"]}\n\nPrice model 3 layers: C1=P/VP market cycle (Soros reflexivity), C2=Yield spread vs NTN-B (2.5-4pp healthy), C3=Location moat and asset quality. BESST entry = 15-25% below converged zone. Respond in Portuguese.",

      "acao-br": "You are the NEXO Deep motor for Brazilian stocks. Respond ONLY with valid JSON.\n\nJSON: {\"ticker\":\"string\",\"veredito_final\":\"COMPRAR|MONITORAR|AGUARDAR|EVITAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string\"}],\"modelo_preco\":[{\"camada\":\"string\",\"valor_justo\":\"string\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"string\",\"zona_besst\":\"string\",\"desconto_atual\":\"string\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\"]}\n\nApply correct 3-layer price model by segment. BESST = 15-25% below converged zone. Do NOT repeat Scan filters. Focus on lacunas and price model. Respond in Portuguese.",

      "etf-ext": "You are the NEXO Deep motor for Exterior ETFs. Respond ONLY with valid JSON.\n\nJSON: {\"ticker\":\"string\",\"veredito_final\":\"APORTAR|MONITORAR|AGUARDAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string\"}],\"modelo_preco\":[{\"camada\":\"string\",\"valor_justo\":\"string\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"string\",\"zona_besst\":\"string\",\"desconto_atual\":\"string\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\"]}\n\nFocus: total cost of ownership, real diversification (Markowitz N effective), stress test 2008/2020/2022, Trilho 1 sizing. Respond in Portuguese.",

      "stock-ext": "You are the NEXO Deep motor for Exterior Stock Picking. Respond ONLY with valid JSON.\n\nJSON: {\"ticker\":\"string\",\"veredito_final\":\"POSICAO_PLENA|POSICAO_PARCIAL|WATCHLIST|EVITAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string\"}],\"modelo_preco\":[{\"camada\":\"string\",\"valor_justo\":\"string\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"string\",\"zona_besst\":\"string\",\"desconto_atual\":\"string\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\"]}\n\nApply theme-specific price model (Chips/SaaS/Cleantech/Biotech/BigTech). Max 5-7% portfolio per asset. Respond in Portuguese."
    };

    const FOLLOWUP = "You are the NEXO investment analyst. Answer the user question about the asset objectively and concisely. Return a JSON object: {\"resposta\": \"string with your answer in Portuguese, formatted with line breaks\"}. Be direct, use data and numbers where possible.";

    let systemPrompt, userContent;
    if (phase === "followup") {
      systemPrompt = FOLLOWUP;
      userContent = (scanSummary ? "CONTEXT:\n" + scanSummary + "\n\n" : "") + ctx;
    } else if (phase === "deep") {
      systemPrompt = DEEP[assetType] || DEEP["fii"];
      userContent = "NEXO DEEP analysis for " + ticker + (scanSummary ? "\n\nSCAN SUMMARY:\n" + scanSummary : "") + "\n\n" + ctx;
    } else {
      systemPrompt = SCAN[assetType] || SCAN["fii"];
      userContent = "NEXO SCAN analysis for " + ticker + "\n\n" + ctx;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const responseText = await response.text();
    const data = JSON.parse(responseText);

    if (data.error) {
      return Response.json({ error: { message: data.error.type + ": " + data.error.message } });
    }

    let rawText = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : "{}";

    // Extract JSON
    const jStart = rawText.indexOf("{");
    const jEnd = rawText.lastIndexOf("}");
    if (jStart !== -1 && jEnd !== -1) {
      rawText = rawText.slice(jStart, jEnd + 1);
    }

    // Clean
    rawText = rawText
      .replace(/,\s*\}/g, "}")
      .replace(/,\s*\]/g, "]");

    try {
      const parsed = JSON.parse(rawText);
      return Response.json(parsed);
    } catch(e) {
      return Response.json({ error: { message: "Formato de resposta invalido. Tente novamente." } });
    }

  } catch (err) {
    return Response.json({ error: { message: err.message } }, { status: 500 });
  }
}
