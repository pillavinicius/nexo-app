import { createDatabaseClient, databaseConfiguration } from "./database.mjs";
import { createBibliotecaRepository } from "./repository.mjs";

export const B3_CONTEXT_VERSION = "BIB_B3_2_CONTEXT_v2.0";
const MAX_DOCUMENTS = 6;
const MAX_CANDIDATE_DOCUMENTS = 20;
const MAX_CHUNKS = 12;
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
  const tokens = new Set(gapKey(value).split(" ").filter((token) => token.length >= 3 && !["para", "pela", "pelo", "como", "qual", "quais", "sobre", "dados"].includes(token)));
  if (tokens.has("inadimplencia")) ["npl", "credito", "perda"].forEach((token) => tokens.add(token));
  if (tokens.has("roic")) ["roe", "rentabilidade", "retorno"].forEach((token) => tokens.add(token));
  return tokens;
}

function retrievalAnchorScore(gap, searchable) {
  const question = gapKey(gap);
  const text = gapKey(searchable);
  let score = 0;
  const explicitAcronyms = String(gap || "").match(/\b[A-Z][A-Z0-9-]{2,}\b/g) || [];
  for (const acronym of explicitAcronyms) {
    const token = gapKey(acronym);
    if (token && new RegExp(`(?:^| )${token}(?: |$)`).test(text)) score += 4;
  }
  if ((question.includes("inadimplencia") || question.includes(" npl ") || question.startsWith("npl ")) &&
      (text.includes("inadimplencia") || /(?:^| )npl(?: |$)/.test(text))) score += 4;
  if (question.includes("payout") && text.includes("payout")) score += 3;
  if (question.includes("dividend") && (text.includes("dividend") || text.includes("jcp"))) score += 2;
  return score;
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

export function selectBibliotecaChunks(chunks = [], gaps = []) {
  const expected = Array.isArray(gaps) ? gaps.map((gap) => String(gap || "").trim()).filter(Boolean) : [];
  if (!expected.length) return chunks.slice(0, MAX_CHUNKS).map((chunk) => ({ chunk, matches: [] }));
  const scored = chunks.map((chunk, index) => {
    const searchable = `${chunk.titulo || ""}\n${chunk.secao || ""}\n${chunk.texto || ""}`;
    const matches = expected.map((gap) => ({ gap, score: gapSimilarity(gap, searchable), anchor: retrievalAnchorScore(gap, searchable) }))
      .filter((match) => match.score >= 0.12 || match.anchor > 0)
      .sort((a, b) => b.anchor - a.anchor || b.score - a.score);
    return {
      chunk,
      index,
      matches,
      score: matches[0]?.score || Number(chunk.search_rank || 0),
      userSource: chunk.fonte === "ri",
    };
  });
  const selected = [];
  for (const gap of expected) {
    const forGap = scored.filter((item) => item.matches.some((match) => match.gap === gap))
      .sort((a, b) => {
        const left = a.matches.find((match) => match.gap === gap) || { score: 0, anchor: 0 };
        const right = b.matches.find((match) => match.gap === gap) || { score: 0, anchor: 0 };
        return right.anchor - left.anchor || right.score - left.score ||
          Number(b.chunk.search_rank || 0) - Number(a.chunk.search_rank || 0) ||
          Number(b.userSource) - Number(a.userSource) || a.index - b.index;
      }).slice(0, 2);
    for (const item of forGap) if (!selected.some((entry) => entry.chunk.chunk_id === item.chunk.chunk_id)) selected.push(item);
  }
  if (!selected.length) selected.push(...scored.sort((a, b) => b.score - a.score || Number(b.userSource) - Number(a.userSource) || a.index - b.index).slice(0, MAX_CHUNKS));
  return selected.slice(0, MAX_CHUNKS).map(({ chunk, matches }) => ({ chunk, matches }));
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
    const [chunkCandidates, inventory] = await Promise.all([
      typeof repository.searchChunksByTicker === "function" ? repository.searchChunksByTicker({ ticker, gaps, limite: 60 }) : [],
      typeof repository.countDocumentsByTicker === "function" ? repository.countDocumentsByTicker(ticker) : null,
    ]);
    const selectedChunks = selectBibliotecaChunks(chunkCandidates, gaps);
    let remaining = MAX_TOTAL_CHARS;
    let normalized;
    if (selectedChunks.length) {
      const grouped = new Map();
      for (const { chunk, matches } of selectedChunks) {
        if (remaining <= 0) break;
        const text = String(chunk.texto || "").slice(0, remaining);
        remaining -= text.length;
        if (!text) continue;
        if (!grouped.has(chunk.dedup_key)) grouped.set(chunk.dedup_key, {
          id: chunk.dedup_key,
          source: chunk.fonte,
          trust: chunk.fonte === "ri" ? "user_supplied" : "official_registry",
          title: chunk.titulo || chunk.categoria || "Documento oficial",
          date: chunk.data_documento,
          url: chunk.url_origem,
          chunks: [],
          tables: [],
          matchedGaps: [],
        });
        const document = grouped.get(chunk.dedup_key);
        document.chunks.push({ id: chunk.chunk_id, pageStart: chunk.pagina_inicio, pageEnd: chunk.pagina_fim, section: chunk.secao, text });
        document.tables.push(...(Array.isArray(chunk.tabelas_json) ? chunk.tabelas_json.slice(0, 4) : []));
        document.matchedGaps.push(...matches.map((match) => match.gap));
      }
      normalized = [...grouped.values()].map((document) => ({
        ...document,
        text: document.chunks.map((chunk) => `[Páginas ${chunk.pageStart}${chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : ""} · ${chunk.id}]\n${chunk.text}`).join("\n\n"),
        tables: document.tables.slice(0, 8),
        matchedGaps: [...new Set(document.matchedGaps)],
      }));
    } else {
      const candidates = await repository.listParsedByTicker({ ticker, limite: MAX_CANDIDATE_DOCUMENTS });
      const selected = selectBibliotecaDocuments(candidates, gaps);
      normalized = selected.map(({ document, matches }) => {
        const text = String(document.texto_corrido || "").slice(0, remaining);
        remaining -= text.length;
        return {
          id: document.dedup_key, source: document.fonte,
          trust: document.fonte === "ri" ? "user_supplied" : "official_registry",
          title: document.titulo || document.categoria || "Documento oficial",
          date: document.data_documento, url: document.url_origem, text,
          chunks: [], tables: Array.isArray(document.tabelas_json) ? document.tabelas_json.slice(0, 8) : [],
          matchedGaps: matches.map((match) => match.gap), legacyFallback: true,
        };
      }).filter((document) => document.text);
    }
    return {
      version: B3_CONTEXT_VERSION,
      available: normalized.length > 0,
      status: normalized.length > 0 ? "ready" : "no_documents",
      documents: normalized,
      documentIds: normalized.map((document) => document.id),
      chunkIds: normalized.flatMap((document) => document.chunks?.map((chunk) => chunk.id) || []),
      inventory: inventory || { total: normalized.length, indexed: selectedChunks.length ? normalized.length : 0 },
      retrievalMode: selectedChunks.length ? "selective_chunks" : "legacy_document_fallback",
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
    `BIBLIOTECA VIVA ${B3_CONTEXT_VERSION}: ${context.inventory?.total ?? context.documents.length} documento(s) no acervo; ${context.documents.length} fonte(s) e ${context.chunkIds?.length || 0} trecho(s) recuperado(s) para estas lacunas.\n` +
    "Registros CVM têm origem oficial. Itens RI com trust=user_supplied foram informados pelo usuário e devem manter essa ressalva de proveniência. A fonte integral permanece fora do prompt; apenas trechos selecionados são apresentados. Use somente IDs de documento listados como evidencia_documental. Se o conteúdo não responder à lacuna, marque-a aberta.\n\n" + records
  );
}

export function applyBibliotecaAudit(result, context, { expectedGaps = [] } = {}) {
  const allowed = new Set(context?.documentIds || []);
  const declared = Array.isArray(result?.lacunas_documentais) ? result.lacunas_documentais : [];
  const answers = Array.isArray(result?.lacunas) ? result.lacunas : [];
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
    const answerMatch = bestGapMatch(String(item?.lacuna || ""), answers, (answer) => answer?.q || answer?.lacuna);
    const answerText = answerMatch?.score >= 0.2 ? String(answerMatch.candidate?.r || answerMatch.candidate?.resposta || "") : "";
    const admitsIncompleteEvidence = /parcialmente\s+resolvid|lacuna\s+permanece\s+aberta|permanece\s+(?:aberta|limitad)|n[aã]o\s+(?:foi|est[aá])\s+(?:declarad|informad)|sem\s+(?:esses|estes|dados|informa[cç][oõ]es)/i.test(answerText);
    const resolved = item?.status === "resolvida" && evidence.length > 0 && !admitsIncompleteEvidence;
    return { lacuna: String(item?.lacuna || "Lacuna documental"), status: resolved ? "resolvida" : "aberta", evidencia_documental: evidence };
  });
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
    chunks_consulted: context?.chunkIds || [],
    documents_available: Number(context?.inventory?.total ?? context?.documents?.length ?? 0),
    documents_indexed: Number(context?.inventory?.indexed || 0),
    retrieval_mode: context?.retrievalMode || "unavailable",
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
