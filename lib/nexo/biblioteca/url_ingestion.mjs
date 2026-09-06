import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { MAX_DOCUMENT_BYTES } from "./ipe_ingestion.mjs";
import { B3_PARSER_VERSION, parseDocument } from "./document_parser.mjs";

const MAX_REDIRECTS = 3;

function privateIpv4(address) {
  const parts = address.split(".").map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224;
}

export function isPrivateAddress(address) {
  if (isIP(address) === 4) return privateIpv4(address);
  const normalized = String(address || "").toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export async function validatePublicHttpsUrl(value, { lookupImpl = lookup } = {}) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("biblioteca_source_url_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("biblioteca_source_url_https_required");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase()) || isPrivateAddress(url.hostname)) {
    throw new Error("biblioteca_source_url_private_forbidden");
  }
  const addresses = await lookupImpl(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("biblioteca_source_url_private_forbidden");
  return url;
}

async function fetchPublicDocument(initialUrl, { fetchImpl, lookupImpl }) {
  let url = await validatePublicHttpsUrl(initialUrl, { lookupImpl });
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(url, { redirect: "manual", headers: { "User-Agent": "NEXO-Biblioteca-B3/1.0", Accept: "application/pdf,text/html,text/plain,application/xml,application/json" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === MAX_REDIRECTS) throw new Error("biblioteca_source_redirect_limit");
      const location = response.headers.get("location");
      if (!location) throw new Error("biblioteca_source_redirect_invalid");
      url = await validatePublicHttpsUrl(new URL(location, url).toString(), { lookupImpl });
      continue;
    }
    if (!response.ok) throw new Error(`biblioteca_source_http_${response.status}`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) throw new Error("biblioteca_document_too_large");
    const chunks = [];
    let total = 0;
    if (!response.body?.getReader) throw new Error("biblioteca_document_body_unavailable");
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOCUMENT_BYTES) {
        await reader.cancel();
        throw new Error("biblioteca_document_too_large");
      }
      chunks.push(Buffer.from(value));
    }
    const content = Buffer.concat(chunks, total);
    if (!content.length || content.length > MAX_DOCUMENT_BYTES) throw new Error("biblioteca_document_size_invalid");
    const type = (response.headers.get("content-type") || "").toLowerCase();
    const formato = content.subarray(0, 5).toString("latin1") === "%PDF-" ? "pdf"
      : type.includes("html") || /^\s*</.test(content.subarray(0, 100).toString("utf8")) ? "html"
      : type.includes("json") ? "json"
      : type.includes("xml") ? "xml"
      : type.startsWith("text/") ? "text" : "outro";
    return { url: url.toString(), content, formato, contentTypeDeclarado: type || null };
  }
  throw new Error("biblioteca_source_redirect_limit");
}

export async function ingestUserSource({ repository, ticker, assetType = "acao-br", sourceUrl, relevanceTerms = [], fetchImpl = fetch, lookupImpl = lookup, now = () => new Date() }) {
  if (!["acao-br", "fii"].includes(assetType)) throw new Error("biblioteca_asset_not_applicable");
  let asset = await repository.findAssetByTicker(ticker);
  if (!asset) asset = await repository.ensureProvisionalAsset({ ticker, classe: assetType });
  const validated = await validatePublicHttpsUrl(sourceUrl, { lookupImpl });
  const sourceDocumentId = createHash("sha256").update(validated.toString()).digest("hex");
  const dedupKey = `ri:${sourceDocumentId}`;
  const existing = await repository.findByDedupKey(dedupKey);
  const existingMetadata = typeof existing?.metadata_json === "string"
    ? JSON.parse(existing.metadata_json || "{}")
    : existing?.metadata_json || {};
  const requestedTerms = [...new Set(relevanceTerms.map((term) => String(term || "").trim()).filter(Boolean))];
  const existingTerms = Array.isArray(existingMetadata.relevance_terms) ? existingMetadata.relevance_terms : [];
  const effectiveTerms = [...new Set([...existingTerms, ...requestedTerms])].slice(0, 16);
  const alreadyIndexedForRequest = requestedTerms.every((term) => existingTerms.includes(term));
  if (existing?.status_parse === "ok" && existing?.parser_version === B3_PARSER_VERSION && alreadyIndexedForRequest) {
    return { inserted: false, dedupKey, status: "ok", alreadyExisting: true };
  }

  const downloaded = await fetchPublicDocument(validated.toString(), { fetchImpl, lookupImpl });
  const hashConteudo = createHash("sha256").update(downloaded.content).digest("hex");
  const parsed = await parseDocument({ content: downloaded.content, formato: downloaded.formato, relevanceTerms: effectiveTerms });
  if (parsed.status !== "ok") throw new Error(parsed.erro || "biblioteca_source_parse_failed");

  const stored = await repository.upsertParsedDocument({
    dedupKey,
    issuerId: asset.issuer_id,
    fonte: "ri",
    sourceDocumentId,
    categoria: "Fonte complementar do usuário",
    tipo: "Aprofundamento Deep",
    titulo: `Fonte complementar · ${validated.hostname}`,
    dataDocumento: now().toISOString().slice(0, 10),
    urlOrigem: downloaded.url,
    formato: downloaded.formato,
    metadata: {
      supplied_by_user: true,
      requested_ticker: asset.ticker,
      relevance_terms: effectiveTerms,
      relevant_pdf_pages: parsed.relevantPageNumbers || [],
      raw_binary_persisted: false,
    },
    tamanhoBytes: downloaded.content.length,
    contentTypeDeclarado: downloaded.contentTypeDeclarado,
    hashConteudo,
    texto: parsed.texto,
    tabelas: parsed.tabelas,
    parserVersion: parsed.parserVersion,
    existing: Boolean(existing),
  });
  return {
    inserted: stored.inserted,
    dedupKey,
    status: "ok",
    alreadyExisting: Boolean(existing),
    characters: parsed.texto.length,
    relevantPdfPages: parsed.relevantPageNumbers || [],
  };
}
