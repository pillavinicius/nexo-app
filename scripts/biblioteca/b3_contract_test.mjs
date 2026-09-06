#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import PDFDocument from "pdfkit";

import { reconcileDeepIntegrity } from "../../lib/nexo/analysis/reclassification_integrity.mjs";
import { applyBibliotecaAudit, buildBibliotecaPromptContext } from "../../lib/nexo/biblioteca/context.mjs";
import { extractHtmlText, parseDocument, parsePendingDocuments } from "../../lib/nexo/biblioteca/document_parser.mjs";
import { ingestUserSource, isPrivateAddress, validatePublicHttpsUrl } from "../../lib/nexo/biblioteca/url_ingestion.mjs";

function makePdf(text) {
  return new Promise((resolve) => {
    const document = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.fontSize(14).text(text);
    document.end();
  });
}

assert.match(extractHtmlText(Buffer.from("<html><script>não usar</script><h1>Resultado trimestral</h1><p>Lucro recorrente maior.</p></html>")), /Resultado trimestral\nLucro recorrente maior/);
const pdf = await makePdf("Documento oficial NEXO B3");
const parsedPdf = await parseDocument({ content: pdf, formato: "pdf" });
assert.equal(parsedPdf.status, "ok");
assert.match(parsedPdf.texto, /Documento oficial NEXO B3/);

const updates = [];
const pendingResult = await parsePendingDocuments({ repository: {
  async listPendingDocuments() { return [{ dedup_key: "cvm_ipe:1", formato: "html", conteudo_binario: Buffer.from("<p>Evidência oficial</p>"), hash_conteudo: "a".repeat(64) }]; },
  async updateParseState(value) { updates.push(value); },
} });
assert.deepEqual(pendingResult, { discovered: 1, parsed: 1, unsupported: 0, failed: 0 });
assert.equal(updates[0].status, "ok");

const context = {
  available: true,
  status: "ready",
  documentIds: ["cvm_ipe:doc-1"],
  documents: [{ id: "cvm_ipe:doc-1", date: "2026-08-19", title: "Fato Relevante", text: "A companhia confirmou a evidência nova." }],
};
assert.match(buildBibliotecaPromptContext(context), /cvm_ipe:doc-1/);
const baseline = { scan: { score_total: 21, score_max: 30, score_dimensoes: [{ nome: "Qualidade de earnings", nota: 3 }] } };
const candidate = {
  ticker: "BBAS3", veredito_final: "COMPRAR", zona: "R$ 20 a R$ 22", besst: "R$ 15 a R$ 18",
  ajustes_score: [{ dimensao: "Qualidade de earnings", antes: 3, depois: 4, motivo: "Evidência documental nova", fonte_nova: "cvm_ipe:doc-1" }],
  lacunas: [{ q: "Qualidade do resultado", r: "Confirmada" }],
  lacunas_documentais: [{ lacuna: "Qualidade do resultado", status: "resolvida", evidencia_documental: ["cvm_ipe:doc-1"] }],
};
const candidateWithoutLibrary = { ...candidate, veredito_final: "MONITORAR", ajustes_score: [], lacunas_documentais: [{ lacuna: "Qualidade do resultado", status: "aberta", evidencia_documental: [] }] };
const withoutLibrary = applyBibliotecaAudit(reconcileDeepIntegrity(candidateWithoutLibrary, baseline, { documentIds: [] }), { available: false, status: "no_documents", documentIds: [], documents: [] });
const withLibrary = applyBibliotecaAudit(reconcileDeepIntegrity(candidate, baseline, { documentIds: context.documentIds }), context);
assert.equal(withoutLibrary.score_revisado, 21, "fonte documental inexistente não pode mover o score");
assert.equal(withoutLibrary.veredito_final, "MONITORAR");
assert.equal(withoutLibrary.nexoModules.BIBLIOTECA.requires_user_source, true);
assert.equal(withLibrary.score_revisado, 22, "documento válido pode lastrear ajuste explícito");
assert.equal(withLibrary.veredito_final, "COMPRAR");
assert.equal(withLibrary.nexoModules.BIBLIOTECA.requires_user_source, false);
console.log("SIMULAÇÃO B3 · sem Biblioteca: MONITORAR 21/30 · com Biblioteca: COMPRAR 22/30");

for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.2", "::1", "fd00::1"]) assert.equal(isPrivateAddress(address), true);
await assert.rejects(() => validatePublicHttpsUrl("http://ri.exemplo.com/doc.pdf", { lookupImpl: async () => [{ address: "203.0.113.5" }] }), /https_required/);
await assert.rejects(() => validatePublicHttpsUrl("https://localhost/doc.pdf", { lookupImpl: async () => [{ address: "127.0.0.1" }] }), /private_forbidden/);

const stored = [];
const parseUpdates = [];
const ingested = await ingestUserSource({
  ticker: "BBAS3",
  sourceUrl: "https://ri.exemplo.com/documento",
  lookupImpl: async () => [{ address: "203.0.113.5" }],
  fetchImpl: async () => new Response("<html><h1>Release oficial</h1><p>Guidance confirmado.</p></html>", { status: 200, headers: { "content-type": "text/html" } }),
  repository: {
    async findAssetByTicker() { return { ticker: "BBAS3", issuer_id: "cvm:1023" }; },
    async findByDedupKey() { return null; },
    async insertIngestedDocument(value) { stored.push(value); return { inserted: true }; },
    async updateParseState(value) { parseUpdates.push(value); },
  },
  now: () => new Date("2026-09-06T12:00:00Z"),
});
assert.equal(ingested.inserted, true);
assert.equal(stored[0].fonte, "ri");
assert.equal(parseUpdates[0].status, "ok");

const page = await readFile(join(process.cwd(), "app", "page.jsx"), "utf8");
assert.ok(!page.includes("Link RI / Dados Oficiais"), "campo RI inicial precisa ser removido");
assert.ok(page.includes("Fonte oficial para fechar as lacunas · obrigatório"));
assert.ok(page.includes('fetch("/api/biblioteca/ingest-url"'));
const migration = await readFile(join(process.cwd(), "db", "migrations", "003_biblioteca_b3.sql"), "utf8");
for (const token of ["parser_version", "data_parse", "003_biblioteca_b3"]) assert.ok(migration.includes(token));

console.log("Biblioteca B3 parser/context/link fallback: OK");
