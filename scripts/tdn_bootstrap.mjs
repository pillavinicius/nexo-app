#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { createDatabaseClient } from "../lib/nexo/biblioteca/database.mjs";

const root = process.cwd();
const matrix = JSON.parse(await readFile(join(root, "data", "goldberg", "tdn_sector_matrix.json"), "utf8"));
const payload = JSON.parse(gunzipSync(await readFile(join(root, "data", "goldberg", "tdn_fatos.json.gz"))).toString("utf8"));
const client = createDatabaseClient();
const cvmKey = (value) => String(Number(value));

for (const [ticker, asset] of Object.entries(matrix.assets || {})) {
  const codigoCvm = cvmKey(asset.codigo_cvm);
  const issuerId = `cvm:${codigoCvm}`;
  const companyName = payload.facts.find((fact) => fact.ticker === ticker)?.company_name || ticker;
  await client.query(
    `INSERT INTO biblioteca.emissores (issuer_id, nome, codigo_cvm, mercado)
     VALUES ($1, $2, $3, 'BR')
     ON CONFLICT (issuer_id) DO UPDATE SET nome = EXCLUDED.nome, codigo_cvm = EXCLUDED.codigo_cvm, atualizado_em = now()`,
    [issuerId, companyName, codigoCvm]
  );
  await client.query(
    `INSERT INTO biblioteca.ativos (ticker, issuer_id, classe, mercado)
     VALUES ($1, $2, 'acao-br', 'B3')
     ON CONFLICT (ticker) DO UPDATE SET issuer_id = EXCLUDED.issuer_id, ativo = TRUE, atualizado_em = now()`,
    [ticker, issuerId]
  );
}

const rows = payload.facts.map((fact) => ({
  issuer_id: `cvm:${cvmKey(fact.codigo_cvm)}`,
  metrica: fact.metric,
  periodo_inicio: fact.period_start,
  periodo_fim: fact.period_end,
  exercicio: fact.fiscal_year,
  valor: fact.value,
  unidade: fact.unit,
  escopo: fact.scope,
  versao_documento: fact.filing_version,
  conhecido_em: fact.known_at,
  fonte: fact.source,
  referencia_fonte: fact.source_ref,
  metadata_json: {
    company_name: fact.company_name,
    source_url: fact.source_url,
    account_code: fact.account_code,
    account_label: fact.account_label,
    collector_version: payload.collector_version,
  },
}));

const inserted = await client.query(
  `WITH incoming AS (
     SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
       issuer_id text, metrica text, periodo_inicio date, periodo_fim date,
       exercicio integer, valor numeric, unidade text, escopo text,
       versao_documento integer, conhecido_em date, fonte text,
       referencia_fonte text, metadata_json jsonb
     )
   )
   INSERT INTO biblioteca.fatos_financeiros
     (issuer_id, metrica, periodo_inicio, periodo_fim, exercicio, valor, unidade, escopo,
      versao_documento, conhecido_em, fonte, referencia_fonte, metadata_json)
   SELECT issuer_id, metrica, periodo_inicio, periodo_fim, exercicio, valor, unidade, escopo,
          versao_documento, conhecido_em, fonte, referencia_fonte, metadata_json
     FROM incoming
   ON CONFLICT (issuer_id, metrica, periodo_fim, escopo, versao_documento, referencia_fonte)
   DO UPDATE SET valor = EXCLUDED.valor, conhecido_em = EXCLUDED.conhecido_em, metadata_json = EXCLUDED.metadata_json
   RETURNING fact_id`,
  [JSON.stringify(rows)]
);

console.log(`TDN Neon: ${inserted.length} fatos sincronizados · ${Object.keys(matrix.assets || {}).length} ativos.`);
