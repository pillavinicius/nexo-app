export const B3_PARSER_VERSION = "BIB_B3_PARSER_v1.1";
export const MAX_CONTEXT_DOCUMENT_CHARS = 18_000;
const MAX_RELEVANT_PAGES = 12;

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, token) => {
    if (token[0] === "#") {
      const hex = token[1]?.toLowerCase() === "x";
      const code = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entities[token.toLowerCase()] ?? match;
  });
}

export function extractHtmlText(content) {
  const html = Buffer.from(content).toString("utf8");
  return normalizeText(decodeEntities(html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
}

function tableRows(items, pageNumber) {
  const grouped = new Map();
  for (const item of items) {
    const value = String(item.str || "").trim();
    if (!value) continue;
    const x = Number(item.transform?.[4] || 0);
    const y = Math.round(Number(item.transform?.[5] || 0) / 2) * 2;
    if (!grouped.has(y)) grouped.set(y, []);
    grouped.get(y).push({ x, value });
  }
  const candidates = [...grouped.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, cells]) => cells.sort((a, b) => a.x - b.x).map((cell) => cell.value))
    .filter((cells) => cells.length >= 3 && cells.some((cell) => /\d/.test(cell)));
  return candidates.length >= 2 ? [{ page: pageNumber, rows: candidates.slice(0, 80) }] : [];
}

async function extractPdfContent(content) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(content),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  const tables = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const text = await page.getTextContent();
    pages.push({ number, text: normalizeText(text.items.map((item) => item.str || "").join(" ")) });
    tables.push(...tableRows(text.items, number));
  }
  await loadingTask.destroy();
  return { pages, tabelas: tables };
}

function searchTokens(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]{3,}/g) || [])
    .filter((token) => !["para", "pela", "pelo", "como", "qual", "quais", "sobre", "carteira", "documento", "fonte"].includes(token))
  )];
}

export function selectRelevantPdfContent(pages, tables, relevanceTerms = []) {
  const tokens = searchTokens(relevanceTerms);
  if (!tokens.length) {
    return {
      texto: normalizeText(pages.map((page) => page.text).join("\n\n")).slice(0, MAX_CONTEXT_DOCUMENT_CHARS),
      tabelas: tables.slice(0, 40),
      relevantPageNumbers: [],
    };
  }

  const ranked = pages.map((page) => {
    const normalized = page.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const matches = tokens.filter((token) => normalized.includes(token));
    return { ...page, score: matches.reduce((score, token) => score + (token.length >= 5 ? 2 : 1), 0), matches: matches.length };
  }).filter((page) => page.matches > 0)
    .sort((a, b) => b.score - a.score || b.matches - a.matches || a.number - b.number)
    .slice(0, MAX_RELEVANT_PAGES);

  const selected = ranked.length ? ranked : pages.slice(0, MAX_RELEVANT_PAGES);
  const relevantPageNumbers = selected.map((page) => page.number);
  const relevantText = selected.map((page) => `[Página ${page.number}]\n${page.text}`).join("\n\n");
  const intro = pages.slice(0, 3).map((page) => `[Página ${page.number}]\n${page.text}`).join("\n\n").slice(0, 2_500);
  return {
    texto: normalizeText(`TRECHOS SELECIONADOS PARA AS LACUNAS:\n${relevantText}\n\nINÍCIO DO DOCUMENTO:\n${intro}`).slice(0, MAX_CONTEXT_DOCUMENT_CHARS),
    tabelas: tables.filter((table) => relevantPageNumbers.includes(table.page)).slice(0, 40),
    relevantPageNumbers,
  };
}

export async function parseDocument({ content, formato, relevanceTerms = [] }) {
  const bytes = Buffer.from(content || []);
  if (!bytes.length) throw new Error("biblioteca_parse_content_required");
  let texto = "";
  let tabelas = [];
  let relevantPageNumbers = [];
  if (formato === "pdf") {
    const extracted = await extractPdfContent(bytes);
    ({ texto, tabelas, relevantPageNumbers } = selectRelevantPdfContent(extracted.pages, extracted.tabelas, relevanceTerms));
  }
  else if (["html", "text", "xml", "json"].includes(formato)) texto = formato === "html" ? extractHtmlText(bytes) : normalizeText(bytes.toString("utf8"));
  else return { status: "nao_suportado", texto: null, tabelas: [], parserVersion: B3_PARSER_VERSION, erro: `formato_${formato}_nao_suportado` };
  if (!texto) return { status: "falhou", texto: null, tabelas: [], parserVersion: B3_PARSER_VERSION, erro: "biblioteca_parse_text_empty" };
  return {
    status: "ok",
    texto: texto.slice(0, MAX_CONTEXT_DOCUMENT_CHARS),
    tabelas,
    relevantPageNumbers,
    parserVersion: B3_PARSER_VERSION,
    erro: null,
  };
}

export async function parsePendingDocuments({ repository, limit = 20 }) {
  const pending = await repository.listPendingDocuments({ limite: limit });
  const result = { discovered: pending.length, parsed: 0, unsupported: 0, failed: 0 };
  for (const document of pending) {
    try {
      const parsed = await parseDocument({ content: document.conteudo_binario, formato: document.formato });
      await repository.updateParseState({
        dedupKey: document.dedup_key,
        status: parsed.status,
        texto: parsed.texto,
        tabelas: parsed.tabelas,
        hashConteudo: document.hash_conteudo,
        erro: parsed.erro,
        parserVersion: parsed.parserVersion,
      });
      if (parsed.status === "ok") result.parsed += 1;
      else if (parsed.status === "nao_suportado") result.unsupported += 1;
      else result.failed += 1;
    } catch (error) {
      result.failed += 1;
      await repository.updateParseState({
        dedupKey: document.dedup_key,
        status: "falhou",
        hashConteudo: document.hash_conteudo,
        erro: String(error?.message || error).slice(0, 240),
        parserVersion: B3_PARSER_VERSION,
      });
    }
  }
  return result;
}
