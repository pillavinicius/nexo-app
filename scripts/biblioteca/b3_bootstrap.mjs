#!/usr/bin/env node

import { createDatabaseClient } from "../../lib/nexo/biblioteca/database.mjs";
import { parsePendingDocuments, reindexStoredDocuments } from "../../lib/nexo/biblioteca/document_parser.mjs";
import { createBibliotecaRepository } from "../../lib/nexo/biblioteca/repository.mjs";
import { ingestUserSource } from "../../lib/nexo/biblioteca/url_ingestion.mjs";

const repository = createBibliotecaRepository(createDatabaseClient());
const result = await parsePendingDocuments({ repository, limit: 20 });
if (result.failed > 0) throw new Error(`Biblioteca B3: ${result.failed} documento(s) falharam no parse`);
const reindex = await reindexStoredDocuments({ repository, limit: 20 });
const legacyRi = typeof repository.listRiDocumentsWithoutBinary === "function"
  ? await repository.listRiDocumentsWithoutBinary({ limite: 10 })
  : [];
let riRecovered = 0;
let riFailed = 0;
for (const document of legacyRi) {
  if (!document.ticker) continue;
  let metadata = document.metadata_json || {};
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
  }
  try {
    await ingestUserSource({
      repository,
      ticker: document.ticker,
      assetType: /^[A-Z]{4}11$/.test(document.ticker) ? "fii" : "acao-br",
      sourceUrl: document.url_origem,
      relevanceTerms: Array.isArray(metadata.relevance_terms) ? metadata.relevance_terms : [],
    });
    riRecovered += 1;
  } catch {
    riFailed += 1;
  }
}
console.log(`Biblioteca B3.2: pendentes=${result.discovered} · processados=${result.parsed} · reindexados=${reindex.indexed}/${reindex.discovered} · RI integral=${riRecovered}/${legacyRi.length} · falhas de backfill=${reindex.failed + riFailed}`);
