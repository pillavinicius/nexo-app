import { createDatabaseClient, databaseConfiguration } from "./database.mjs";
import { createBibliotecaRepository } from "./repository.mjs";
import { deriveFallbackScanGaps } from "../analysis/gap_integrity.mjs";

export const B3_CONTEXT_VERSION = "BIB_B3_2_CONTEXT_v2.8";
const MAX_DOCUMENTS = 6;
const MAX_CANDIDATE_DOCUMENTS = 20;
const MAX_CHUNKS = 12;
const MAX_CHUNKS_PER_GAP = 4;
const MAX_TOTAL_CHARS = 28_000;
const METRIC_ALIASES = [
  { key: "adjusted_net_income", label: "lucro líquido ajustado", aliases: ["adjusted net income", "lucro liquido ajustado", "lucro ajustado"] },
  { key: "cost_of_credit", label: "custo do crédito", aliases: ["cost of credit", "cost of risk", "custo do credito", "custo de credito", "custo de risco"] },
  { key: "net_interest_income", label: "margem financeira", aliases: ["net interest income", "margem financeira", "resultado de juros"] },
  { key: "fee_income", label: "receita de tarifas", aliases: ["fee income", "fee revenues", "receita de tarifas", "receitas de tarifas"] },
  { key: "administrative_expenses", label: "despesas administrativas", aliases: ["administrative expenses", "despesas administrativas"] },
  { key: "payout", label: "payout", aliases: ["payout", "dividend payout"] },
  { key: "npl_90", label: "inadimplência acima de 90 dias", aliases: ["inad 90d", "inad 90 dias", "inadimplencia 90d", "inadimplencia acima de 90 dias", "npl 90d", "npl 90 dias"] },
  { key: "npl_90_coverage", label: "cobertura da inadimplência acima de 90 dias", aliases: ["cobertura 90d", "cobertura inad 90d", "90d coverage ratio", "npl 90d coverage"] },
  { key: "new_npl", label: "formação de New NPL", aliases: ["new npl formation", "formacao new npl", "new npl agro", "new npl"] },
  { key: "new_npl_coverage", label: "cobertura de New NPL", aliases: ["cobertura new npl", "new npl coverage", "coverage new npl"] },
];
const FINANCIAL_NUMBER_PATTERN = /(?:^|[^\p{L}\d])(-?\d+(?:[.,]\d+)?)(?:\s*(?:%|bn|bi|bilh(?:a|ã)o(?:es|ões)?|mi|mn|milh(?:a|ã)o(?:es|ões)?))?(?=$|[^\p{L}\d])/giu;

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
  if ((question.includes("cet1") || question.includes("basileia")) &&
      (text.includes("basileia") || text.includes("capital principal") || text.includes("nivel i") || /(?:^| )rwa(?: |$)/.test(text))) score += 4;
  if (/\d[,.]\d+\s*%/.test(String(searchable || ""))) score += 1;
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

function extractFinancialNumbers(value) {
  const numbers = [];
  for (const match of String(value || "").matchAll(FINANCIAL_NUMBER_PATTERN)) {
    const token = match[1];
    const normalized = token.includes(",") && token.includes(".")
      ? (token.lastIndexOf(",") > token.lastIndexOf(".")
        ? token.replace(/\./g, "").replace(",", ".")
        : token.replace(/,/g, ""))
      : token.replace(",", ".");
    const number = Number(normalized);
    if (!Number.isFinite(number)) continue;
    if (Number.isInteger(number) && number >= 1900 && number <= 2100) continue;
    if (!numbers.some((candidate) => Math.abs(candidate - number) < 0.0001)) numbers.push(number);
  }
  return numbers;
}

function numbersEquivalent(left, right) {
  return Math.abs(left - right) <= Math.max(0.05, Math.abs(right) * 0.002);
}

function documentSupportsAnswer(document, gap, answerText) {
  if (!document?.id || !String(document.text || "").trim()) return false;
  if (!asArray(document.matchedGaps).some((matched) => gapSimilarity(gap, matched) >= 0.5)) return false;
  const answerValues = extractFinancialNumbers(answerText);
  if (!answerValues.length) return false;
  const documentValues = extractFinancialNumbers(document.text);
  const shared = answerValues.filter((answerValue) => documentValues.some((documentValue) => numbersEquivalent(answerValue, documentValue)));
  return shared.length >= Math.min(2, answerValues.length);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function anchoredTableRow(row) {
  const cells = asArray(row).map((cell) => String(cell || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const label = cells[0] || "";
  if (cells.length < 2 || label.length > 90 || !/[\p{L}]{2}/u.test(label) || !/\d/.test(cells.slice(1).join(" "))) return null;
  if (/^(?:and|e|r\$|us\$|bn|bi|mi|mn|total)$/i.test(label)) return null;
  return cells;
}

export function formatBibliotecaTables(tables = []) {
  const rowsByPage = new Map();
  const seen = new Set();
  for (const table of asArray(tables)) {
    const page = Number(table?.page) || "?";
    for (const rawRow of asArray(table?.rows)) {
      const row = anchoredTableRow(rawRow);
      if (!row) continue;
      const rendered = `| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
      const key = `${page}:${rendered}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!rowsByPage.has(page)) rowsByPage.set(page, []);
      rowsByPage.get(page).push(rendered);
    }
  }
  return [...rowsByPage.entries()].flatMap(([page, rows]) => [`[Página ${page}]`, ...rows]).join("\n");
}

function metricsMentioned(value) {
  const text = ` ${gapKey(value)} `;
  const matches = METRIC_ALIASES.map((metric) => ({
    metric,
    specificity: Math.max(0, ...metric.aliases
      .filter((alias) => text.includes(` ${alias} `))
      .map((alias) => alias.length)),
  })).filter((item) => item.specificity > 0);
  const maximum = Math.max(0, ...matches.map((item) => item.specificity));
  return matches.filter((item) => item.specificity === maximum).map((item) => item.metric);
}

function metricLedger(context) {
  const ledger = new Map(METRIC_ALIASES.map((metric) => [metric.key, { ...metric, values: [] }]));
  for (const document of asArray(context?.documents)) {
    for (const table of asArray(document?.tables)) {
      for (const rawRow of asArray(table?.rows)) {
        const row = anchoredTableRow(rawRow);
        if (!row) continue;
        const metric = metricsMentioned(row[0]);
        if (metric.length !== 1) continue;
        const entry = ledger.get(metric[0].key);
        for (const value of extractFinancialNumbers(row.slice(1).join(" "))) {
          if (!entry.values.some((candidate) => numbersEquivalent(candidate, value))) entry.values.push(value);
        }
      }
    }
    for (const segment of String(document?.text || "").split(/\n+|(?<=[.!?;])\s+/).map((item) => item.trim()).filter(Boolean)) {
      const metric = metricsMentioned(segment);
      if (metric.length !== 1) continue;
      const entry = ledger.get(metric[0].key);
      for (const value of extractFinancialNumbers(segment)) {
        if (!entry.values.some((candidate) => numbersEquivalent(candidate, value))) entry.values.push(value);
      }
    }
  }
  return ledger;
}

function analysisStrings(value, path = "$", output = []) {
  if (typeof value === "string") {
    for (const segment of value.split(/(?<=[.!?;])\s+|(?<=%)\s*(?:,|e|enquanto)\s+(?=(?:cobertura|INAD|NPL|New\s+NPL|Est[aá]gio|carteira|perda)\b)|\n+/i).map((item) => item.trim()).filter(Boolean)) {
      output.push({ path, text: segment });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => analysisStrings(item, `${path}[${index}]`, output));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["evidencia_documental", "fonte_nova"].includes(key)) continue;
      analysisStrings(item, `${path}.${key}`, output);
    }
  }
  return output;
}

function prioritizedMetricConflicts(conflicts) {
  const unique = [];
  const seen = new Set();
  for (const conflict of conflicts) {
    const key = `${conflict.path}:${conflict.target_metric_key || conflict.target_metric}:${conflict.conflicting_metric_key || conflict.conflicting_metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(conflict);
  }
  return unique.sort((left, right) => {
    const leftAdjustment = /^\$\.ajustes_score\[/.test(String(left.path || ""));
    const rightAdjustment = /^\$\.ajustes_score\[/.test(String(right.path || ""));
    return Number(rightAdjustment) - Number(leftAdjustment);
  }).slice(0, 24);
}

export function findBibliotecaMetricConflicts(result, context) {
  const conflicts = [];
  const strings = analysisStrings(result);
  for (const item of strings) {
    const normalizedText = gapKey(item.text);
    const capitalMinimumClaim = /\b(?:cet1|capital principal|tier 1|nivel 1|basileia)\b/.test(normalizedText) &&
      /\bminim[oa](?:s)?(?: regulamentar| regulatorio)?\b/.test(normalizedText);
    if (capitalMinimumClaim && !/\b(?:base|buffer|colchao|adicional)\b/.test(normalizedText)) {
      conflicts.push({
        path: item.path,
        target_metric_key: "capital_requirement",
        target_metric: "requerimento de capital sem decomposição",
        conflicting_metric: "mínimo-base, buffers e adicionais institucionais devem ser distinguidos",
        conflicting_values: extractFinancialNumbers(item.text).map(String),
      });
      continue;
    }
    if (/\binad\b/.test(normalizedText) && !/\binad(?:implencia)?\s*(?:30|90)d?\b/.test(normalizedText) && !/\bnew\s+npl\b/.test(normalizedText)) {
      conflicts.push({
        path: item.path,
        target_metric_key: "npl_unspecified",
        target_metric: "inadimplência sem janela definida",
        conflicting_metric: "INAD/NPL +30d, +90d e New NPL são métricas distintas",
        conflicting_values: extractFinancialNumbers(item.text).map(String),
      });
      continue;
    }
  }

  if (!context?.available) return prioritizedMetricConflicts(conflicts);
  const ledger = metricLedger(context);
  const populated = [...ledger.values()].filter((entry) => entry.values.length);
  if (populated.length < 2) return prioritizedMetricConflicts(conflicts);
  for (const item of strings) {
    const normalizedText = gapKey(item.text);
    if (/\binad\b/.test(normalizedText) && !/\binad(?:implencia)?\s*(?:30|90)d?\b/.test(normalizedText) && !/\bnew\s+npl\b/.test(normalizedText)) continue;
    if (/\b(?:cet1|capital principal|tier 1|nivel 1|basileia)\b/.test(normalizedText) &&
        /\bminim[oa](?:s)?(?: regulamentar| regulatorio)?\b/.test(normalizedText) &&
        !/\b(?:base|buffer|colchao|adicional)\b/.test(normalizedText)) continue;
    const mentioned = metricsMentioned(item.text).filter((metric) => ledger.get(metric.key)?.values.length);
    if (mentioned.length !== 1) continue;
    const target = ledger.get(mentioned[0].key);
    const claimed = extractFinancialNumbers(item.text);
    if (!claimed.length || claimed.some((value) => target.values.some((expected) => numbersEquivalent(value, expected)))) continue;
    const foreign = populated.map((candidate) => ({
      candidate,
      matches: claimed.filter((value) => candidate.key !== target.key && candidate.values.some((expected) => numbersEquivalent(value, expected))),
    })).sort((left, right) => right.matches.length - left.matches.length)[0];
    if (!foreign || foreign.matches.length < 1) continue;
    conflicts.push({
      path: item.path,
      target_metric_key: target.key,
      target_metric: target.label,
      conflicting_metric_key: foreign.candidate.key,
      conflicting_metric: foreign.candidate.label,
      conflicting_values: foreign.matches.map((value) => String(value)),
    });
  }
  return prioritizedMetricConflicts(conflicts);
}

export function reconcileBibliotecaMetricConflicts(result, conflicts = []) {
  const governed = typeof structuredClone === "function"
    ? structuredClone(result || {})
    : JSON.parse(JSON.stringify(result || {}));
  const reconciled = [];
  const correctedPaths = new Set();
  const rejectedAdjustmentIndexes = new Set();

  for (const conflict of asArray(conflicts)) {
    const tokens = String(conflict?.path || "")
      .replace(/^\$\.?/, "")
      .match(/[^.[\]]+/g) || [];
    if (!tokens.length) continue;
    let parent = governed;
    for (const token of tokens.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !(token in parent)) {
        parent = null;
        break;
      }
      parent = parent[token];
    }
    const key = tokens.at(-1);
    if (!parent || typeof parent !== "object" || typeof parent[key] !== "string") continue;
    const original = parent[key];
    let corrected = original;
    if (conflict.target_metric === "inadimplência sem janela definida") {
      corrected = corrected
        .replace(/\bINAD\s+New\s+NPL\b/gi, "formação de New NPL")
        .replace(/\bINAD\b(?!\s*(?:\+?\s*(?:30|90)|New\s+NPL))/gi, "inadimplência com janela não especificada");
    } else if (conflict.target_metric === "requerimento de capital sem decomposição") {
      corrected = corrected
        .replace(/\s*\(\s*incluindo\s+adicionais(?:\s+institucionais)?\s*\)/gi, "")
        .replace(/\bacima\s+d(?:o|os|a|as)\s+m[ií]nim[oa]s?(?:\s+regulat[oó]ri[oa]s?)?/gi, "acima das referências regulatórias citadas")
        .replace(/\b(?:vs\.?|versus)\s+m[ií]nim[oa]s?(?:\s+regulat[oó]ri[oa]s?)?/gi, "ante a referência regulatória citada")
        .replace(/\bm[ií]nim[oa]s?\s+regulat[oó]ri[oa]s?\b/gi, "referências regulatórias citadas");
      corrected = `${corrected.replace(/[.\s]+$/g, "")}. A decomposição entre mínimo-base, buffers e adicionais institucionais não foi comprovada pelos trechos disponíveis.`;
    } else if (conflict.target_metric_key && conflict.conflicting_metric) {
      const metricPatterns = {
        npl_90: /\b(?:INAD(?:IMPL[EÊ]NCIA)?|NPL)\s*\+?\s*90\s*d(?:ias?)?\b/gi,
        npl_90_coverage: /\bcobertura(?:\s+da)?\s+(?:INAD(?:IMPL[EÊ]NCIA)?|NPL)\s*\+?\s*90\s*d(?:ias?)?\b/gi,
        new_npl: /\b(?:forma[cç][aã]o\s+(?:de\s+)?|INAD\s+)?New\s+NPL\b/gi,
        new_npl_coverage: /\bcobertura(?:\s+de)?\s+New\s+NPL\b/gi,
        adjusted_net_income: /\blucro\s+l[ií]quido\s+ajustado\b/gi,
        cost_of_credit: /\bcusto\s+(?:do|de)\s+cr[eé]dito\b/gi,
      };
      const pattern = metricPatterns[conflict.target_metric_key];
      if (pattern) corrected = corrected.replace(pattern, conflict.conflicting_metric);
    } else if (conflict.target_metric && conflict.conflicting_metric) {
      const escaped = String(conflict.target_metric).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      corrected = corrected.replace(new RegExp(escaped, "gi"), conflict.conflicting_metric);
    }
    if (corrected === original && !correctedPaths.has(conflict.path)) {
      corrected = `${original} A classificação exata dessa métrica permanece limitada pela evidência disponível.`;
    }
    parent[key] = corrected;
    if (corrected !== original) correctedPaths.add(conflict.path);
    const adjustmentMatch = String(conflict.path || "").match(/^\$\.ajustes_score\[(\d+)\]/);
    if (adjustmentMatch) rejectedAdjustmentIndexes.add(Number(adjustmentMatch[1]));
    reconciled.push({
      path: conflict.path,
      target_metric: conflict.target_metric,
      conflicting_metric: conflict.conflicting_metric,
    });
  }

  if (rejectedAdjustmentIndexes.size && Array.isArray(governed.ajustes_score)) {
    governed.ajustes_score = governed.ajustes_score.filter((_, index) => !rejectedAdjustmentIndexes.has(index));
  }

  if (reconciled.length) {
    governed.integridade_analise = {
      ...(governed.integridade_analise || {}),
      biblioteca_metric_conflicts_reconciled: reconciled,
      biblioteca_score_adjustments_rejected: [...rejectedAdjustmentIndexes],
    };
  }
  return governed;
}

function normalizeGapAnswer(status, answerText, { preserveOpenBody = true } = {}) {
  const body = String(answerText || "").trim().replace(
    /^(?:lacuna\s+)?(?:parcialmente\s+resolvida(?:\s+para\s+\d{4}(?:[–-]\d{4})?)?|resolvida|parcial|aberta)\s*[:.;—-]?\s*/i,
    ""
  );
  if (status === "aberta") {
    if (!preserveOpenBody) return "Lacuna aberta. Não há fonte primária processada na Biblioteca Viva para responder esta pergunta sem criar estimativas não auditáveis.";
    return `Lacuna aberta.${body ? ` ${body}` : " Não respondida com evidência documental suficiente neste Deep."}`;
  }
  if (status === "parcial") return `Parcialmente resolvida.${body ? ` ${body}` : " Há evidência útil, mas ainda falta parte da resposta solicitada."}`;
  return `Resolvida.${body ? ` ${body}` : " Com evidência documental."}`;
}

export function answerAdmitsIncompleteEvidence(answerText) {
  const text = String(answerText || "");
  return [
    /parcialmente\s+resolvid/i,
    /permanece\s+parcialmente\s+aberta/i,
    /lacuna[^.!?\n]{0,180}\bparcialmente\s+aberta/i,
    /lacuna\s+permanece\s+aberta/i,
    /permanece\s+(?:aberta|limitad)/i,
    /n[aã]o\s+(?:foi|foram|est[aá]|est[aã]o)\s+(?:explicitamente\s+)?(?:declarad|informad|recuperad|localizad|disponibilizad|apresentad|inclu[ií]d)/i,
    /(?:dados|valores|informa[cç][oõ]es|detalhes|componentes|tabelas|sensibilidade|composi[cç][aã]o|provis[oõ]es)[^.!?\n]{0,180}\bn[aã]o\s+const(?:a|am)\b/i,
    /\bn[aã]o\s+const(?:a|am)\b[^.!?\n]{0,120}(?:trechos|excertos|documentos|fontes?)/i,
    /sem\s+(?:esses|estes|os|dados|valores|informa[cç][oõ]es|detalhes|componentes)/i,
    /\bn[aã]o\s+(?:est[aá]|est[aã]o)\s+(?:nos?|entre\s+os)\s+(?:trechos|excertos|documentos|fontes|dados)\s+dispon[ií]ve/i,
    /\bn[aã]o\s+(?:[ée]\s+)?(?:explicitad|informad|fornecid|dispon[ií]vel|recuperad|localizad)/i,
    /\bn[aã]o\s+(?:foi|foram)\s+(?:segregad|discriminad|detalhad|desagregad)/i,
    /(?:dados|valores|informa[cç][oõ]es|m[eé]tricas)[^.!?\n]{0,120}\bn[aã]o\s+(?:foi|foram)\s+(?:segregad|discriminad|detalhad|desagregad)/i,
  ].some((pattern) => pattern.test(text));
}

function documentLabels(context) {
  const ticker = String(context?.ticker || "").trim().toUpperCase();
  return asArray(context?.documents).map((document, index) => {
    const rawTitle = String(document?.title || "").trim();
    const titleLooksTechnical = !rawTitle || rawTitle === document?.id || /^(?:cvm_ipe|cvm_fnet|cvm_rad|ri):/i.test(rawTitle);
    const title = titleLooksTechnical
      ? String(document?.category || document?.source || "Documento oficial").trim()
      : rawTitle;
    const rawDate = String(document?.date || "").trim();
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00Z`) : null;
    const date = parsedDate && Number.isFinite(parsedDate.getTime())
      ? parsedDate.toLocaleDateString("pt-BR", { timeZone: "UTC" })
      : rawDate;
    const parts = [ticker, title, date].filter(Boolean);
    return {
      id: document.id,
      label: `Documento ${index + 1} — ${parts.join(" · ")}`,
      title,
      date: date || null,
    };
  });
}

function hasUnsupportedEstimate(value) {
  return /\b(?:estimad[oa]s?|assumid[oa]s?|hip[oó]tese)\b/i.test(String(value || ""));
}

function sanitizeOpenGapThesis(value, openGaps = []) {
  const source = String(value || "").trim();
  if (!source || !openGaps.length) return { value: source, changed: false };
  const sentences = source.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/u).filter(Boolean);
  const kept = sentences.filter((sentence) => {
    const numericClaim = /(?:R\$|US\$|USD|BRL|%|\d+(?:[.,]\d+)?\s*(?:bi|mi|x|\/t|\/a[cç][aã]o))/i.test(sentence);
    if (!numericClaim) return true;
    return !openGaps.some((gap) => gapSimilarity(gap, sentence) >= 0.16);
  });
  if (kept.length === sentences.length) return { value: source, changed: false };
  kept.push("As lacunas sem fonte primária permanecem abertas; estimativas associadas a elas não foram incorporadas à tese governada.");
  return { value: kept.join(" "), changed: true };
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
      }).slice(0, MAX_CHUNKS_PER_GAP);
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
    : history.scan
    ? deriveFallbackScanGaps(history.scan)
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
      ticker,
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
    return `BIBLIOTECA VIVA ${B3_CONTEXT_VERSION}: nenhum documento processado disponível para este ativo. Não invente evidências documentais. Marque como aberta cada lacuna que dependa de fonte primária. Para lacunas abertas, não forneça números, estimativas, intervalos, datas ou fontes alegadamente públicas que não estejam no contexto recebido; não transporte essas alegações para valuation, score ou tese_final.`;
  }
  const records = context.documents.map((document) => {
    const tables = formatBibliotecaTables(document.tables);
    return `[${document.id}] trust=${document.trust} · ${document.date || "data não informada"} · ${document.title}` +
      (document.matchedGaps?.length ? `\nLACUNAS RELACIONADAS: ${document.matchedGaps.join(" | ")}` : "") +
      (tables ? `\nTABELAS ESTRUTURADAS (associação métrica-valor autoritativa):\n${tables}` : "") +
      `\nTRECHOS TEXTUAIS:\n${document.text}`;
  }).join("\n\n");
  return (
    `BIBLIOTECA VIVA ${B3_CONTEXT_VERSION}: ${context.inventory?.total ?? context.documents.length} documento(s) no acervo; ${context.documents.length} fonte(s) e ${context.chunkIds?.length || 0} trecho(s) recuperado(s) para estas lacunas.\n` +
    "Registros CVM têm origem oficial. Itens RI com trust=user_supplied foram informados pelo usuário e devem manter essa ressalva de proveniência. A fonte integral permanece fora do prompt; apenas trechos selecionados são apresentados. Use somente IDs de documento listados como evidencia_documental. Classifique cada lacuna como resolvida, parcial ou aberta: parcial significa que há evidência útil, mas falta ao menos um componente pedido; aberta significa que os trechos não oferecem resposta suficiente. A mera menção de que uma figura ou tabela existe no documento integral não resolve a lacuna quando os valores solicitados não aparecem nos trechos recuperados. Nas tabelas, associe valores somente ao rótulo presente na mesma linha estruturada. Nunca associe números vizinhos do texto achatado a uma métrica. Linhas numéricas órfãs foram suprimidas; se a relação entre rótulo e valor continuar ambígua, marque a lacuna como parcial ou aberta, sem improvisar.\n\n" + records
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
    const answerMatch = bestGapMatch(String(item?.lacuna || ""), answers, (answer) => answer?.q || answer?.lacuna);
    const answerText = answerMatch?.score >= 0.2 ? String(answerMatch.candidate?.r || answerMatch.candidate?.resposta || "") : "";
    const explicitEvidence = (Array.isArray(item?.evidencia_documental) ? item.evidencia_documental : []).filter((id) => allowed.has(id));
    const citedAnswerEvidence = [...allowed].filter((id) => answerText.includes(id));
    const inferredEvidence = asArray(context?.documents)
      .filter((document) => documentSupportsAnswer(document, String(item?.lacuna || ""), answerText))
      .map((document) => document.id);
    const evidence = [...new Set([...explicitEvidence, ...citedAnswerEvidence, ...inferredEvidence])];
    const admitsIncompleteEvidence = answerAdmitsIncompleteEvidence(answerText);
    const retrievalVerified = citedAnswerEvidence.length > 0 || inferredEvidence.length > 0;
    const declaredStatus = gapKey(item?.status);
    const resolved = evidence.length > 0 && !admitsIncompleteEvidence && (declaredStatus === "resolvida" || retrievalVerified);
    const partial = evidence.length > 0 && (declaredStatus === "parcial" || admitsIncompleteEvidence);
    return { lacuna: String(item?.lacuna || "Lacuna documental"), status: resolved ? "resolvida" : partial ? "parcial" : "aberta", evidencia_documental: evidence };
  });
  const governedAnswers = gaps.map((gap) => {
    const match = bestGapMatch(gap.lacuna, answers, (item) => item?.q || item?.lacuna);
    const candidate = match?.score >= 0.2 ? match.candidate : {};
    return {
      ...candidate,
      q: gap.lacuna,
      r: normalizeGapAnswer(gap.status, candidate?.r || candidate?.resposta, { preserveOpenBody: Boolean(context?.available) }),
    };
  });
  const openGaps = gaps.filter((gap) => gap.status === "aberta").map((gap) => gap.lacuna);
  const thesis = !context?.available ? sanitizeOpenGapThesis(result?.tese_final, openGaps) : { value: result?.tese_final, changed: false };
  const governedPrices = !context?.available
    ? asArray(result?.preco).map((layer) => {
        const narrative = `${layer?.met || ""} ${layer?.prem || ""}`;
        const relatesToOpenGap = openGaps.some((gap) => gapSimilarity(gap, narrative) >= 0.12);
        if (!hasUnsupportedEstimate(narrative) || !relatesToOpenGap) return layer;
        return {
          ...layer,
          calc: {
            ...(layer?.calc && typeof layer.calc === "object" ? layer.calc : {}),
            evidencia_status: "insuficiente",
            origem_base: "HIPOTESE",
          },
        };
      })
    : result?.preco;
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
    document_labels: documentLabels(context),
    lacunas_abertas: gaps.filter((gap) => gap.status !== "resolvida").map((gap) => gap.lacuna),
    lacunas_parciais: gaps.filter((gap) => gap.status === "parcial").map((gap) => gap.lacuna),
    lacunas_resolvidas: gaps.filter((gap) => gap.status === "resolvida").map((gap) => gap.lacuna),
    requires_user_source: gaps.some((gap) => gap.status !== "resolvida"),
    gap_scope: expectedGaps.length ? "governed_by_previous_stage" : "model_declared",
    expected_gap_count: expectedGaps.length || gaps.length,
    discarded_new_gaps: discarded,
    unsupported_open_gap_claims_removed: thesis.changed,
  };
  return {
    ...result,
    preco: governedPrices,
    tese_final: thesis.value,
    lacunas: governedAnswers,
    lacunas_documentais: gaps,
    nexoModules: { ...(result?.nexoModules || {}), BIBLIOTECA: audit },
  };
}
