export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const SCAN_S = '{"ticker":"","nome":"","segmento":"","veredito":"APROVADO|WATCHLIST|VETADO","motivo_veto":null,"score_total":0,"score_max":30,"score_resumo":"","filtros":[{"nome":"","valor":"","status":"PASS|FAIL","nota":""}],"governanca":[{"dimensao":"","nota":0,"obs":""}],"kpis":[{"nome":"","valor":"","benchmark":"","status":"PASS|FAIL|ALERTA"}],"score_dimensoes":[{"nome":"","nota":0,"obs":""}],"tese":"","catalisadores":[{"descricao":"","prazo":"","impacto":""}],"riscos":[{"descricao":"","severidade":"ALTO|MEDIO|BAIXO","probabilidade":""}],"lacunas_deep":["",""]}';
const DEEP_S = '{"ticker":"","veredito_final":"COMPRAR|MONITORAR|AGUARDAR|EVITAR","lacunas":[{"q":"","r":""}],"preco":[{"c":"C1","vj":"","met":"","prem":""},{"c":"C2","vj":"","met":"","prem":""},{"c":"C3","vj":"","met":"","prem":""}],"zona":"","besst":"","desconto":"","macro":[{"s":"","i":""}],"catalisadores":[{"d":"","p":""}],"riscos":[{"d":"","sev":"ALTO|MEDIO|BAIXO","g":""}],"passos":[""]}';
const INV = '{"ticker_invalido":true}';

const SCANS = {
  "fii":       "You are a NEXO FII analyst. Respond with ONLY a JSON object, no other text, no markdown. Schema: " + SCAN_S + " If ticker unknown: " + INV + " Rules: liq<R$300k=VETO. gov5dims: estrutura/gestor/conselho/auditoria/concentracao, nota1=VETO. KPIs: P/VP, DY12m, spread NTN-B, vacancia, prazo. Fill 6 score_dimensoes. tese=2 sentences. 2 lacunas_deep. All text in Portuguese.",
  "acao-br":   "You are a NEXO Brazilian stock analyst. Respond with ONLY a JSON object, no other text, no markdown. Schema: " + SCAN_S + " If ticker unknown: " + INV + " Rules: detect segment automatically. liq<R$300k=VETO. gov5dims nota1=VETO. segment-specific KPIs. Fill 6 score_dimensoes. tese=2 sentences. 2 lacunas_deep. All text in Portuguese.",
  "etf-ext":   "You are a NEXO ETF analyst. Respond with ONLY a JSON object, no other text, no markdown. Schema: " + SCAN_S + " score_max=25, governanca=[]. If ticker unknown: " + INV + " KPIs: TER, TD, AUM, domicilio, ACC/DIST, top10. Fill 5 score_dimensoes. tese=2 sentences. 2 lacunas_deep. All text in Portuguese.",
  "stock-ext": "You are a NEXO international stock analyst. Respond with ONLY a JSON object, no other text, no markdown. Schema: " + SCAN_S + " score_max=50. If ticker unknown: " + INV + " Rules: ADV<1M=VETO. gov4dims. thematic purity >50%. theme-specific KPIs. Fill 6 score_dimensoes. tese=2 sentences. 2 lacunas_deep. All text in Portuguese."
};

const DEEPS = {
  "fii":       "You are a NEXO FII deep analyst. Respond with ONLY a JSON object, no other text, no markdown. Schema: " + DEEP_S + " C1=P/VP (Soros reflexivity), C2=yield vs NTN-B spread, C3=location moat. BESST=15-25% below convergence zone. Answer 2 lacunas concisely. 2 macro scenarios. 2 catalisadores. 2 riscos. 2 passos. All text in Portuguese.",
  "acao-br":   "You are a NEXO Brazilian stock deep analyst. Respond with ONLY a JSON object, no other text, no markdown. Schema: " + DEEP_S + " Use segment-appropriate pricing model (C1/C2/C3). BESST=15-25% below convergence zone. Answer 2 lacunas concisely. 2 macro. 2 catalisadores. 2 riscos. 2 passos. All text in Portuguese.",
  "etf-ext":   "You are a NEXO ETF deep analyst. Respond with ONLY a JSON object, no other text, no markdown. Schema: " + DEEP_S + " C1=cost efficiency, C2=concentration risk, C3=Markowitz fit. 2 macro. 2 passos. All text in Portuguese.",
  "stock-ext": "You are a NEXO international stock deep analyst. Respond with ONLY a JSON object, no other text, no markdown. Schema: " + DEEP_S + " Theme-appropriate pricing model. Answer 2 lacunas. 2 macro. 2 passos. All text in Portuguese."
};

function tryParseJSON(text) {
  // Remove markdown code blocks if present
  let raw = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  
  // Find the outermost JSON object
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  raw = raw.slice(start, end + 1);
  
  // Fix trailing commas
  raw = raw.replace(/,(\s*[}\]])/g, '$1');
  
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { phase, assetType, ticker, scanSummary, extraCtx } = body;

    // Legacy proxy mode (no phase/assetType)
    if (!phase || !assetType) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      return Response.json(await resp.json());
    }

    const systemPrompt = phase === "deep"
      ? (DEEPS[assetType] || DEEPS["acao-br"])
      : (SCANS[assetType] || SCANS["acao-br"]);

    const userMsg = "Analyze ticker: " + ticker +
      (scanSummary ? "\nScan context: " + scanSummary : "") +
      (extraCtx ? "\nFocus: " + extraCtx : "");

    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
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
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    const apiData = await apiResp.json();

    if (apiData.error) {
      return Response.json({ error: { message: "API: " + apiData.error.message } });
    }

    const rawText = (apiData.content && apiData.content[0]) ? apiData.content[0].text : "";
    
    if (!rawText) {
      return Response.json({ error: { message: "Modelo retornou resposta vazia" } });
    }

    const parsed = tryParseJSON(rawText);
    
    if (!parsed) {
      // Return first 200 chars of raw so we can debug
      const preview = rawText.slice(0, 200).replace(/\n/g, ' ');
      return Response.json({ error: { message: "Parse falhou. Modelo retornou: " + preview } });
    }

    return Response.json(parsed);

  } catch (err) {
    return Response.json({ error: { message: "Erro servidor: " + err.message } }, { status: 500 });
  }
}
