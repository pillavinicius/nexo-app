import { createDatabaseClient, databaseConfiguration } from "./database.mjs";
import { createBibliotecaRepository } from "./repository.mjs";

export const B3_CONTEXT_VERSION = "BIB_B3_CONTEXT_v1.0";
const MAX_DOCUMENTS = 6;
const MAX_TOTAL_CHARS = 28_000;

export async function loadBibliotecaContext({ ticker, client = null } = {}) {
  if (!databaseConfiguration().configured && !client) {
    return { version: B3_CONTEXT_VERSION, available: false, status: "database_unavailable", documents: [], documentIds: [] };
  }
  try {
    const repository = createBibliotecaRepository(client || createDatabaseClient());
    const documents = await repository.listParsedByTicker({ ticker, limite: MAX_DOCUMENTS });
    let remaining = MAX_TOTAL_CHARS;
    const normalized = documents.map((document) => {
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
    `[${document.id}] trust=${document.trust} · ${document.date || "data não informada"} · ${document.title}\n${document.text}` +
    (document.tables?.length ? `\nTABELAS EXTRAÍDAS:\n${JSON.stringify(document.tables)}` : "")
  ).join("\n\n");
  return (
    `BIBLIOTECA VIVA ${B3_CONTEXT_VERSION}: ${context.documents.length} documento(s) processado(s).\n` +
    "Registros CVM têm origem oficial. Itens RI com trust=user_supplied foram informados pelo usuário e devem manter essa ressalva de proveniência. Use somente IDs listados como evidencia_documental. Se o conteúdo não responder à lacuna, marque-a aberta.\n\n" + records
  );
}

export function applyBibliotecaAudit(result, context) {
  const allowed = new Set(context?.documentIds || []);
  const declared = Array.isArray(result?.lacunas_documentais) ? result.lacunas_documentais : [];
  const fallback = Array.isArray(result?.lacunas) ? result.lacunas.map((item) => ({
    lacuna: item?.q || item?.lacuna || String(item || "Lacuna documental"),
    status: context?.available ? "aberta" : "aberta",
    evidencia_documental: [],
  })) : [];
  const gaps = (declared.length ? declared : fallback).map((item) => {
    const evidence = [...new Set((Array.isArray(item?.evidencia_documental) ? item.evidencia_documental : []).filter((id) => allowed.has(id)))];
    const resolved = item?.status === "resolvida" && evidence.length > 0;
    return { lacuna: String(item?.lacuna || "Lacuna documental"), status: resolved ? "resolvida" : "aberta", evidencia_documental: evidence };
  });
  const audit = {
    version: B3_CONTEXT_VERSION,
    status: context?.status || "unavailable",
    consulted: true,
    documents_used: [...new Set(gaps.flatMap((gap) => gap.evidencia_documental))],
    documents_available: context?.documents?.length || 0,
    user_supplied_documents: context?.documents?.filter((document) => document.trust === "user_supplied").map((document) => document.id) || [],
    lacunas_abertas: gaps.filter((gap) => gap.status === "aberta").map((gap) => gap.lacuna),
    lacunas_resolvidas: gaps.filter((gap) => gap.status === "resolvida").map((gap) => gap.lacuna),
    requires_user_source: gaps.some((gap) => gap.status === "aberta"),
  };
  return { ...result, lacunas_documentais: gaps, nexoModules: { ...(result?.nexoModules || {}), BIBLIOTECA: audit } };
}
