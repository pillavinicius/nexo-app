#!/usr/bin/env node

// NEXO Goldberg F2 — coletor offline de fatos históricos da DFP/CVM.
// A Vercel lê somente o arquivo versionado. O download nunca ocorre na rota do app.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { unzipSync } from "fflate";

export const TDN_COLLECTOR_VERSION = "TDN_COLLECTOR_v1.0";
export const CVM_DFP_BASE_URL = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS";
export const DEFAULT_YEARS = Object.freeze([2015, 2016, 2017, 2021, 2022, 2023]);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, "..", "..");
const OUTPUT_PATH = join(ROOT_DIR, "data", "goldberg", "tdn_fatos.json.gz");
const MATRIX_PATH = join(ROOT_DIR, "data", "goldberg", "tdn_sector_matrix.json");
const SELFTEST = process.env.NEXO_SELFTEST === "1";
const REFRESH = process.argv.includes("--refresh");
const EXERCISE_ORDERS = new Set(["ULTIMO", "PENULTIMO"]);

const STATEMENTS = Object.freeze({
  DRE: Object.freeze({
    revenue: "3.01",
    gross_profit: "3.03",
    operating_income: "3.05",
  }),
  BPA: Object.freeze({ current_assets: "1.01" }),
  BPP: Object.freeze({ current_liabilities: "2.01" }),
});

function normalizedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function parseArgs(argv) {
  const yearsArg = argv.find((arg) => arg.startsWith("--years="));
  const years = yearsArg
    ? yearsArg.slice("--years=".length).split(",").map(Number).filter((year) => Number.isInteger(year))
    : [...DEFAULT_YEARS];
  return { years: [...new Set(years)].sort(), refresh: REFRESH };
}

export function parseSemicolonLine(line) {
  const columns = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < String(line).length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ";" && !quoted) {
      columns.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  columns.push(value);
  return columns;
}

export function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseSemicolonLine(lines[0]);
  return lines.slice(1).map((line) => {
    const columns = parseSemicolonLine(line);
    return Object.fromEntries(header.map((key, index) => [key, columns[index] ?? ""]));
  });
}

function decode(bytes) {
  return new TextDecoder("windows-1252").decode(bytes);
}

function archiveEntry(archive, name) {
  const bytes = archive[name];
  if (!bytes) throw new Error(`tdn_archive_entry_missing:${name}`);
  return parseCsv(decode(bytes));
}

function safeJson(path, fallback) {
  try {
    return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
  } catch {
    return fallback;
  }
}

function metadataIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const key = `${String(row.CD_CVM || "").padStart(6, "0")}|${row.DT_REFER}|${Number(row.VERSAO || 1)}`;
    index.set(key, row);
  }
  return index;
}

function rowToFact({ row, metric, ticker, statement, metadata, scope }) {
  const value = Number(String(row.VL_CONTA || "").replace(",", "."));
  const fiscalYear = Number(String(row.DT_FIM_EXERC || row.DT_REFER || "").slice(0, 4));
  if (!Number.isFinite(value) || !Number.isInteger(fiscalYear)) return null;
  const version = Number(row.VERSAO || 1);
  const metaKey = `${String(row.CD_CVM || "").padStart(6, "0")}|${row.DT_REFER}|${version}`;
  const filing = metadata.get(metaKey) || {};
  const idDoc = String(filing.ID_DOC || `${row.CD_CVM}-${row.DT_REFER}-v${version}`);
  const periodEnd = row.DT_FIM_EXERC || row.DT_REFER;
  const sourceRef = `cvm_dfp:${idDoc}:${scope}:${statement}:${row.CD_CONTA}:${periodEnd}`;
  return {
    ticker,
    codigo_cvm: String(row.CD_CVM || "").padStart(6, "0"),
    company_name: row.DENOM_CIA,
    metric,
    fiscal_year: fiscalYear,
    period_start: row.DT_INI_EXERC || null,
    period_end: periodEnd,
    value,
    unit: normalizedText(row.ESCALA_MOEDA) === "MIL" ? "BRL_thousands" : "BRL",
    scope,
    filing_version: version,
    known_at: filing.DT_RECEB || row.DT_REFER,
    source: "cvm_dfp",
    source_ref: sourceRef,
    fact_id: sourceRef,
    source_url: filing.LINK_DOC || `${CVM_DFP_BASE_URL}/dfp_cia_aberta_${fiscalYear}.zip`,
    account_code: row.CD_CONTA,
    account_label: row.DS_CONTA,
  };
}

export function extractFactsFromArchive(bytes, archiveYear, matrix) {
  const archive = unzipSync(new Uint8Array(bytes));
  const metadata = metadataIndex(archiveEntry(archive, `dfp_cia_aberta_${archiveYear}.csv`));
  const assetByCode = new Map(
    Object.entries(matrix?.assets || {}).map(([ticker, asset]) => [String(asset.codigo_cvm || "").padStart(6, "0"), ticker])
  );
  const facts = [];
  for (const [statement, accounts] of Object.entries(STATEMENTS)) {
    const metricByAccount = new Map(Object.entries(accounts).map(([metric, account]) => [account, metric]));
    for (const [suffix, scope] of [["con", "consolidado"], ["ind", "individual"]]) {
      const rows = archiveEntry(archive, `dfp_cia_aberta_${statement}_${suffix}_${archiveYear}.csv`);
      for (const row of rows) {
        const code = String(row.CD_CVM || "").padStart(6, "0");
        const ticker = assetByCode.get(code);
        const metric = metricByAccount.get(String(row.CD_CONTA || ""));
        if (!ticker || !metric || !EXERCISE_ORDERS.has(normalizedText(row.ORDEM_EXERC))) continue;
        const fact = rowToFact({ row, metric, ticker, statement, metadata, scope });
        if (fact) facts.push(fact);
      }
    }
  }
  return facts;
}

export function mergeFacts(existing = [], incoming = []) {
  const index = new Map();
  for (const fact of [...existing, ...incoming]) {
    if (!fact?.fact_id) continue;
    index.set(fact.fact_id, fact);
  }
  return [...index.values()].sort((a, b) =>
    String(a.ticker).localeCompare(String(b.ticker)) ||
    Number(a.fiscal_year) - Number(b.fiscal_year) ||
    String(a.metric).localeCompare(String(b.metric)) ||
    Number(a.filing_version) - Number(b.filing_version)
  );
}

async function downloadArchive(year) {
  const url = `${CVM_DFP_BASE_URL}/dfp_cia_aberta_${year}.zip`;
  const response = await fetch(url, { headers: { "User-Agent": "NEXO-TDN-Collector/1.0" } });
  if (!response.ok) throw new Error(`CVM DFP ${year}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function atomicWrite(payload) {
  const temporary = `${OUTPUT_PATH}.tmp`;
  writeFileSync(temporary, gzipSync(`${JSON.stringify(payload, null, 2)}\n`, { level: 9 }));
  renameSync(temporary, OUTPUT_PATH);
}

export function selfTest() {
  const line = 'A;"B;C";"D""E"';
  const parsed = parseSemicolonLine(line);
  if (parsed.length !== 3 || parsed[1] !== "B;C" || parsed[2] !== 'D"E') throw new Error("tdn_collector_csv_failed");
  const merged = mergeFacts([{ fact_id: "a", value: 1 }], [{ fact_id: "a", value: 2 }, { fact_id: "b", value: 3 }]);
  if (merged.length !== 2 || merged.find((fact) => fact.fact_id === "a")?.value !== 2) throw new Error("tdn_collector_dedup_failed");
  if (DEFAULT_YEARS.join(",") !== "2015,2016,2017,2021,2022,2023") throw new Error("tdn_collector_windows_changed");
  if (!EXERCISE_ORDERS.has("ULTIMO") || !EXERCISE_ORDERS.has("PENULTIMO")) throw new Error("tdn_collector_baseline_changed");
  return { passed: 4, failed: 0 };
}

async function main() {
  const { years } = parseArgs(process.argv.slice(2));
  const matrix = safeJson(MATRIX_PATH, null);
  if (!matrix?.assets) throw new Error("Matriz setorial TDN ausente.");
  const existing = safeJson(OUTPUT_PATH, { version: "TDN_FACTS_v1.0", inflation: [], facts: [] });
  const incoming = [];
  for (const year of years) {
    process.stdout.write(`TDN · CVM DFP ${year} ... `);
    const archive = await downloadArchive(year);
    const facts = extractFactsFromArchive(archive, year, matrix);
    incoming.push(...facts);
    console.log(`${facts.length} fatos selecionados`);
  }
  const preservedFacts = REFRESH
    ? (existing.facts || []).filter((fact) => fact?.source !== "cvm_dfp")
    : existing.facts || [];
  const facts = mergeFacts(preservedFacts, incoming);
  const asOf = facts.reduce((latest, fact) => String(fact.known_at || "") > latest ? String(fact.known_at) : latest, "") || null;
  atomicWrite({
    ...existing,
    version: "TDN_FACTS_v1.0",
    collector_version: TDN_COLLECTOR_VERSION,
    as_of: asOf,
    source: "cvm_dfp",
    source_url: `${CVM_DFP_BASE_URL}/`,
    facts,
  });
  console.log(`TDN ${TDN_COLLECTOR_VERSION} · ${facts.length} fatos versionados · as of ${asOf}`);
}

if (SELFTEST) {
  const result = selfTest();
  console.log(`TDN collector ${TDN_COLLECTOR_VERSION}: ${result.passed} passou, ${result.failed} falhou`);
} else if (REFRESH) {
  await main();
} else {
  console.log("Use --refresh para consultar a CVM. A execução padrão preserva o arquivo versionado.");
}
