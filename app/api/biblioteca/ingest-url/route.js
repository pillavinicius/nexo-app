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
  biblioteca_source_parse_failed: "Não foi possível interpretar o documento informado.",
};

export async function POST(request) {
  try {
    if (!databaseConfiguration().configured) throw new Error("biblioteca_database_unavailable");
    const body = await request.json();
    const result = await ingestUserSource({
      repository: createBibliotecaRepository(createDatabaseClient()),
      ticker: body?.ticker,
      assetType: body?.assetType,
      sourceUrl: body?.url,
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    const code = String(error?.message || "biblioteca_source_ingestion_failed");
    return Response.json({ ok: false, error: { code, message: ERROR_MESSAGES[code] || "Não foi possível importar essa fonte para a Biblioteca Viva." } }, { status: 422 });
  }
}
