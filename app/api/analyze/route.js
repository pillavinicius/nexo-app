export const maxDuration = 120;
export const dynamic = "force-dynamic";

import { jsonrepair } from "jsonrepair";

import {
  buildNmiPromptContext,
  getLatestContext,
} from "../../../lib/nmi/get_latest_context.mjs";
import {
  applyEdgGuardrails,
  buildEdgAnalysisContext,
  computeEDG,
  EDGE_INSUMOS,
} from "../../../lib/nexo/edg/edg_engine.mjs";
import { reconcileFinalVerdictChange } from "../../../lib/nexo/analysis/verdict_transition.mjs";
import {
  buildDeterministicFinal,
  reconcileDeepIntegrity,
} from "../../../lib/nexo/analysis/reclassification_integrity.mjs";
import {
  applyHdlToAnalysis,
  buildHdlPromptContext,
  computeHDL,
  notApplicableHDL,
} from "../../../lib/nexo/hdl/hdl_engine.mjs";
import { loadHdlCurve } from "../../../lib/nexo/hdl/hdl_repository.mjs";
import {
  applyNfiToAnalysis,
  buildNfiPromptContext,
  computeNFI,
  notApplicableNFI,
} from "../../../lib/nexo/nfi/nfi_engine.mjs";
import { loadNfiFlow } from "../../../lib/nexo/nfi/nfi_repository.mjs";
import {
  applyTdnToAnalysis,
  buildTdnPromptContext,
  computeTDN,
} from "../../../lib/nexo/tdn/tdn_engine.mjs";
import { loadTdnInput } from "../../../lib/nexo/tdn/tdn_repository.mjs";
import {
  applyBibliotecaAudit,
  buildBibliotecaPromptContext,
  deriveExpectedDeepGaps,
  loadBibliotecaContext,
} from "../../../lib/nexo/biblioteca/context.mjs";

const SCAN_S =
  '{"ticker":"","nome":"","segmento":"","veredito":"APROVADO|WATCHLIST|VETADO","motivo_veto":null,"score_total":0,"score_max":30,"score_resumo":"","filtros":[{"nome":"","valor":"","status":"PASS|FAIL","nota":""}],"governanca":[{"dimensao":"","nota":0,"obs":""}],"kpis":[{"nome":"","valor":"","benchmark":"","status":"PASS|FAIL|ALERTA"}],"score_dimensoes":[{"nome":"","nota":0,"obs":""}],"tese":"","catalisadores":[{"descricao":"","prazo":"","impacto":""}],"riscos":[{"descricao":"","severidade":"ALTO|MEDIO|BAIXO","probabilidade":""}],"lacunas_deep":["",""]}';

const DEEP_S =
  '{"ticker":"","veredito_final":"COMPRAR|MONITORAR|AGUARDAR|EVITAR","score_original":0,"score_revisado":0,"score_max":30,"mudanca_score":"","ajustes_score":[{"dimensao":"","antes":0,"depois":0,"motivo":"","fonte_nova":""}],"lacunas":[{"q":"","r":""}],"lacunas_documentais":[{"lacuna":"","status":"resolvida|aberta","evidencia_documental":["source:id"]}],"preco":[{"c":"C1","vj":"","met":"","prem":""},{"c":"C2","vj":"","met":"","prem":""},{"c":"C3","vj":"","met":"","prem":""}],"valuations_classicos":[{"modelo":"Graham|Peter Lynch|Buffett moderno|Bazin","valor_justo":"","metodologia":"","premissas":""}],"zona":"","besst":"","desconto":"","hdl_conclusao":"","tdn_conclusao":"","macro":[{"s":"","i":""}],"catalisadores":[{"d":"","p":""}],"riscos":[{"d":"","sev":"ALTO|MEDIO|BAIXO","g":""}],"passos":[""]}';

const DEEP_INTEGRITY_RULES =
  " Score original must reproduce the previous stage score. Only include ajustes_score for NEW evidence found in this Deep; never penalize a risk already counted in the previous stage. Each adjustment must use a 0-5 dimension score, explain the new evidence and cite its exact Biblioteca document ID in fonte_nova when documentary. The server will ignore your arithmetic and calculate the total from the adjustments. Fill lacunas_documentais for every investigated gap: resolved requires at least one exact available document ID; otherwise mark open. BESST must be 15-25% below the convergence zone. hdl_conclusao is mandatory for Brazilian assets and must interpret the immutable server-calculated HDL values; never recalculate them. When the server supplies a valid TDN, tdn_conclusao is mandatory and must interpret it without recalculating any metric. TDN never changes the global score or verdict automatically.";

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
    DEEP_INTEGRITY_RULES +
    " Keep the response concise. C1=P/VP, C2=yield vs NTN-B spread, C3=location moat. BESST=15-25% below convergence zone. Answer 2 lacunas concisely. 2 macro scenarios. 2 catalisadores. 2 riscos. 2 passos. If classical valuations were not requested, return valuations_classicos=[]. All text in Portuguese.",

  "acao-br":
    "You are a NEXO Brazilian stock deep analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    DEEP_S +
    DEEP_INTEGRITY_RULES +
    " Keep the response concise. Use segment-appropriate pricing model C1/C2/C3. BESST=15-25% below convergence zone. Answer 2 lacunas concisely. 2 macro. 2 catalisadores. 2 riscos. 2 passos. If classical valuations were not requested, return valuations_classicos=[]. All text in Portuguese.",

  "etf-ext":
    "You are a NEXO ETF deep analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    DEEP_S +
    DEEP_INTEGRITY_RULES +
    " Keep the response concise. C1=cost efficiency, C2=concentration risk, C3=Markowitz fit. 2 macro. 2 catalisadores. 2 riscos. 2 passos. If classical valuations were not requested, return valuations_classicos=[]. All text in Portuguese.",

  "stock-ext":
    "You are a NEXO international stock deep analyst. Respond with ONLY a valid JSON object. No markdown. No code fences. Schema: " +
    DEEP_S +
    DEEP_INTEGRITY_RULES +
    " Keep the response concise. Theme-appropriate pricing model. Answer 2 lacunas. 2 macro. 2 catalisadores. 2 riscos. 2 passos. If classical valuations were not requested, return valuations_classicos=[]. All text in Portuguese.",
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

export function parseModelJSON(text) {
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
      repaired: false,
    };
  } catch (err) {
    try {
      return {
        ok: true,
        data: JSON.parse(jsonrepair(raw)),
        repaired: true,
      };
    } catch {
      return {
        ok: false,
        error: err.message,
        raw,
      };
    }
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
    hdl_conclusao:
      "O HDL foi calculado pelo servidor, mas a interpretação específica não pôde ser concluída porque a resposta analítica veio inválida.",
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

function buildUserMessage({ phase, ticker, scanSummary, extraCtx, nmiContext, edgContext, hdlContext, nfiContext, tdnContext, bibliotecaContext, analysisHistory = {}, analysisIntent = {} }) {
  const validatedNmiBlock =
    "\n\n--- CONTEXTO MACRO TRANSVERSAL ---\n" + nmiContext;
  const validatedEdgBlock =
    "\n\n--- GOVERNANÇA DE EDGE ---\n" + edgContext;
  const validatedHdlBlock =
    "\n\n--- HDL · HURDLE DO LEVIATÃ ---\n" + hdlContext;
  const validatedNfiBlock =
    "\n\n--- NFI · NEXO FLOW INTELLIGENCE ---\n" + nfiContext;
  const validatedTdnBlock =
    "\n\n--- TDN · TESTE DE DEFESA NOMINAL ---\n" + tdnContext;
  const validatedBibliotecaBlock = phase === "deep"
    ? "\n\n--- BIBLIOTECA VIVA · EVIDÊNCIAS DOCUMENTAIS ---\n" + (bibliotecaContext || "Indisponível.")
    : "";

  if (phase === "final") {
    return (
      "Reclassifique o ativo após o ciclo completo NEXO.\n" +
      "Ticker: " +
      ticker +
      "\n\nHistórico completo da análise:\n" +
      trimContextForFinal(extraCtx || "") +
      validatedNmiBlock +
      validatedEdgBlock +
      validatedHdlBlock +
      validatedNfiBlock +
      validatedTdnBlock +
      validatedBibliotecaBlock +
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
    const analyticalBaseline =
      (Array.isArray(analysisHistory.deepAdds) && analysisHistory.deepAdds.at(-1)) ||
      analysisHistory.deep ||
      analysisHistory.scan ||
      null;
    const expectedGaps = deriveExpectedDeepGaps(analysisHistory, analysisIntent?.userFocus);
    return (
      "Analyze ticker: " +
      ticker +
      (scanSummary ? "\nScan context: " + scanSummary : "") +
      "\nContexto do usuário e dados manuais/macro:\n" +
      trimContextForDeep(extraCtx || "") +
      "\n\n--- BASE ANALÍTICA ANTERIOR (PRESERVAR SCORE E NÃO DUPLICAR RISCOS) ---\n" +
      JSON.stringify(analyticalBaseline || {}, null, 2) +
      "\n\n--- ESCOPO DETERMINÍSTICO DAS LACUNAS ---\n" +
      JSON.stringify(expectedGaps) +
      "\nResponda exatamente essas lacunas. Não substitua, remova ou acrescente perguntas por iniciativa própria.\n" +
      validatedNmiBlock +
      validatedEdgBlock +
      validatedHdlBlock +
      validatedNfiBlock +
      validatedTdnBlock +
      validatedBibliotecaBlock +
      "\n\nIMPORTANT: Return ONLY valid JSON. Keep the JSON concise. Do NOT use markdown. Do NOT use code fences. Do NOT explain. Do NOT write text outside the JSON object."
    );
  }

  return (
    "Analyze ticker: " +
    ticker +
    (scanSummary ? "\nScan context: " + scanSummary : "") +
    (extraCtx ? "\nFocus: " + extraCtx : "") +
    validatedNmiBlock +
    validatedEdgBlock +
    validatedHdlBlock +
    validatedNfiBlock +
    validatedTdnBlock +
    validatedBibliotecaBlock +
    "\n\nIMPORTANT: Return ONLY valid JSON. Do NOT use markdown. Do NOT use code fences. Do NOT explain. Do NOT write text outside the JSON object."
  );
}

function responseWithGovernance(phase, data, edg, hdl, nfi, tdn, analysisHistory = {}, biblioteca = null, analysisIntent = {}) {
  const integrityChecked = phase === "deep"
    ? reconcileDeepIntegrity(data, analysisHistory, { documentIds: biblioteca?.documentIds || [] })
    : data;
  const expectedGaps = phase === "deep" ? deriveExpectedDeepGaps(analysisHistory, analysisIntent?.userFocus) : [];
  const withBiblioteca = phase === "deep" ? applyBibliotecaAudit(integrityChecked, biblioteca, { expectedGaps }) : integrityChecked;
  const withTdn = applyTdnToAnalysis({ phase, result: withBiblioteca, tdn });
  const withHdl = applyHdlToAnalysis({ phase, result: withTdn, hdl });
  const withNfi = applyNfiToAnalysis({ result: withHdl, nfi });
  const governed = applyEdgGuardrails({ phase, result: withNfi, edg });
  return Response.json(reconcileFinalVerdictChange(phase, governed));
}

function isHdlApplicableAsset(assetType) {
  return assetType === "acao-br" || assetType === "fii";
}

function isExternalAsset(assetType) {
  return assetType === "stock-ext" || assetType === "etf-ext";
}

function hdlInputError(hdl) {
  const messages = {
    hdl_input_required: "Informe a TIR real esperada e o horizonte para executar o Deep.",
    hdl_input_invalid: "Os valores do HDL são inválidos. Use TIR real maior que -100% e horizonte positivo.",
    hdl_curve_unavailable: "A curva soberana HDL está indisponível. O Deep foi bloqueado para não estimar dados ausentes.",
    hdl_extrapolation_forbidden: `O horizonte excede o maior vértice oficial disponível (${hdl?.curve_max_vertex_years || "—"} anos). Extrapolação não é permitida.`,
  };
  return Response.json(
    {
      error: {
        code: hdl?.error_code || "hdl_incomplete",
        message: messages[hdl?.error_code] || "HDL incompleto.",
        hdl,
      },
    },
    { status: 422 }
  );
}

async function requestStructuredAnalysis({ phase, systemPrompt, userMsg }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: phase === "final" ? 5000 : phase === "deep" ? 4000 : 3500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  const responseText = await response.text();
  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    return {
      ok: false,
      kind: "transport",
      error: "Anthropic retornou resposta HTTP não-JSON.",
      rawText: responseText,
    };
  }

  if (!response.ok || data?.error) {
    return {
      ok: false,
      kind: "api",
      error:
        "Anthropic HTTP " +
        response.status +
        ": " +
        (data?.error?.message || "erro desconhecido"),
      rawText: responseText,
    };
  }

  const rawText = data?.content?.find((block) => block?.type === "text")?.text || data?.content?.[0]?.text || "";
  if (!rawText) {
    return {
      ok: false,
      kind: "empty",
      error: "Modelo retornou resposta vazia.",
      rawText: "",
    };
  }

  return { ok: true, rawText };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      phase,
      assetType,
      ticker,
      scanSummary,
      extraCtx,
      edgeLedger,
      hdlInput = {},
      analysisHistory = {},
      analysisIntent = {},
    } = body;

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
    const nmiResult = getLatestContext();
    const nmiContext = buildNmiPromptContext(nmiResult);
    const nfiRepository = loadNfiFlow();
    const nfi = isExternalAsset(assetType)
      ? notApplicableNFI()
      : nmiResult?.contextPackage?.brazil?.flow_intelligence || computeNFI({ fluxo: nfiRepository.rows });
    const nfiContext = buildNfiPromptContext(nfi);
    const hdlRepository = loadHdlCurve();
    const hdl = isHdlApplicableAsset(assetType)
      ? computeHDL({
          tir_esperada_pct: hdlInput?.tir_esperada_pct,
          horizonte_anos: hdlInput?.horizonte_anos,
          curva: hdlRepository.curve,
        })
      : notApplicableHDL();
    const hdlContext = buildHdlPromptContext(hdl);
    const tdnRepository = await loadTdnInput({ ticker, assetType });
    const tdn = computeTDN({
      ticker,
      assetType,
      classification: tdnRepository.classification,
      facts: tdnRepository.facts,
      inflation: tdnRepository.inflation,
    });
    const tdnContext = buildTdnPromptContext(tdn);
    const effectiveEdgeLedger = isExternalAsset(assetType)
      ? { edge_type: "nenhum", edge_status: "nao_declarado" }
      : edgeLedger;
    const availableEdgeModules = EDGE_INSUMOS.filter((insumo) =>
      (insumo !== "NFI" || nfi.explica_deslocamento === true) &&
      (insumo !== "TDN" || tdn.status === "ok")
    );
    const edg = computeEDG(effectiveEdgeLedger, { availableModules: availableEdgeModules });
    const edgContext = buildEdgAnalysisContext(edg, effectiveEdgeLedger);
    const biblioteca = phase === "deep" && !isExternalAsset(assetType)
      ? await loadBibliotecaContext({ ticker })
      : { available: false, status: isExternalAsset(assetType) ? "not_applicable" : "not_requested", documents: [], documentIds: [] };
    const bibliotecaContext = buildBibliotecaPromptContext(biblioteca);

    if (effectiveEdgeLedger?.edge_insumo === "NFI" && nfi.explica_deslocamento !== true) {
      return Response.json({ error: { code: "nfi_edge_unavailable", message: "O NFI só pode lastrear um Edge após confirmar fluxo extremo em 24 meses oficiais completos.", nfi } }, { status: 422 });
    }

    if (effectiveEdgeLedger?.edge_insumo === "TDN" && tdn.status !== "ok") {
      return Response.json({ error: { code: "tdn_edge_unavailable", message: "O TDN só pode lastrear um Edge quando as duas janelas históricas fixas estiverem completas para o ativo.", tdn } }, { status: 422 });
    }

    if (
      isHdlApplicableAsset(assetType) &&
      (phase === "deep" || effectiveEdgeLedger?.edge_insumo === "HDL") &&
      hdl.status !== "ok"
    ) {
      return hdlInputError(hdl);
    }

    if (phase === "final" && analysisHistory?.scan) {
      const deterministicFinal = buildDeterministicFinal({ ticker, history: analysisHistory });
      return responseWithGovernance(phase, deterministicFinal, edg, hdl, nfi, tdn, analysisHistory);
    }

    const userMsg = buildUserMessage({
      phase,
      ticker,
      scanSummary,
      extraCtx,
      nmiContext,
      edgContext,
      hdlContext,
      nfiContext,
      tdnContext,
      bibliotecaContext,
      analysisHistory,
      analysisIntent,
    });

    let modelResult = await requestStructuredAnalysis({ phase, systemPrompt, userMsg });

    if (!modelResult.ok) {
      if (modelResult.kind === "api") return safeError(modelResult.error);
      if (phase === "deep") {
        return responseWithGovernance(
          phase,
          fallbackDeepJSON({
            ticker,
            rawText: modelResult.rawText,
            parseError: modelResult.error,
          }),
          edg,
          hdl,
          nfi,
          tdn,
          analysisHistory,
          biblioteca,
          analysisIntent
        );
      }

      if (phase === "final") {
        return responseWithGovernance(
          phase,
          fallbackFinalJSON({
            ticker,
            rawText: modelResult.rawText,
            parseError: modelResult.error,
          }),
          edg,
          hdl,
          nfi,
          tdn,
          analysisHistory,
          biblioteca,
          analysisIntent
        );
      }

      return safeError(modelResult.error);
    }

    let rawText = modelResult.rawText;
    let result = parseModelJSON(rawText);

    if (!result.ok) {
      modelResult = await requestStructuredAnalysis({
        phase,
        systemPrompt,
        userMsg:
          userMsg +
          "\n\nA tentativa anterior apresentou JSON inválido. Gere novamente do zero, mais conciso, obedecendo integralmente ao schema estruturado.",
      });

      if (modelResult.ok) {
        rawText = modelResult.rawText;
        result = parseModelJSON(rawText);
      }
    }

    if (!result.ok) {
      if (phase === "deep") {
        return responseWithGovernance(
          phase,
          fallbackDeepJSON({
            ticker,
            rawText,
            parseError: result.error,
          }),
          edg,
          hdl,
          nfi,
          tdn,
          analysisHistory,
          biblioteca,
          analysisIntent
        );
      }

      if (phase === "final") {
        return responseWithGovernance(
          phase,
          fallbackFinalJSON({
            ticker,
            rawText,
            parseError: result.error,
          }),
          edg,
          hdl,
          nfi,
          tdn,
          analysisHistory
        );
      }

      return safeError(
        "Não foi possível estruturar o Scan. O sistema tentou corrigir a resposta automaticamente; execute novamente."
      );
    }

    if (phase === "deep") {
      const hdlCheck = applyHdlToAnalysis({ phase, result: result.data, hdl });
      const semanticCheck = applyTdnToAnalysis({ phase, result: hdlCheck, tdn });
      const hdlIncomplete = hdl.status === "ok" && semanticCheck?.hdl_integrity?.complete === false;
      const tdnIncomplete = tdn.status === "ok" && semanticCheck?.tdn_integrity?.complete === false;
      if (hdlIncomplete || tdnIncomplete) {
        const semanticRetry = await requestStructuredAnalysis({
          phase,
          systemPrompt,
          userMsg:
            userMsg +
            "\n\nA resposta anterior não completou hdl_conclusao e/ou tdn_conclusao. Gere novamente o JSON completo. Preencha hdl_conclusao quando o HDL estiver válido e tdn_conclusao quando o TDN estiver válido. Interprete apenas os valores imutáveis fornecidos pelo servidor; não recalcule números e não altere score ou veredito global automaticamente.",
        });
        if (semanticRetry.ok) {
          const retried = parseModelJSON(semanticRetry.rawText);
          if (retried.ok) result = retried;
        }
      }
    }

    return responseWithGovernance(phase, result.data, edg, hdl, nfi, tdn, analysisHistory, biblioteca, analysisIntent);
  } catch (err) {
    return safeError("Erro servidor: " + err.message);
  }
}
