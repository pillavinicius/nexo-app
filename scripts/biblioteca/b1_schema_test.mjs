#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BIBLIOTECA_SCHEMA_VERSION, bibliotecaDatabaseHealth, databaseConfiguration } from "../../lib/nexo/biblioteca/database.mjs";
import { createBibliotecaRepository, normalizeTicker } from "../../lib/nexo/biblioteca/repository.mjs";

const migration = readFileSync(new URL("../../db/migrations/001_biblioteca_b1.sql", import.meta.url), "utf8");
const conditionalMigration = readFileSync(new URL("./migrate_if_configured.mjs", import.meta.url), "utf8");
for (const token of [
  "CREATE SCHEMA IF NOT EXISTS biblioteca",
  "biblioteca.emissores",
  "biblioteca.ativos",
  "biblioteca.documentos",
  "dedup_key          TEXT PRIMARY KEY",
  "status_parse       TEXT NOT NULL",
  "documentos_fonte_id_unico",
  "idx_documentos_issuer_data",
]) assert.ok(migration.includes(token), `migração sem ${token}`);
assert.ok(conditionalMigration.includes("process.env.VERCEL"), "deploy precisa exigir conexão configurada");
assert.ok(conditionalMigration.includes('await import("./migrate.mjs")'), "deploy precisa aplicar a migração");

assert.equal(databaseConfiguration({}).configured, false);
assert.equal(databaseConfiguration({ DATABASE_URL: "postgresql://example/db" }).configured, true);
assert.equal((await bibliotecaDatabaseHealth({ env: {} })).status, "not_configured");
assert.equal((await bibliotecaDatabaseHealth({ client: { query: async () => [{ version: BIBLIOTECA_SCHEMA_VERSION }] } })).status, "ready");
const unavailable = await bibliotecaDatabaseHealth({ client: { query: async () => { throw new Error("postgresql://secret@private-host/db"); } } });
assert.equal(unavailable.status, "unavailable");
assert.equal(unavailable.error, "biblioteca_database_unavailable");
assert.ok(!JSON.stringify(unavailable).includes("secret"), "health não pode expor string de conexão");
assert.equal(normalizeTicker(" bbas3 "), "BBAS3");
assert.throws(() => normalizeTicker("BBAS3;DROP"), /ticker_invalid/);

const calls = [];
const client = {
  async query(text, params) {
    calls.push({ text, params });
    if (text.includes("ON CONFLICT (dedup_key)")) return [{ dedup_key: params[0], status_parse: "pendente" }];
    if (text.includes("JOIN biblioteca.ativos")) return [];
    if (text.includes("UPDATE biblioteca.documentos")) return [{ dedup_key: params[0], status_parse: params[1] }];
    return [{ issuer_id: params[0], ticker: params[0] }];
  },
};
const repository = createBibliotecaRepository(client);
await repository.upsertIssuer({ issuerId: "cvm:1023", nome: "Banco do Brasil", cnpj: "00.000.000/0001-91", codigoCvm: "1023" });
await repository.upsertAsset({ ticker: "bbas3", issuerId: "cvm:1023" });
const inserted = await repository.insertDocumentMetadata({
  dedupKey: "cvm_ipe:12345", issuerId: "cvm:1023", fonte: "cvm_ipe",
  sourceDocumentId: "12345", formato: "pdf", urlOrigem: "https://www.rad.cvm.gov.br/documento",
});
assert.equal(inserted.inserted, true);
assert.equal(inserted.document.status_parse, "pendente");
await repository.listByTicker({ ticker: "bbas3", limite: 999 });
assert.equal(calls.at(-1).params[3], 100, "limite de consulta precisa ser controlado");
await repository.updateParseState({ dedupKey: "cvm_ipe:12345", status: "falhou", erro: "fixture" });
await assert.rejects(() => repository.insertDocumentMetadata({ dedupKey: "errada", issuerId: "x", fonte: "cvm_ipe", sourceDocumentId: "1", formato: "pdf", urlOrigem: "https://x" }), /dedup_key_invalid/);
await assert.rejects(() => repository.updateParseState({ dedupKey: "x", status: "ok" }), /parse_output_required/);

console.log(`Biblioteca B1 schema/repository: OK (${calls.length} operações)`);
