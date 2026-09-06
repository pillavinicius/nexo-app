#!/usr/bin/env node

import assert from "node:assert/strict";

import { zipSync } from "fflate";

import { discoverIpeDocuments, proveIpeDeduplication } from "../../lib/nexo/biblioteca/ipe_ingestion.mjs";

const universe = {
  version: "BIB_UNIVERSE_v1.0", years: [2026], assets: [{
    ticker: "BBAS3", issuer_id: "cvm:1023", nome: "BANCO DO BRASIL S.A.",
    cnpj: "00000000000191", codigo_cvm: "1023", classe: "acao-br", mercado: "B3",
    categorias: ["Fato Relevante"], desde: "2026-08-01",
  }],
};
const rows = [
  { CNPJ_Companhia: "00.000.000/0001-91", Codigo_CVM: "1023", Categoria: "Fato Relevante", Data_Referencia: "2026-08-12", Protocolo_Entrega: "P1", Link_Download: "https://rad/doc1", Assunto: "Documento 1" },
  { CNPJ_Companhia: "00.000.000/0001-91", Codigo_CVM: "1023", Categoria: "Fato Relevante", Data_Referencia: "2026-08-19", Protocolo_Entrega: "P2", Link_Download: "https://rad/doc2", Assunto: "Documento 2" },
  { CNPJ_Companhia: "00.000.000/0001-91", Codigo_CVM: "1023", Categoria: "Assembleia", Data_Referencia: "2026-08-20", Protocolo_Entrega: "P3", Link_Download: "https://rad/doc3" },
];
assert.deepEqual(discoverIpeDocuments(rows, universe).map((item) => item.dedupKey), ["cvm_ipe:P1", "cvm_ipe:P2"]);

const csv = [
  "CNPJ_Companhia;Nome_Companhia;Codigo_CVM;Data_Referencia;Categoria;Tipo;Especie;Assunto;Data_Entrega;Tipo_Apresentacao;Protocolo_Entrega;Versao;Link_Download",
  "00.000.000/0001-91;BANCO DO BRASIL S.A.;1023;2026-08-12;Fato Relevante;;;Documento 1;2026-08-12;AP;P1;1;https://rad/doc1",
  "00.000.000/0001-91;BANCO DO BRASIL S.A.;1023;2026-08-19;Fato Relevante;;;Documento 2;2026-08-19;AP;P2;1;https://rad/doc2",
].join("\n");
const archive = zipSync({ "ipe_cia_aberta_2026.csv": new TextEncoder().encode(csv) });
const documents = new Map();
const runs = [];
let documentFetches = 0;
const client = {
  async query(text, params = []) {
    if (text.includes("INSERT INTO biblioteca.emissores") || text.includes("INSERT INTO biblioteca.ativos")) return [{}];
    if (text.includes("SELECT * FROM biblioteca.documentos")) return documents.has(params[0]) ? [documents.get(params[0])] : [];
    if (text.includes("INSERT INTO biblioteca.documentos")) {
      if (documents.has(params[0])) return [];
      const row = { dedup_key: params[0], status_parse: "pendente", tamanho_bytes: params[12], hash_conteudo: params[14] };
      documents.set(params[0], row);
      return [row];
    }
    if (text.includes("count(*)::integer")) return [{ total: documents.size }];
    if (text.includes("INSERT INTO biblioteca.ingestion_runs")) { runs.push(params); return [{}]; }
    throw new Error(`SQL não simulado: ${text.slice(0, 60)}`);
  },
};
const fetchImpl = async (url) => {
  if (String(url).endsWith("ipe_cia_aberta_2026.zip")) return new Response(archive, { status: 200 });
  documentFetches += 1;
  return new Response(new TextEncoder().encode(`%PDF-1.7 fixture ${url}`), { status: 200, headers: { "content-type": "text/html" } });
};
const proof = await proveIpeDeduplication({ client, universe, fetchImpl, now: () => new Date("2026-09-06T15:00:00Z") });
assert.equal(proof.dedupProvada, true);
assert.equal(proof.inseridos, 2);
assert.equal(proof.baixados, 2);
assert.equal(proof.jaExistentes, 2);
assert.equal(documentFetches, 2, "segundo passe não pode baixar os documentos outra vez");
assert.equal(documents.size, 2);
assert.equal(runs.length, 1);

console.log("Biblioteca B2 ingestion/dedup: OK (segunda execução baixou 0 documentos)");
