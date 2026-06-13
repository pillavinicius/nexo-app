export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SCAN_S =
  '{"ticker":"","nome":"","segmento":"","veredito":"APROVADO|WATCHLIST|VETADO","motivo_veto":null,"score_total":0,"score_max":30,"score_resumo":"","filtros":[{"nome":"","valor":"","status":"PASS|FAIL","nota":""}],"governanca":[{"dimensao":"","nota":0,"obs":""}],"kpis":[{"nome":"","valor":"","benchmark":"","status":"PASS|FAIL|ALERTA"}],"score_dimensoes":[{"nome":"","nota":0,"obs":""}],"tese":"","catalisadores":[{"descricao":"","prazo":"","impacto":""}],"riscos":[{"descricao":"","severidade":"ALTO|MEDIO|BAIXO","probabilidade":""}],"lacunas_deep":["",""]}';

const DEEP_S =
  '{"ticker":"","veredito_final":"COMPRAR|MONITORAR|AGUARDAR|EVITAR","lacunas":[{"q":"","r":""}],"preco":[{"c":"C1","vj":"","met":"","prem":""},{"c":"C2","vj":"","met":"","prem":""},{"c":"C3","vj":"","met":"","prem":""}],"zona":"","besst":"","desconto":"","macro":[{"s":"","i":""}],"catalisadores":[{"d":"","p":""}],"riscos":[{"d":"","sev":"ALTO|MEDIO|BAIXO","g":""}],"passos":[""]}';

const FINAL_S =
  '{"ticker":"","classificacao_final":"COMPRAR|MONITORAR|AGUARDAR|EVITAR|VETADO","veredito_anterior":"","veredito_reclassificado":"","score_original":0,"score_revisado":0,"score_max":30,"mudanca_score":"","mudanca_veredito":"MANTEVE|MELHOROU|PIOROU","riscos_incorporados":[{"descricao":"","impacto_score":"","severidade":"ALTO|MEDIO|BAIXO"}],"ajustes_score":[{"dimensao":"","antes":0,"depois":0,"motivo":""}],"tese_final":"","preco_final":{"zona_convergencia":"","besst":"","margem_seguranca":"","observacao":""},"conclusao":"","proximos_passos":[""]}';

const INV = '{"ticker_invalido":true}';

const SCANS = {
  "fii":
    "You are a NEXO FII analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    SCAN_S +
    " If ticker unknown: " +
    INV +
    " Rules: liq<R$300k=VETO. gov5dims: estrutura/gestor/conselho/auditoria/concentracao, nota1=VETO. KPIs: P/VP, DY12m, spread NTN-B, vacancia, prazo. Fill 6 score_dimensoes. tese=2 short sentences. 2 lacunas_deep. All text in Portuguese.",

  "acao-br":
    "You are a NEXO Brazilian stock analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    SCAN_S +
    " If ticker unknown: " +
    INV +
    " Rules: detect segment automatically. liq<R$300k=VETO. gov5dims nota1=VETO. segment-specific KPIs. Fill 6 score_dimensoes. tese=2 short sentences. 2 lacunas_deep. All text in Portuguese.",

  "etf-ext":
    "You are a NEXO ETF analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    SCAN_S +
    " score_max=25, governanca=[]. If ticker unknown: " +
    INV +
    " KPIs: TER, TD, AUM, domicilio, ACC/DIST, top10. Fill 5 score_dimensoes. tese=2 short sentences. 2 lacunas_deep. All text in Portuguese.",

  "stock-ext":
    "You are a NEXO international stock analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    SCAN_S +
    " score_max=50. If ticker unknown: " +
    INV +
    " Rules: ADV<1M=VETO. gov4dims. thematic purity >50%. theme-specific KPIs. Fill 6 score_dimensoes. tese=2 short sentences. 2 lacunas_deep. All text in Portuguese.",
};

const DEEPS = {
  "fii":
    "You are a NEXO FII deep analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    DEEP_S +
    " Keep the response concise. C1=P/VP, C2=yield vs NTN-B spread, C3=location moat. BESST=15-25% below convergence zone. Answer 2 lacunas concisely. 2 macro scenarios. 2 catalisadores. 2 riscos. 2 passos. All text in Portuguese.",

  "acao-br":
    "You are a NEXO Brazilian stock deep analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    DEEP_S +
    " Keep the response concise. Use segment-appropriate pricing model C1/C2/C3. BESST=15-25% below convergence zone. Answer 2 lacunas concisely. 2 macro. 2 catalisadores. 2 riscos. 2 passos. All text in Portuguese.",

  "etf-ext":
    "You are a NEXO ETF deep analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    DEEP_S +
    " Keep the response concise. C1=cost efficiency, C2=concentration risk, C3=Markowitz fit. 2 macro. 2 catalisadores. 2 riscos. 2 passos. All text in Portuguese.",

  "stock-ext":
    "You are a NEXO international stock deep analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    DEEP_S +
    " Keep the response concise. Theme-appropriate pricing model. Answer 2 lacunas. 2 macro. 2 catalisadores. 2 riscos. 2 passos. All text in Portuguese.",
};

const FINALS = {
  "fii":
    "You are a NEXO FII final reclassification analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    FINAL_S +
    " Consolidate Scan, Deep and all follow-ups. Re-score considering new risks, catalysts, valuation, liquidity, governance, leverage, portfolio quality, market regime and narrative coherence. All text in Portuguese.",

  "acao-br":
    "You are a NEXO Brazilian stock final reclassification analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    FINAL_S +
    " Consolidate Scan, Deep and all follow-ups. Re-score considering new risks, catalysts, capital structure, governance, moat, earnings quality, macro sensitivity, valuation and narrative coherence. All text in Portuguese.",

  "etf-ext":
    "You are a NEXO ETF final reclassification analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    FINAL_S +
    " Consolidate Scan, Deep and all follow-ups. Re-score considering cost, tracking difference, AUM, domicile, concentration, tax/friction, liquidity, portfolio role and Markowitz fit. All text in Portuguese.",

  "stock-ext":
    "You are a NEXO international stock final reclassification analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    FINAL_S +
    " Consolidate Scan, Deep and all follow-ups. Re-score considering theme purity, moat, growth quality, valuation, risk, margins, capital allocation, balance sheet and narrative coherence. All text in Portuguese.",
};

function safeError(message) {
  return Response.json({
    error: {
      message: String(message || "Erro desconhecido"),
    },
  });
}

function parseModelJSON(text) {
  if (!text) {
    return {
      ok: false,
      error: "Resposta vazia",
      raw: "",
    };
  }

  let raw = String(text)
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return {
      ok: false,
      error: "Objeto JSON não encontrado",
      raw,
    };
  }

  raw = raw.slice(start, end + 1);
  raw = raw.replace(/,(\s*[}\]])/g, "$1");

  try {
    return {
      ok: true,
      data: JSON.parse(raw),
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      raw,
    };
  }
}

function fallbackDeepJSON({ ticker, rawText, parseError }) {
  const preview = String(rawText || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim()
    .slice(0, 1200);

  return {
    ticker: ticker || "",
    veredito_final: "MONITORAR",
    lacunas: [
      {
        q: "Aprofundamento retornou resposta fora do JSON esperado?",
        r:
          "Sim. O modelo gerou conteúdo parcialmente inválido ou truncado. A análise deve ser refeita com pergunta mais objetiva ou contexto menor.",
      },
    ],
    preco: [
      {
        c: "C1",
        vj: "N/D",
        met: "Fallback técnico por resposta inválida",
        prem: "Não usar como conclusão de valuation.",
      },
      {
        c: "C2",
        vj: "N/D",
        met: "Fallback técnico por resposta inválida",
        prem: "Reexecutar o aprofundamento.",
      },
      {
        c: "C3",
        vj: "N/D",
        met: "Fallback técnico por resposta inválida",
        prem: "Aguardar nova análise válida.",
      },
    ],
    zona: "N/D",
    besst: "N/D",
    desconto: "N/D",
    macro: [
      {
        s: "Erro técnico de estrutura",
        i:
          "A resposta da IA não veio como JSON válido. O histórico visual foi preservado e a análise não foi perdida.",
      },
    ],
    catalisadores: [
      {
        d: "Reexecutar aprofundamento com foco específico",
        p: "Imediato",
      },
    ],
    riscos: [
      {
        d: "Risco de interpretação incompleta por resposta truncada",
        sev: "MEDIO",
        g: parseError || "Parse inválido",
      },
    ],
    passos: [
      "Refaça o aprofundamento com uma pergunta mais curta.",
      "Use o bloco anterior apenas como referência, sem considerar este fallback como veredito econômico.",
      preview ? "Prévia técnica da resposta bruta: " + preview : "Sem prévia disponível.",
    ],
  };
}

function fallbackFinalJSON({ ticker, rawText, parseError }) {
  return {
    ticker: ticker || "",
    classificacao_final: "MONITORAR",
    veredito_anterior: "N/D",
    veredito_reclassificado: "MONITORAR",
    score_original: 0,
    score_revisado: 0,
    score_max: 30,
    mudanca_score: "Reclassificação final não pôde ser calculada por resposta inválida da IA.",
    mudanca_veredito: "MANTEVE",
    riscos_incorporados: [
      {
        descricao: "Erro técnico na geração da reclassificação final",
        impacto_score: "Indeterminado",
        severidade: "MEDIO",
      },
    ],
    ajustes_score: [
      {
        dimensao: "Confiabilidade da resposta",
        antes: 0,
        depois: 0,
        motivo: parseError || "JSON inválido ou truncado.",
      },
    ],
    tese_final:
      "A reclassificação final deve ser refeita. O sistema preservou o histórico anterior e evitou quebra do fluxo.",
    preco_final: {
      zona_convergencia: "N/D",
      besst: "N/D",
      margem_seguranca: "N/D",
      observacao: "Fallback técnico. Não usar como conclusão de investimento.",
    },
    conclusao:
      "Falha técnica na estrutura da resposta. Reexecutar a reclassificação final com contexto menor ou mais objetivo.",
    proximos_passos: [
      "Reexecutar a reclassificação final.",
      "Se persistir, reduzir a quantidade de aprofundamentos enviados.",
      String(rawText || "").slice(0, 800),
    ],
  };
}

function getSystemPrompt(phase, assetType) {
  if (phase === "final") return FINALS[assetType] || FINALS["acao-br"];
  if (phase === "deep") return DEEPS[assetType] || DEEPS["acao-br"];
  return SCANS[assetType] || SCANS["acao-br"];
}

function trimContextForDeep(extraCtx) {
  const text = String(extraCtx || "");

  if (text.length <= 4500) return text;

  return (
    "Contexto resumido automaticamente para evitar resposta truncada.\n\n" +
    text.slice(0, 1800) +
    "\n\n...[contexto intermediário omitido para estabilidade]...\n\n" +
    text.slice(-2200)
  );
}

function trimContextForFinal(extraCtx) {
  const text = String(extraCtx || "");

  if (text.length <= 9000) return text;

  return (
    "Contexto final resumido automaticamente para evitar resposta truncada.\n\n" +
    text.slice(0, 3500) +
    "\n\n...[histórico intermediário omitido para estabilidade técnica]...\n\n" +
    text.slice(-4500)
  );
}

function buildUserMessage({ phase, ticker, scanSummary, extraCtx }) {
  if (phase === "final") {
    return (
      "Reclassifique o ativo após o ciclo completo NEXO.\n" +
      "Ticker: " +
      ticker +
      "\n\nHistórico completo da análise:\n" +
      trimContextForFinal(extraCtx || "") +
      "\n\nTarefa:\n" +
      "1. Consolide o Scan, o Deep e os aprofundamentos disponíveis.\n" +
      "2. Identifique riscos novos e agravados.\n" +
      "3. Recalcule o score revisado.\n" +
      "4. Informe se o veredito melhorou, piorou ou foi mantido.\n" +
      "5. Gere a classificação final NEXO.\n" +
      "6. Retorne apenas JSON válido no schema solicitado.\n\n" +
      "IMPORTANT: Return ONLY valid JSON. Do NOT use markdown. Do NOT use code fences. Do NOT explain. Do NOT write text outside the JSON object."
    );
  }

  if (phase === "deep") {
    return (
      "Analyze ticker: " +
      ticker +
      (scanSummary ? "\nScan context: " + scanSummary : "") +
      "\nContexto do usuário e dados manuais/macro:\n" +
      trimContextForDeep(extraCtx || "") +
      "\n\nIMPORTANT: Return ONLY valid JSON. Keep the JSON concise. Do NOT use markdown. Do NOT use code fences. Do NOT explain. Do NOT write text outside the JSON object."
    );
  }

  return (
    "Analyze ticker: " +
    ticker +
    (scanSummary ? "\nScan context: " + scanSummary : "") +
    (extraCtx ? "\nFocus: " + extraCtx : "") +
    "\n\nIMPORTANT: Return ONLY valid JSON. Do NOT use markdown. Do NOT use code fences. Do NOT explain. Do NOT write text outside the JSON object."
  );
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { phase, assetType, ticker, scanSummary, extraCtx } = body;

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

      const text = await resp.text();

      try {
        return Response.json(JSON.parse(text));
      } catch {
        return safeError(
          "Resposta não-JSON da API Anthropic: " +
            text.slice(0, 500).replace(/\n/g, " ")
        );
      }
    }

    const systemPrompt = getSystemPrompt(phase, assetType);

    const userMsg = buildUserMessage({
      phase,
      ticker,
      scanSummary,
      extraCtx,
    });

    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: phase === "final" ? 5000 : phase === "deep" ? 3500 : 3000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userMsg,
          },
        ],
      }),
    });

    const apiText = await apiResp.text();

    let apiData;

    try {
      apiData = JSON.parse(apiText);
    } catch {
      if (phase === "deep") {
        return Response.json(
          fallbackDeepJSON({
            ticker,
            rawText: apiText,
            parseError: "Anthropic retornou resposta HTTP não-JSON.",
          })
        );
      }

      if (phase === "final") {
        return Response.json(
          fallbackFinalJSON({
            ticker,
            rawText: apiText,
            parseError: "Anthropic retornou resposta HTTP não-JSON.",
          })
        );
      }

      return safeError(
        "Anthropic retornou resposta não-JSON: " +
          apiText.slice(0, 500).replace(/\n/g, " ")
      );
    }

    if (!apiResp.ok) {
      return safeError(
        "Anthropic HTTP " +
          apiResp.status +
          ": " +
          (apiData?.error?.message || "erro desconhecido")
      );
    }

    if (apiData.error) {
      return safeError("API: " + apiData.error.message);
    }

    const rawText = apiData?.content?.[0]?.text || "";

    if (!rawText) {
      if (phase === "deep") {
        return Response.json(
          fallbackDeepJSON({
            ticker,
            rawText: "",
            parseError: "Modelo retornou resposta vazia.",
          })
        );
      }

      if (phase === "final") {
        return Response.json(
          fallbackFinalJSON({
            ticker,
            rawText: "",
            parseError: "Modelo retornou resposta vazia.",
          })
        );
      }

      return safeError("Modelo retornou resposta vazia");
    }

    const result = parseModelJSON(rawText);

    if (!result.ok) {
      if (phase === "deep") {
        return Response.json(
          fallbackDeepJSON({
            ticker,
            rawText,
            parseError: result.error,
          })
        );
      }

      if (phase === "final") {
        return Response.json(
          fallbackFinalJSON({
            ticker,
            rawText,
            parseError: result.error,
          })
        );
      }

      return safeError(
        "Parse falhou: " +
          result.error +
          ". Modelo retornou: " +
          result.raw.slice(0, 500).replace(/\n/g, " ")
      );
    }

    return Response.json(result.data);
  } catch (err) {
    return safeError("Erro servidor: " + err.message);
  }
}
