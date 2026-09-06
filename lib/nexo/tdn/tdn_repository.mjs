import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { createDatabaseClient, databaseConfiguration } from "../biblioteca/database.mjs";

export const TDN_REPOSITORY_VERSION = "TDN_REPOSITORY_v1.0";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const MATRIX_PATH = join(CURRENT_DIR, "..", "..", "..", "data", "goldberg", "tdn_sector_matrix.json");
const FACTS_PATH = join(CURRENT_DIR, "..", "..", "..", "data", "goldberg", "tdn_fatos.json.gz");

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function loadTdnSectorMatrix() {
  return readJson(MATRIX_PATH, { version: null, asset_classes: {}, profiles: {}, assets: {} });
}

export function loadVersionedTdnFacts() {
  try {
    return JSON.parse(gunzipSync(readFileSync(FACTS_PATH)).toString("utf8"));
  } catch {
    return { version: null, as_of: null, inflation: [], facts: [] };
  }
}

export function classifyTdnAsset({ ticker, assetType = "acao-br", matrix = loadTdnSectorMatrix() } = {}) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const assetClass = matrix?.asset_classes?.[assetType];
  if (assetClass?.eligible === false) {
    return { eligible: false, mode: "not_applicable", profile: null, label: null, reason: assetClass.reason, matrix_version: matrix.version };
  }
  const asset = matrix?.assets?.[normalizedTicker];
  if (!asset) {
    return { eligible: false, mode: "unclassified", profile: null, label: null, reason: "Ativo ainda não curado na matriz setorial TDN.", matrix_version: matrix.version };
  }
  const profile = matrix?.profiles?.[asset.profile];
  if (!profile) {
    return { eligible: false, mode: "unclassified", profile: asset.profile, label: null, reason: "Perfil setorial ausente na matriz TDN.", matrix_version: matrix.version };
  }
  return {
    ...profile,
    ...asset,
    eligible: profile.mode !== "not_applicable",
    profile: asset.profile,
    matrix_version: matrix.version,
  };
}

async function loadDatabaseFacts(ticker, client = null) {
  if (!client && !databaseConfiguration().configured) return [];
  const database = client || createDatabaseClient();
  return database.query(
    `SELECT a.ticker, f.fact_id, f.metrica, f.exercicio, f.valor::double precision AS valor,
            f.unidade, f.escopo, f.versao_documento, f.conhecido_em,
            f.periodo_inicio, f.periodo_fim, f.fonte, f.referencia_fonte
       FROM biblioteca.fatos_financeiros f
       JOIN biblioteca.ativos a ON a.issuer_id = f.issuer_id AND a.ativo = TRUE
      WHERE a.ticker = $1
        AND f.exercicio = ANY($2::integer[])
      ORDER BY f.exercicio, f.metrica, f.conhecido_em, f.versao_documento`,
    [String(ticker || "").toUpperCase(), [2014, 2016, 2017, 2020, 2022, 2023]]
  );
}

export async function loadTdnInput({ ticker, assetType = "acao-br", client = null } = {}) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const matrix = loadTdnSectorMatrix();
  const versioned = loadVersionedTdnFacts();
  const classification = classifyTdnAsset({ ticker: normalizedTicker, assetType, matrix });
  let databaseFacts = [];
  let databaseStatus = databaseConfiguration().configured || client ? "ready" : "not_configured";
  if (classification.eligible) {
    try {
      databaseFacts = await loadDatabaseFacts(normalizedTicker, client);
    } catch {
      databaseStatus = "unavailable";
    }
  }
  const fileFacts = (versioned.facts || []).filter((fact) => String(fact?.ticker || "").toUpperCase() === normalizedTicker);
  const facts = databaseFacts.length ? [...fileFacts, ...databaseFacts] : fileFacts;
  return {
    version: TDN_REPOSITORY_VERSION,
    ticker: normalizedTicker,
    classification,
    facts,
    inflation: versioned.inflation || [],
    data_as_of: versioned.as_of || null,
    facts_source: databaseFacts.length && fileFacts.length ? "neon_plus_versioned_fallback" : databaseFacts.length ? "neon_point_in_time" : fileFacts.length ? "versioned_cvm_dfp" : "none",
    database_status: databaseStatus,
    matrix_version: matrix.version,
    facts_version: versioned.version,
  };
}

export async function selfTest() {
  const matrix = loadTdnSectorMatrix();
  const bank = classifyTdnAsset({ ticker: "BBAS3", matrix });
  const utility = classifyTdnAsset({ ticker: "SBSP3", matrix });
  const external = classifyTdnAsset({ ticker: "MSFT", assetType: "stock-ext", matrix });
  const unknown = classifyTdnAsset({ ticker: "XXXX3", matrix });
  if (bank.mode !== "not_applicable") throw new Error("tdn_repository_bank_profile_failed");
  if (utility.mode !== "regulated_lag" || utility.observation_lag_years !== 1) throw new Error("tdn_repository_utility_profile_failed");
  if (external.mode !== "not_applicable") throw new Error("tdn_repository_external_profile_failed");
  if (unknown.mode !== "unclassified") throw new Error("tdn_repository_unknown_must_not_default");
  return { passed: 4, failed: 0 };
}

if (process.env.NEXO_SELFTEST === "1") {
  const result = await selfTest();
  console.log(`TDN repository ${TDN_REPOSITORY_VERSION}: ${result.passed} passou, ${result.failed} falhou`);
}
