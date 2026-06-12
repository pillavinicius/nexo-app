export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json();
    const assetType = body.assetType || "fii";
    const phase = body.phase || "scan";
    const ticker = body.ticker || "";
    const riUrl = body.riUrl || "";
    const extraCtx = body.extraCtx || "";
    const scanSummary = body.scanSummary || null;

    const JSON_SCAN = "{\"ticker\":\"string\",\"nome\":\"string\",\"segmento\":\"string\",\"veredito\":\"APROVADO|WATCHLIST|VETADO\",\"motivo_veto\":\"string or null\",\"score_total\":0,\"score_max\":30,\"score_resumo\":\"string com 2 linhas de analise\",\"filtros\":[{\"nome\":\"string\",\"valor\":\"string\",\"status\":\"PASS|FAIL\",\"nota\":\"string explicando\"}],\"governanca\":[{\"dimensao\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"kpis\":[{\"nome\":\"string\",\"valor\":\"string\",\"benchmark\":\"string\",\"status\":\"PASS|FAIL|ALERTA\"}],\"score_dimensoes\":[{\"nome\":\"string\",\"nota\":0,\"obs\":\"string\"}],\"tese\":\"string 2-3 linhas sobre disssonancia percepcao x realidade\",\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"probabilidade\":\"string\"}],\"lacunas_deep\":[\"string\",\"string\",\"string\"]}";

    const JSON_DEEP = "{\"ticker\":\"string\",\"veredito_final\":\"COMPRAR|MONITORAR|AGUARDAR|EVITAR\",\"lacunas_respondidas\":[{\"lacuna\":\"string\",\"resposta\":\"string detalhada\"}],\"modelo_preco\":[{\"camada\":\"C1 - metodologia\",\"valor_justo\":\"R$ X,XX\",\"metodologia\":\"string\",\"premissas\":\"string\"},{\"camada\":\"C2 - metodologia\",\"valor_justo\":\"R$ X,XX\",\"metodologia\":\"string\",\"premissas\":\"string\"},{\"camada\":\"C3 - metodologia\",\"valor_justo\":\"R$ X,XX\",\"metodologia\":\"string\",\"premissas\":\"string\"}],\"zona_convergida\":\"R$ X,XX - R$ Y,YY\",\"zona_besst\":\"R$ X,XX - R$ Y,YY (15-25% abaixo)\",\"desconto_atual\":\"X% abaixo/acima da zona BESST\",\"sensibilidade\":[{\"cenario\":\"string\",\"impacto\":\"string\",\"detalhe\":\"string\"}],\"catalisadores\":[{\"descricao\":\"string\",\"prazo\":\"string\",\"impacto\":\"string\"}],\"riscos\":[{\"descricao\":\"string\",\"severidade\":\"ALTO|MEDIO|BAIXO\",\"gatilho\":\"string\"}],\"proximos_passos\":[\"string\",\"string\",\"string\"]}";

    const RULES_FII = "Rules: 1) Liquidez media diaria <R$300k = VETO (filtros status=FAIL, veredito=VETADO). 2) Governanca 0B: avaliar 5 dimensoes obrigatorias: estrutura/regulamento, track record gestor, conselho consultivo, qualidade contabil/auditoria, concentracao risco - nota 1 em qualquer = VETO. 3) KPIs obrigatorios: P/VP atual vs historico, DY 12m, yield spread vs NTN-B (2.5-4pp=saudavel, >5pp=risco ou barato), vacancia fisica (<8% excelente, >15% alerta), prazo medio contratos. 4) score_dimensoes: Liquidez, Governanca, Qualidade Ativos, DY Consistencia, Spread NTN-B, P/VP Ciclo. 5) Preencha TODOS os campos com dados reais estimados.";

    const RULES_ACAO = "Rules: 1) Auto-detect segment from ticker (Utilities/Varejo/Saude/Tech/Industria/Banco/Commodity) and set segmento field. 2) Liquidez <R$300k = VETO. 3) Governanca 0B 5 dims: estrutura/tag-along, independencia conselho, interferencia politica, compliance, auditoria - nota 1 = VETO. 4) Apply segment KPIs: Banco(ROE,NIM,NPL,eficiencia,Basileia), Commodity(C1/C2,ciclo,P/L ciclo), Utilities(P/VP,RAB,FCL), Varejo(SSS,ROIC,ciclo), Saude(sinistralidade,utilizacao), Tech(NRR,Rule40,CAC). 5) score_dimensoes: Governanca, Insider, Qualidade Negocio, Saude Financeira, Valuation, Catalisador. 6) Preencha TODOS os campos.";

    const RULES_ETF = "Rules: 1) KPIs: TER (<0.25% excelente), tracking difference, AUM, domicilio (Irlanda=melhor), ACC vs DIST (ACC preferencial BR), replicacao fisica preferencial, top10 holdings %. 2) score_max=25. 3) score_dimensoes: Eficiencia Fiscal, TER/TD, Liquidez, Diversificacao Real, Fit Portfolio BR. 4) governanca=[]. 5) Preencha TODOS os campos.";

    const RULES_STOCK = "Rules: 1) ADV <US$1M = VETO. OTC Pink = VETO. 2) Governanca: dual-class ok se fundador ativo, board independente, CEO incentivos LT, Big4 se >US$5B, SEC Wells Notice = VETO. 3) Pureza tematica >50% receita. Score IA: enabler/aplicador/ameacado. 4) KPIs por tema: IA/Chips(book-to-bill,capex), SaaS(NRR>110%,Rule40,churn<5%,CAC<18m), Cleantech(LCOE,PPA,TRL), Biotech(rNPV,runway). 5) score_max=50. 6) Preencha TODOS os campos.";

    const RULES_DEEP_FII = "Apply 3-layer price model: C1=P/VP market cycle (Soros reflexivity, <0.85 investigate discount, >1.15 verify moat), C2=Yield spread vs NTN-B current rate (2.5-4pp healthy), C3=Location moat and asset quality (ABL, vacancia, prazo contratos, inquilinos). BESST entry=15-25% below converged zone. Sensibilidade: simulate Selic +200bps and -200bps impact on DY and fair P/VP. Respond to each lacuna identified in Scan. Fill ALL fields with specific numbers.";

    const RULES_DEEP_ACAO = "Apply 3-layer price model for the segment identified in Scan: Utilities(P/VP contabil, reposicao 1.3-1.8xVP, FCL normalizado), Varejo(P/L ciclo, ROIC vs WACC, pricing power), Saude(EV/EBITDA norm, sinistralidade, pricing), Tech(EV/Receita x NRR, CAC payback, FCL horizon), Industria(EV/EBITDA vale, backlog, ROFA), Banco(P/VP Gordon ROE-g/Ke-g, carteira, franchise), Commodity(C1/C2 vs forward, P/L ciclo 7-10a, reposicao). BESST=15-25% below converged. Simulate macro scenarios. Fill ALL fields with specific numbers.";

    const RULES_DEEP_ETF = "3-layer model: C1=Custo total propriedade (TER+spread+IOF+tracking diff), C2=Concentracao real (Markowitz N efetivo, top10%, tech%), C3=Fit Markowitz (Sharpe, correlacao Ibovespa, stress 2008/2020/2022). Sizing Trilho 1. Fill ALL fields.";

    const RULES_DEEP_STOCK = "Apply theme-specific 3-layer model: IA/Chips(P/L ciclo, EV/fab reposicao, book-to-bill forward), SaaS(EV/ARR x Rule40, FCL horizon, valor base instalada), Cleantech(EV/EBITDA capacidade, NPV PPAs, custo MW), Biotech(rNPV pipeline, caixa vs burn, valor plataforma), BigTech(DCF WACC8-10%, EV/FCF, PEG<1.5). Max 5-7% portfolio. Fill ALL fields with specific values.";

    const prompts = {
      "scan-fii":       "You are a Brazilian FII analyst using the NEXO framework. Return ONLY a valid JSON object with no text before or after. If ticker does not exist return {\"ticker_invalido\":true}. " + RULES_FII + " JSON schema: " + JSON_SCAN + " Respond in Portuguese with real estimated data.",
      "scan-acao-br":   "You are a Brazilian stock analyst using the NEXO framework. Return ONLY valid JSON. If ticker invalid return {\"ticker_invalido\":true}. " + RULES_ACAO + " JSON schema: " + JSON_SCAN + " Respond in Portuguese.",
      "scan-etf-ext":   "You are an ETF analyst using the NEXO framework. Return ONLY valid JSON. If invalid return {\"ticker_invalido\":true}. " + RULES_ETF + " JSON schema: " + JSON_SCAN + " Respond in Portuguese.",
      "scan-stock-ext": "You are an international stock analyst using the NEXO framework. Return ONLY valid JSON. If invalid return {\"ticker_invalido\":true}. " + RULES_STOCK + " JSON schema: " + JSON_SCAN + " Respond in Portuguese.",
      "deep-fii":       "You are a Brazilian FII deep analyst using NEXO framework. Return ONLY valid JSON. " + RULES_DEEP_FII + " JSON schema: " + JSON_DEEP + " Respond in Portuguese with specific numbers.",
      "deep-acao-br":   "You are a Brazilian stock deep analyst using NEXO framework. Return ONLY valid JSON. " + RULES_DEEP_ACAO + " JSON schema: " + JSON_DEEP + " Respond in Portuguese with specific numbers.",
      "deep-etf-ext":   "You are an ETF deep analyst using NEXO framework. Return ONLY valid JSON. " + RULES_DEEP_ETF + " JSON schema: " + JSON_DEEP + " Respond in Portuguese.",
      "deep-stock-ext": "You are an international stock deep analyst using NEXO framework. Return ONLY valid JSON. " + RULES_DEEP_STOCK + " JSON schema: " + JSON_DEEP + " Respond in Portuguese.",
    };

    const key = phase + "-" + assetType;
    const systemPrompt = prompts[key] || prompts["scan-fii"];

    let riContent = "";
    if (riUrl && riUrl.startsWith("http")) {
      try {
        const r = await fetch(riUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(5000)
        });
        const html = await r.text();
        riContent = " RI data: " + html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2000);
      } catch(e) {}
    }

    const userContent = (scanSummary ? "SCAN CONTEXT: " + scanSummary + " " : "") +
      "Analyze " + ticker +
      (extraCtx ? " Focus: " + extraCtx : "") +
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
        max_tokens: 4096,
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
