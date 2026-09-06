import { createDatabaseClient, databaseConfiguration } from "./database.mjs";
import { createBibliotecaRepository } from "./repository.mjs";

export const B3_CONTEXT_VERSION = "BIB_B3_CONTEXT_v1.0";
const MAX_DOCUMENTS = 6;
const MAX_CANDIDATE_DOCUMENTS = 20;
const MAX_TOTAL_CHARS = 28_000;

function gapKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function gapTokens(value) {
  return new Set(gapKey(value).split(" ").filter((token) => token.length >= 3 && !["para", "pela", "pelo", "como", "qual", "quais", "sobre", "dados"].includes(token)));
}

function gapSimilarity(left, right) {
  const a = gapTokens(left);
  const b = gapTokens(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / Math.min(a.size, b.size);
}

function bestGapMatch(expected, candidates, getText) {
  return candidates.map((candidate, index) => ({ candidate, index, score: gapSimilarity(expected, getText(candidate)) }))
    .sort((a, b) => b.score - a.score)[0];
}

export function selectBibliotecaDocuments(documents = [], gaps = []) {
  const expected = Array.isArray(gaps) ? gaps.map((gap) => String(gap || "").trim()).filter(Boolean) : [];
  return documents.map((document, index) => {
    const searchable = `${document.titulo || ""}\n${document.texto_corrido || ""}`;
    const matches = expected.map((gap) => ({ gap, score: gapSimilarity(gap, searchable) }))
      .filter((match) => match.score >= 0.2)
      .sort((a, b) => b.score - a.score);
    return { document, index, matches, score: matches[0]?.score || 0, userSource: document.fonte === "ri" };
  }).sort((a, b) => b.score - a.score || Number(b.userSource) - Number(a.userSource) || a.index - b.index)
    .slice(0, MAX_DOCUMENTS);
}

export function deriveExpectedDeepGaps(history = {}, userFocus = "") {
  const additions = Array.isArray(history.deepAdds) ? history.deepAdds.filter(Boolean) : [];
  const latestDeep = additions.at(-1) || history.deep || null;
  const priorOpen = latestDeep?.nexoModules?.BIBLIOTECA?.lacunas_abertas;
  const base = Array.isArray(priorOpen) && priorOpen.length
    ? priorOpen
    : Array.isArray(history.scan?.lacunas_deep)
    ? history.scan.lacunas_deep
    : [];
  const expected = [...new Set(base.map((gap) => String(gap || "").trim()).filter(Boolean))];
  const focus = String(userFocus || "").trim();
  if (focus && !expected.some((gap) => gapSimilarity(gap, focus) >= 0.5)) expected.push(focus);
  return expected.slice(0, 8);
}

export async function loadBibliotecaContext({ ticker, gaps = [], client = null } = {}) {
  if (!databaseConfiguration().configured && !client) {
    return { version: B3_CONTEXT_VERSION, available: false, status: "database_unavailable", documents: [], documentIds: [] };
  }
  try {
    const repository = createBibliotecaRepository(client || createDatabaseClient());
    const candidates = await repository.listParsedByTicker({ ticker, limite: MAX_CANDIDATE_DOCUMENTS });
    const selected = selectBibliotecaDocuments(candidates, gaps);
    let remaining = MAX_TOTAL_CHARS;
    const normalized = selected.map(({ document, matches }) => {
      const text = String(document.texto_corrido || "").slice(0, remaining);
      remaining -= text.length;
      return {
        id: document.dedup_key,
        source: document.fonte,
        trust: document.fonte === "ri" ? "user_supplied" : "official_registry",
        title: document.titulo || document.categoria || "Documento oficial",
        date: document.data_documento,
        url: document.url_origem,
        text,
        tables: Array.isArray(document.tabelas_json) ? document.tabelas_json.slice(0, 8) : [],
        matchedGaps: matches.map((match) => match.gap),
      };
    }).filter((document) => document.text);
    return {
      version: B3_CONTEXT_VERSION,
      available: normalized.length > 0,
      status: normalized.length > 0 ? "ready" : "no_documents",
      documents: normalized,
      documentIds: normalized.map((document) => document.id),
    };
  } catch {
    return { version: B3_CONTEXT_VERSION, available: false, status: "unavailable", documents: [], documentIds: [] };
  }
}

export function buildBibliotecaPromptContext(context) {
  if (!context?.available) {
    return `BIBLIOTECA VIVA ${B3_CONTEXT_VERSION}: nenhum documento processado disponível para este ativo. Não invente evidências documentais. Marque como aberta cada lacuna que dependa de fonte primária.`;
  }
  const records = context.documents.map((document) =>
    `[${document.id}] trust=${document.trust} · ${document.date || "data não informada"} · ${document.title}` +
    (document.matchedGaps?.length ? `\nLACUNAS RELACIONADAS: ${document.matchedGaps.join(" | ")}` : "") +
    `\n${document.text}` +
    (document.tables?.length ? `\nTABELAS EXTRAÍDAS:\n${JSON.stringify(document.tables)}` : "")
  ).join("\n\n");
  return (
    `BIBLIOTECA VIVA ${B3_CONTEXT_VERSION}: ${context.documents.length} documento(s) processado(s).\n` +
    "Registros CVM têm origem oficial. Itens RI com trust=user_supplied foram informados pelo usuário e devem manter essa ressalva de proveniência. Use somente IDs listados como evidencia_documental. Se o conteúdo não responder à lacuna, marque-a aberta.\n\n" + records
  );
}

export function applyBibliotecaAudit(result, context, { expectedGaps = [] } = {}) {
  const allowed = new Set(context?.documentIds || []);
  const declared = Array.isArray(result?.lacunas_documentais) ? result.lacunas_documentais : [];
  const fallback = Array.isArray(result?.lacunas) ? result.lacunas.map((item) => ({
    lacuna: item?.q || item?.lacuna || String(item || "Lacuna documental"),
    status: context?.available ? "aberta" : "aberta",
    evidencia_documental: [],
  })) : [];
  const candidates = declared.length ? declared : fallback;
  const governedCandidates = expectedGaps.length ? expectedGaps.map((expected) => {
    const match = bestGapMatch(expected, candidates, (item) => item?.lacuna);
    return match?.score >= 0.2 ? { ...match.candidate, lacuna: expected } : { lacuna: expected, status: "aberta", evidencia_documental: [] };
  }) : candidates;
  const gaps = governedCandidates.map((item) => {
    const evidence = [...new Set((Array.isArray(item?.evidencia_documental) ? item.evidencia_documental : []).filter((id) => allowed.has(id)))];
    const resolved = item?.status === "resolvida" && evidence.length > 0;
    return { lacuna: String(item?.lacuna || "Lacuna documental"), status: resolved ? "resolvida" : "aberta", evidencia_documental: evidence };
  });
  const answers = Array.isArray(result?.lacunas) ? result.lacunas : [];
  const governedAnswers = expectedGaps.length ? expectedGaps.map((expected) => {
    const match = bestGapMatch(expected, answers, (item) => item?.q || item?.lacuna);
    return match?.score >= 0.2
      ? { ...match.candidate, q: expected }
      : { q: expected, r: "Não respondida com evidência suficiente neste Deep; a lacuna permanece aberta." };
  }) : answers;
  const discarded = expectedGaps.length
    ? candidates.map((item) => String(item?.lacuna || "").trim()).filter((candidate) => candidate && !expectedGaps.some((expected) => gapSimilarity(expected, candidate) >= 0.2))
    : [];
  const audit = {
    version: B3_CONTEXT_VERSION,
    status: context?.status || "unavailable",
    consulted: true,
    documents_used: [...new Set(gaps.flatMap((gap) => gap.evidencia_documental))],
    documents_consulted: context?.documents?.map((document) => document.id) || [],
    documents_available: context?.documents?.length || 0,
    user_supplied_documents: context?.documents?.filter((document) => document.trust === "user_supplied").map((document) => document.id) || [],
    lacunas_abertas: gaps.filter((gap) => gap.status === "aberta").map((gap) => gap.lacuna),
    lacunas_resolvidas: gaps.filter((gap) => gap.status === "resolvida").map((gap) => gap.lacuna),
    requires_user_source: gaps.some((gap) => gap.status === "aberta"),
    gap_scope: expectedGaps.length ? "governed_by_previous_stage" : "model_declared",
    expected_gap_count: expectedGaps.length || gaps.length,
    discarded_new_gaps: discarded,
  };
  return { ...result, lacunas: governedAnswers, lacunas_documentais: gaps, nexoModules: { ...(result?.nexoModules || {}), BIBLIOTECA: audit } };
}
