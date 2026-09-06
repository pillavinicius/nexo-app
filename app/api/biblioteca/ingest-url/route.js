export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { createDatabaseClient, databaseConfiguration } from "../../../../lib/nexo/biblioteca/database.mjs";
import { createBibliotecaRepository } from "../../../../lib/nexo/biblioteca/repository.mjs";
import { ingestUserSource } from "../../../../lib/nexo/biblioteca/url_ingestion.mjs";

const ERROR_MESSAGES = {
  biblioteca_source_url_invalid: "Informe um endereço HTTPS válido.",
  biblioteca_source_url_https_required: "A fonte precisa usar HTTPS e não pode conter credenciais.",
  biblioteca_source_url_private_forbidden: "Endereços internos ou privados não são permitidos.",
  biblioteca_source_redirect_limit: "A fonte excedeu o limite seguro de redirecionamentos.",
  biblioteca_document_too_large: "O documento excede o limite de 12 MB.",
  biblioteca_document_size_invalid: "O documento está vazio ou excede o limite permitido.",
  biblioteca_asset_not_applicable: "A Biblioteca Viva brasileira não está disponível para ativos no exterior nesta fase.",
  biblioteca_database_unavailable: "A Biblioteca Viva está temporariamente indisponível. Tente novamente em instantes.",
  biblioteca_source_network_unavailable: "Não foi possível acessar o endereço informado. Confirme se o documento está público e tente novamente.",
  biblioteca_source_asset_lookup_failed: "Não foi possível associar a fonte ao ativo desta análise.",
  biblioteca_source_download_failed: "O servidor não conseguiu baixar o documento público informado.",
  biblioteca_source_parse_failed: "O documento foi baixado, mas não pôde ser interpretado dentro do limite do servidor.",
  biblioteca_source_database_failed: "O documento foi processado, mas a Biblioteca não conseguiu gravá-lo. Tente novamente.",
};

function publicErrorCode(error) {
  const raw = String(error?.message || "biblioteca_source_ingestion_failed");
  if (/^biblioteca_source_http_/.test(raw)) return "biblioteca_source_network_unavailable";
  if (/^biblioteca_/.test(raw)) return raw;
  if (/^(ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|fetch failed)$/i.test(raw) || error?.cause) return "biblioteca_source_network_unavailable";
  return "biblioteca_source_ingestion_failed";
}

export async function POST(request) {
  try {
    if (!databaseConfiguration().configured) throw new Error("biblioteca_database_unavailable");
    const body = await request.json();
    const result = await ingestUserSource({
      repository: createBibliotecaRepository(createDatabaseClient()),
      ticker: body?.ticker,
      assetType: body?.assetType,
      sourceUrl: body?.url,
      relevanceTerms: [body?.focus, ...(Array.isArray(body?.gaps) ? body.gaps : [])].filter(Boolean).slice(0, 8),
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    const code = publicErrorCode(error);
    return Response.json({ ok: false, error: { code, message: ERROR_MESSAGES[code] || "Não foi possível importar essa fonte para a Biblioteca Viva." } }, { status: 422 });
  }
}
