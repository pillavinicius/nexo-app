export async function POST(req) {
  try {
    const { assetType, phase, ticker, riUrl, extraCtx, userPrompt, scanSummary } = await req.json();

    // Fetch RI page if URL provided
    let riContent = "";
    if (riUrl && riUrl.startsWith("http")) {
      try {
        const r = await fetch(riUrl, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
        const html = await r.text();
        // Strip HTML tags, keep text
        riContent = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 4000);
        riContent = `\n\nDADOS DO RI (${riUrl}):\n${riContent}`;
      } catch(e) {
        riContent = `\n\n[Não foi possível acessar o RI: ${e.message}]`;
      }
    }

    const context = `Ticker: ${ticker}${extraCtx ? `\nContexto: ${extraCtx}` : ""}${riContent}`;

    const SCAN_SYSTEM = {
      fii: `Você é o motor NEXO para FIIs. Retorne APENAS um objeto JSON válido, sem texto antes ou depois.

Se o ticker não existir: {"ticker_invalido": true}

JSON de saída obrigatório:
{
  "ticker": "string",
  "nome": "string",
  "segmento": "FII Tijolo|Papel|Híbrido · subsetor",
  "veredito": "APROVADO|WATCHLIST|VETADO",
  "motivo_veto": "string ou null",
  "score_total": number,
  "score_max": 30,
  "score_resumo": "string curta",
  "filtros": [{"nome":"Liquidez média diária","valor":"R$ X mil","status":"PASS|FAIL","nota":"string"}],
  "governanca": [{"dimensao":"string","nota":0-5,"obs":"string"}],
  "kpis": [{"nome":"string","valor":"string","benchmark":"string","status":"PASS|FAIL|ALERTA"}],
  "score_dimensoes": [{"nome":"string","nota":0-5,"obs":"string"}],
  "tese": "string — dissonância percepção x realidade em 2 linhas",
  "catalisadores": [{"descricao":"string","prazo":"string","impacto":"string"}],
  "riscos": [{"descricao":"string","severidade":"ALTO|MEDIO|BAIXO","probabilidade":"string"}],
  "lacunas_deep": ["string","string","string"]
}

Governança 0B — 5 dimensões obrigatórias:
1. Tipo/estrutura/regulamento do fundo
2. Track record e qualidade do gestor
3. Independência conselho consultivo
4. Qualidade contábil/auditoria
5. Concentração de risco (ativo/inquilino)
Nota 1 = VETO IMEDIATO → veredito="VETADO"

Liquidez < R$300k/dia = VETO IMEDIATO

KPIs obrigatórios: P/VP atual, DY 12m, Yield spread vs NTN-B (2,5-4pp=saudável), vacância física, prazo médio contratos.

Princípio 80/20: 80% do preço = comportamento humano/ciclos. Histórico de preço = narrativa, nunca parâmetro de barato/caro.`,

      "acao-br": `Você é o motor NEXO para Ações BR. Retorne APENAS um objeto JSON válido, sem texto antes ou depois.

Se o ticker não existir na B3: {"ticker_invalido": true}

Detecte o segmento automaticamente (Utilities/Varejo/Saúde/Tech/Indústria/Banco/Commodity) e aplique os KPIs corretos.

JSON de saída:
{
  "ticker": "string",
  "nome": "string",
  "segmento": "string — setor B3 detectado",
  "veredito": "APROVADO|WATCHLIST|VETADO",
  "motivo_veto": "string ou null",
  "score_total": number,
  "score_max": 30,
  "score_resumo": "string",
  "filtros": [{"nome":"string","valor":"string","status":"PASS|FAIL","nota":"string"}],
  "governanca": [{"dimensao":"string","nota":0-5,"obs":"string"}],
  "kpis": [{"nome":"string","valor":"string","benchmark":"string","status":"PASS|FAIL|ALERTA"}],
  "score_dimensoes": [{"nome":"string","nota":0-5,"obs":"string"}],
  "tese": "string — dissonância percepção x realidade",
  "catalisadores": [{"descricao":"string","prazo":"string","impacto":"string"}],
  "riscos": [{"descricao":"string","severidade":"ALTO|MEDIO|BAIXO","probabilidade":"string"}],
  "lacunas_deep": ["string","string","string"]
}

Governança 0B — 5 dimensões:
1. Estrutura/tag along (mín 80%)
2. Independência conselho (>30%)
3. Ingerência política/estatal
4. Compliance/risco corrupção
5. Qualidade contábil/auditoria Big4
Nota 1 = VETO → veredito="VETADO"

Liquidez < R$300k/dia = VETO

KPIs por segmento:
Banco: ROE vs Ke, NIM, NPL >90d, índice eficiência, Basileia
Commodity: custo C1/C2 posição curva, ciclo 7-10a, P/L ciclo
Utilities: P/VP, RAB, WACC regulatório, FCL normalizado
Varejo: SSS, ROIC vs WACC, ciclo estoque
Saúde: sinistralidade, utilização, ticket médio
Tech/SaaS: NRR, Rule of 40, CAC payback, churn
Indústria: backlog 12-18m, ROFA`,

      "etf-ext": `Você é o motor NEXO para ETFs Exterior (Trilho 1). Retorne APENAS JSON válido.

Se o ticker não existir: {"ticker_invalido": true}

JSON:
{
  "ticker": "string",
  "nome": "string",
  "segmento": "ETF Irlandês ACC|DIST · índice replicado",
  "veredito": "APROVADO|WATCHLIST|VETADO",
  "motivo_veto": "string ou null",
  "score_total": number,
  "score_max": 25,
  "score_resumo": "string",
  "filtros": [{"nome":"string","valor":"string","status":"PASS|FAIL","nota":"string"}],
  "governanca": [],
  "kpis": [{"nome":"string","valor":"string","benchmark":"string","status":"PASS|FAIL|ALERTA"}],
  "score_dimensoes": [{"nome":"string","nota":0-5,"obs":"string"}],
  "tese": "string — adequação ao Trilho 1",
  "catalisadores": [{"descricao":"string","prazo":"string","impacto":"string"}],
  "riscos": [{"descricao":"string","severidade":"ALTO|MEDIO|BAIXO","probabilidade":"string"}],
  "lacunas_deep": ["string","string"]
}

KPIs obrigatórios: TER, tracking difference, AUM, domicílio, replicação física/sintética, ACC vs DIST, top 10 holdings %, exposição tech %.`,

      "stock-ext": `Você é o motor NEXO para Stock Picking Exterior (Trilho 2). Retorne APENAS JSON válido.

Se o ticker não existir: {"ticker_invalido": true}

JSON:
{
  "ticker": "string",
  "nome": "string",
  "segmento": "tema: IA/Chips|SaaS|Cleantech|Biotech|Big Tech",
  "veredito": "APROVADO|WATCHLIST|VETADO",
  "motivo_veto": "string ou null",
  "score_total": number,
  "score_max": 50,
  "score_resumo": "string",
  "filtros": [{"nome":"string","valor":"string","status":"PASS|FAIL","nota":"string"}],
  "governanca": [{"dimensao":"string","nota":0-5,"obs":"string"}],
  "kpis": [{"nome":"string","valor":"string","benchmark":"string","status":"PASS|FAIL|ALERTA"}],
  "score_dimensoes": [{"nome":"string","nota":0-5,"obs":"string"}],
  "tese": "string — Conviction x Qualidade",
  "catalisadores": [{"descricao":"string","prazo":"string","impacto":"string"}],
  "riscos": [{"descricao":"string","severidade":"ALTO|MEDIO|BAIXO","probabilidade":"string"}],
  "lacunas_deep": ["string","string","string"]
}`
    };

    const DEEP_SYSTEM = {
      fii: `Você é o motor NEXO Deep para FIIs. Retorne APENAS JSON válido.

JSON:
{
  "ticker": "string",
  "veredito_final": "COMPRAR|MONITORAR|AGUARDAR|EVITAR",
  "lacunas_respondidas": [{"lacuna":"string","resposta":"string"}],
  "modelo_preco": [
    {"camada":"C1 · P/VP","valor_justo":"string","metodologia":"string","premissas":"string"},
    {"camada":"C2 · Yield Spread NTN-B","valor_justo":"string","metodologia":"string","premissas":"string"},
    {"camada":"C3 · Moat/Ativos","valor_justo":"string","metodologia":"string","premissas":"string"}
  ],
  "zona_convergida": "R$ X,XX – R$ Y,YY",
  "zona_besst": "R$ X,XX – R$ Y,YY (15-25% abaixo)",
  "desconto_atual": "X% abaixo|acima da zona BESST",
  "sensibilidade": [
    {"cenario":"Selic -200bps","impacto":"string","detalhe":"string"},
    {"cenario":"Selic base","impacto":"string","detalhe":"string"},
    {"cenario":"Selic +200bps","impacto":"string","detalhe":"string"}
  ],
  "catalisadores": [{"descricao":"string","prazo":"string","impacto":"string"}],
  "riscos": [{"descricao":"string","severidade":"ALTO|MEDIO|BAIXO","gatilho":"string"}],
  "proximos_passos": ["string","string","string"]
}`,

      "acao-br": `Você é o motor NEXO Deep para Ações BR. Retorne APENAS JSON válido.

Aplique o modelo de preço correto pelo segmento do Scan:
- Utilities: C1=P/VP contábil, C2=Valor reposição 1,3-1,8x VP, C3=FCL normalizado
- Varejo: C1=P/L ciclo, C2=ROIC vs WACC, C3=Pricing power
- Saúde: C1=EV/EBITDA norm, C2=Sinistralidade/utilização, C3=Pricing power
- Tech: C1=EV/Receita×NRR, C2=CAC payback, C3=FCL break-even
- Indústria: C1=EV/EBITDA ciclo, C2=Backlog, C3=ROFA
- Banco: C1=P/VP Gordon (ROE-g)/(Ke-g), C2=Qualidade carteira, C3=Franchise
- Commodity: C1=C1/C2 vs forward, C2=P/L ciclo 7-10a, C3=EV/Reposição

JSON:
{
  "ticker": "string",
  "veredito_final": "COMPRAR|MONITORAR|AGUARDAR|EVITAR",
  "lacunas_respondidas": [{"lacuna":"string","resposta":"string"}],
  "modelo_preco": [
    {"camada":"C1 · metodologia","valor_justo":"string","metodologia":"string","premissas":"string"},
    {"camada":"C2 · metodologia","valor_justo":"string","metodologia":"string","premissas":"string"},
    {"camada":"C3 · metodologia","valor_justo":"string","metodologia":"string","premissas":"string"}
  ],
  "zona_convergida": "R$ X,XX – R$ Y,YY",
  "zona_besst": "R$ X,XX – R$ Y,YY",
  "desconto_atual": "string",
  "sensibilidade": [{"cenario":"string","impacto":"string","detalhe":"string"}],
  "catalisadores": [{"descricao":"string","prazo":"string","impacto":"string"}],
  "riscos": [{"descricao":"string","severidade":"ALTO|MEDIO|BAIXO","gatilho":"string"}],
  "proximos_passos": ["string","string","string"]
}`,

      "etf-ext": `Você é o motor NEXO Deep para ETFs. Retorne APENAS JSON válido.

JSON:
{
  "ticker": "string",
  "veredito_final": "APORTAR|MONITORAR|AGUARDAR",
  "lacunas_respondidas": [{"lacuna":"string","resposta":"string"}],
  "modelo_preco": [
    {"camada":"C1 · Custo total propriedade","valor_justo":"string","metodologia":"string","premissas":"string"},
    {"camada":"C2 · Concentração/risco oculto","valor_justo":"string","metodologia":"string","premissas":"string"},
    {"camada":"C3 · Fit Markowitz carteira","valor_justo":"string","metodologia":"string","premissas":"string"}
  ],
  "zona_convergida": "Sizing sugerido no Trilho 1",
  "zona_besst": "Estratégia de aporte",
  "desconto_atual": "string",
  "sensibilidade": [{"cenario":"string","impacto":"string","detalhe":"string"}],
  "catalisadores": [{"descricao":"string","prazo":"string","impacto":"string"}],
  "riscos": [{"descricao":"string","severidade":"ALTO|MEDIO|BAIXO","gatilho":"string"}],
  "proximos_passos": ["string","string","string"]
}`,

      "stock-ext": `Você é o motor NEXO Deep para Stock Picking Exterior. Retorne APENAS JSON válido.

JSON:
{
  "ticker": "string",
  "veredito_final": "POSICAO_PLENA|POSICAO_PARCIAL|WATCHLIST|EVITAR",
  "lacunas_respondidas": [{"lacuna":"string","resposta":"string"}],
  "modelo_preco": [
    {"camada":"C1","valor_justo":"string","metodologia":"string","premissas":"string"},
    {"camada":"C2","valor_justo":"string","metodologia":"string","premissas":"string"},
    {"camada":"C3","valor_justo":"string","metodologia":"string","premissas":"string"}
  ],
  "zona_convergida": "US$ X,XX – US$ Y,YY",
  "zona_besst": "US$ X,XX – US$ Y,YY",
  "desconto_atual": "string",
  "sensibilidade": [{"cenario":"string","impacto":"string","detalhe":"string"}],
  "catalisadores": [{"descricao":"string","prazo":"string","impacto":"string"}],
  "riscos": [{"descricao":"string","severidade":"ALTO|MEDIO|BAIXO","gatilho":"string"}],
  "proximos_passos": ["string","string","string"]
}`
    };

    const systemPrompt = phase === "scan"
      ? (SCAN_SYSTEM[assetType] || SCAN_SYSTEM.fii)
      : (DEEP_SYSTEM[assetType] || DEEP_SYSTEM.fii);

    const userContent = phase === "deep" && scanSummary
      ? `${userPrompt}\n\nRESUMO DO SCAN:\n${scanSummary}${context}`
      : `${userPrompt}${context}`;

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

    const text = await response.text();
    const data = JSON.parse(text);

    if (data.error) {
      return Response.json({ error: { message: `${data.error.type}: ${data.error.message}` } });
    }

    let rawText = data.content?.[0]?.text || "{}";
    
    // Clean up common JSON issues from model output
    // 1. Extract only the JSON object (remove any text before/after)
    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      rawText = rawText.slice(jsonStart, jsonEnd + 1);
    }
    
    // 2. Fix common issues: trailing commas, unescaped quotes in strings
    rawText = rawText
      .replace(/,\s*}/g, "}")      // trailing comma before }
      .replace(/,\s*]/g, "]")      // trailing comma before ]
      .replace(/[ -]/g, " "); // control characters
    
    // 3. Validate before returning
    try {
      JSON.parse(rawText); // just validate
    } catch(parseErr) {
      // If still invalid, return a safe error JSON
      return Response.json({ 
        error: { message: "Erro ao processar resposta da análise. Tente novamente." }
      });
    }
    
    return new Response(rawText, { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return Response.json({ error: { message: err.message } }, { status: 500 });
  }
}
