import { createHash, randomUUID } from "node:crypto";

import { unzipSync } from "fflate";

import { parseIpeCsv, detectDocumentFormat, CVM_IPE_BASE } from "../../../scripts/biblioteca/amostra_formatos.mjs";
import { createBibliotecaRepository } from "./repository.mjs";

export const B2_VERSION = "BIB_B2_v1.0";
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function discoverIpeDocuments(rows, universe) {
  const assets = new Map(universe.assets.map((asset) => [`${digits(asset.cnpj)}|${String(asset.codigo_cvm)}`, asset]));
  return rows.flatMap((row) => {
    const asset = assets.get(`${digits(row.CNPJ_Companhia)}|${String(row.Codigo_CVM)}`);
    if (!asset || !asset.categorias.includes(row.Categoria)) return [];
    const date = row.Data_Referencia || row.Data_Entrega;
    if (asset.desde && date < asset.desde) return [];
    return [{
      asset,
      dedupKey: `cvm_ipe:${row.Protocolo_Entrega}`,
      issuerId: asset.issuer_id,
      fonte: "cvm_ipe",
      sourceDocumentId: row.Protocolo_Entrega,
      categoria: row.Categoria,
      tipo: row.Tipo || null,
      titulo: row.Assunto || row.Especie || row.Categoria,
      dataDocumento: date,
      urlOrigem: row.Link_Download,
      metadata: { especie: row.Especie || null, versao: row.Versao || null, tipo_apresentacao: row.Tipo_Apresentacao || null },
    }];
  }).sort((a, b) => a.dataDocumento.localeCompare(b.dataDocumento) || a.dedupKey.localeCompare(b.dedupKey));
}

async function loadIpeIndex(year, fetchImpl) {
  const url = `${CVM_IPE_BASE}/ipe_cia_aberta_${year}.zip`;
  const response = await fetchImpl(url, { headers: { "User-Agent": "NEXO-Biblioteca-B2/1.0" } });
  if (!response.ok) throw new Error(`biblioteca_ipe_index_http_${response.status}`);
  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const entry = Object.entries(archive).find(([name]) => name.toLowerCase().endsWith(".csv"));
  if (!entry) throw new Error("biblioteca_ipe_csv_missing");
  return parseIpeCsv(new TextDecoder("windows-1252").decode(entry[1]));
}

async function downloadDocument(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: "follow", headers: { "User-Agent": "NEXO-Biblioteca-B2/1.0" } });
  if (!response.ok) throw new Error(`biblioteca_document_http_${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) throw new Error("biblioteca_document_too_large");
  const content = Buffer.from(await response.arrayBuffer());
  if (!content.length || content.length > MAX_DOCUMENT_BYTES) throw new Error("biblioteca_document_size_invalid");
  const detected = detectDocumentFormat(content.subarray(0, 8192));
  return {
    content,
    formato: detected === "other" || detected === "empty" ? "outro" : detected,
    contentTypeDeclarado: response.headers.get("content-type") || null,
    hashConteudo: createHash("sha256").update(content).digest("hex"),
  };
}

export async function ingestIpe({ client, universe, fetchImpl = fetch, now = () => new Date() }) {
  const repository = createBibliotecaRepository(client);
  for (const asset of universe.assets) {
    await repository.upsertIssuer({ issuerId: asset.issuer_id, nome: asset.nome, cnpj: asset.cnpj, codigoCvm: asset.codigo_cvm });
    await repository.upsertAsset({ ticker: asset.ticker, issuerId: asset.issuer_id, classe: asset.classe, mercado: asset.mercado });
  }
  const indexes = await Promise.all(universe.years.map((year) => loadIpeIndex(year, fetchImpl)));
  const discovered = discoverIpeDocuments(indexes.flat(), universe);
  const result = { version: B2_VERSION, discovered: discovered.length, alreadyExisting: 0, downloaded: 0, inserted: 0, conflicts: 0, failures: [], bytesDownloaded: 0 };
  for (const document of discovered) {
    if (await repository.findByDedupKey(document.dedupKey)) { result.alreadyExisting += 1; continue; }
    try {
      const downloaded = await downloadDocument(document.urlOrigem, fetchImpl);
      result.downloaded += 1;
      result.bytesDownloaded += downloaded.content.length;
      const stored = await repository.insertIngestedDocument({ ...document, ...downloaded, conteudo: downloaded.content });
      if (stored.inserted) result.inserted += 1;
      else result.conflicts += 1;
    } catch (error) {
      result.failures.push({ dedupKey: document.dedupKey, error: String(error?.message || error).slice(0, 120) });
    }
  }
  result.completedAt = now().toISOString();
  return result;
}

export async function proveIpeDeduplication({ client, universe, fetchImpl = fetch, now = () => new Date() }) {
  const repository = createBibliotecaRepository(client);
  const started = now().toISOString();
  const runId = `b2:${randomUUID()}`;
  try {
    const before = await repository.countDocuments({ fonte: "cvm_ipe" });
    const first = await ingestIpe({ client, universe, fetchImpl, now });
    const afterFirst = await repository.countDocuments({ fonte: "cvm_ipe" });
    const second = await ingestIpe({ client, universe, fetchImpl, now });
    const afterSecond = await repository.countDocuments({ fonte: "cvm_ipe" });
    const dedupProven = second.downloaded === 0 && second.inserted === 0 && afterSecond === afterFirst;
    const run = {
      runId, iniciadoEm: started, concluidoEm: now().toISOString(), status: dedupProven && first.failures.length === 0 ? "ok" : "falhou",
      descobertos: first.discovered, jaExistentes: second.alreadyExisting, baixados: first.downloaded + second.downloaded,
      inseridos: first.inserted + second.inserted, falhas: first.failures.length + second.failures.length,
      bytesBaixados: first.bytesDownloaded + second.bytesDownloaded, dedupProvada: dedupProven,
      detalhes: { version: B2_VERSION, before, after_first: afterFirst, after_second: afterSecond, first, second },
    };
    await repository.recordIngestionRun(run);
    if (!dedupProven) throw new Error("biblioteca_b2_dedup_not_proven");
    if (run.status !== "ok") throw new Error("biblioteca_b2_ingestion_failed");
    return run;
  } catch (error) {
    if (!["biblioteca_b2_dedup_not_proven", "biblioteca_b2_ingestion_failed"].includes(error?.message)) {
      await repository.recordIngestionRun({
        runId, iniciadoEm: started, concluidoEm: now().toISOString(), status: "falhou",
        descobertos: 0, jaExistentes: 0, baixados: 0, inseridos: 0, falhas: 1,
        bytesBaixados: 0, dedupProvada: false,
        detalhes: { version: B2_VERSION, error: String(error?.message || error).slice(0, 120) },
      }).catch(() => {});
    }
    throw error;
  }
}
