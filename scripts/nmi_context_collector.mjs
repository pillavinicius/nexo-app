#!/usr/bin/env node
// NEXO NMI - produtor offline do Context Package a partir do BCB SGS.
// Nunca roda na Vercel: coleta, valida e publica data/context/latest.json.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  fetchSgsSeries,
  latestObservationAtOrBefore,
  parseSgsRows,
} from "../lib/bcb/sgs_client.mjs";
import {
  CONTRACT_VERSION,
  validateContextPackage,
} from "../lib/nmi/nexo_context_validator.mjs";

const SELFTEST = process.env.NEXO_SELFTEST === "1" || process.argv.includes("--selftest");
const DRY_RUN = process.argv.includes("--dry-run");
const OUTPUT_PATH = resolve(process.cwd(), argumentValue("--output") || "data/context/latest.json");
const MARKET_DATE = argumentValue("--as-of");
const LOOKBACK_DAYS = 400;
const DAY_MS = 86_400_000;

export const NMI_BCB_SERIES = {
  selic_target: {
    code: 432,
    unit: "percent_per_year",
    cadence: "daily",
    transform: (value) => value,
  },
  ipca_12m: {
    code: 13522,
    unit: "percent_12m",
    cadence: "monthly",
    transform: (value) => value,
  },
  credit_gdp: {
    code: 20622,
    unit: "fraction_of_gdp",
    cadence: "monthly",
    transform: (value) => round(value / 100, 4),
  },
};

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function shiftDate(date, days) {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`data invalida: ${date}`);
  return new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function unavailableWatermark(checkedAt) {
  return { as_of: checkedAt, status: "unavailable" };
}

function observationEnvelope(name, observation) {
  const config = NMI_BCB_SERIES[name];
  if (!observation) {
    return {
      provider: "BCB_SGS",
      series_code: config.code,
      status: "unavailable",
      observed_at: null,
      value: null,
      unit: config.unit,
    };
  }
  return {
    provider: "BCB_SGS",
    series_code: config.code,
    status: "official",
    observed_at: observation.date,
    value: config.transform(observation.value),
    unit: config.unit,
  };
}

function packageVersion(previous, marketDate) {
  if (!previous) return { version: 1, supersedes: null };
  if (previous.market_close_date > marketDate) {
    throw new Error(
      `anti-regressao: pacote atual (${previous.market_close_date}) e mais novo que ${marketDate}`
    );
  }
  return {
    version: previous.market_close_date === marketDate ? previous.version + 1 : 1,
    supersedes: previous.context_id,
  };
}

function assertNoObservationRegression(previous, observations) {
  const previousObservations = previous?.source_observations || {};
  for (const [name, current] of Object.entries(observations)) {
    const before = previousObservations[name];
    if (
      before?.status === "official" &&
      current.status !== "official"
    ) {
      throw new Error(`anti-regressao: ${name} oficial nao pode voltar para unavailable`);
    }
    if (
      before?.status === "official" &&
      current.status === "official" &&
      before.observed_at > current.observed_at
    ) {
      throw new Error(
        `anti-regressao: ${name} recuou de ${before.observed_at} para ${current.observed_at}`
      );
    }
  }
}

function freshnessScore(observations, marketDate) {
  const maximumAge = { selic_target: 10, ipca_12m: 100, credit_gdp: 100 };
  const marketTs = Date.parse(`${marketDate}T00:00:00Z`);
  const scores = Object.entries(observations).map(([name, observation]) => {
    if (observation.status !== "official") return 0;
    const observedTs = Date.parse(`${observation.observed_at}T00:00:00Z`);
    const ageDays = Math.max(0, (marketTs - observedTs) / DAY_MS);
    return Math.max(0, 1 - ageDays / maximumAge[name]);
  });
  return round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 2);
}

function classifyRegime(observations) {
  const selic = observations.selic_target.value;
  const ipca = observations.ipca_12m.value;
  const credit = observations.credit_gdp.value;
  const officialCount = Object.values(observations).filter(
    (item) => item.status === "official"
  ).length;

  const topPositive = [];
  const topNegative = [];
  if (ipca != null && ipca <= 4.5) topPositive.push("inflacao_proxima_da_banda");
  if (credit != null && credit >= 0.5) topPositive.push("credito_sfn_relevante");
  if (selic != null && selic >= 10) topNegative.push("juros_nominais_altos");
  if (ipca != null && ipca > 4.5) topNegative.push("inflacao_pressionada");

  let label = "dados_bcb_insuficientes";
  if (selic != null && ipca != null) {
    if (selic >= 10 && ipca > 4.5) label = "juros_altos_com_inflacao_pressionada";
    else if (selic >= 10) label = "juros_altos_com_inflacao_proxima_da_banda";
    else if (ipca > 4.5) label = "inflacao_pressionada";
    else label = "inflacao_proxima_da_banda_com_juros_moderados";
  }

  return {
    label,
    method: "rule_based",
    conviction_score: round((officialCount / 3) * 0.65, 2),
    drivers: { top_positive: topPositive, top_negative: topNegative },
  };
}

export function buildContextPackage({ rawObservations, previous, marketDate, generatedAt }) {
  const observations = Object.fromEntries(
    Object.keys(NMI_BCB_SERIES).map((name) => [
      name,
      observationEnvelope(name, rawObservations[name] || null),
    ])
  );
  assertNoObservationRegression(previous, observations);

  const officialCount = Object.values(observations).filter(
    (item) => item.status === "official"
  ).length;
  const status = officialCount === 3 ? "official" : officialCount === 0 ? "unavailable" : "provisional";
  const latestDate = Object.values(observations)
    .map((item) => item.observed_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const lineage = packageVersion(previous, marketDate);
  const freshness = freshnessScore(observations, marketDate);
  // Cobertura global v1.2: 3 sinais BCB reais de 7 sinais macro esperados.
  const coverage = round(officialCount / 7, 2);
  const provisionalPenalty = 0.1;
  const confidence = round(
    Math.max(0, freshness * 0.55 + coverage * 0.45 - provisionalPenalty),
    2
  );

  const packageData = {
    contextSchemaVersion: CONTRACT_VERSION,
    context_id: `ctx_${marketDate}_br_close_v${lineage.version}_t0`,
    as_of: generatedAt,
    market_close_date: marketDate,
    run_type: "t0_provisional",
    version: lineage.version,
    supersedes_context_id: lineage.supersedes,
    is_seed_mode: false,
    source_watermarks: {
      bcb_sgs: { as_of: latestDate || generatedAt, status },
      ibge: unavailableWatermark(generatedAt),
      tesouro: unavailableWatermark(generatedAt),
      b3_trades: unavailableWatermark(generatedAt),
      b3_investor_flow: unavailableWatermark(generatedAt),
      ratings: unavailableWatermark(generatedAt),
    },
    source_observations: observations,
    brazil: {
      macro: {
        selic_target: observations.selic_target.value,
        real_rate_ex_12m: null,
        focus_ipca_12m: null,
        ipca_12m: observations.ipca_12m.value,
        gross_debt_gdp: null,
        primary_balance_gdp: null,
      },
      credit_system: {
        credit_gdp: observations.credit_gdp.value,
      },
    },
    regime: classifyRegime(observations),
    quality: {
      freshness_score: freshness,
      coverage_score: coverage,
      provisional_penalty: provisionalPenalty,
      overall_confidence: confidence,
    },
  };

  const validation = validateContextPackage(packageData);
  if (!validation.ok) {
    throw new Error(`pacote invalido: ${validation.errors.join(" | ")}`);
  }
  return packageData;
}

export function writeContextAtomically(path, packageData) {
  const validation = validateContextPackage(packageData);
  if (!validation.ok) throw new Error(`escrita bloqueada: ${validation.errors.join(" | ")}`);

  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(packageData, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

async function collectRawObservations(marketDate) {
  const startDate = shiftDate(marketDate, -LOOKBACK_DAYS);
  const entries = await Promise.all(
    Object.entries(NMI_BCB_SERIES).map(async ([name, config]) => {
      try {
        const series = await fetchSgsSeries(config.code, { startDate, endDate: marketDate });
        return [name, latestObservationAtOrBefore(series, marketDate)];
      } catch (error) {
        console.warn(`AVISO: SGS ${config.code} indisponivel: ${error.message}`);
        return [name, null];
      }
    })
  );
  return Object.fromEntries(entries);
}

function fixture(name) {
  return readJson(resolve(process.cwd(), `test/fixtures/bcb-sgs/${name}.json`));
}

function selfTest() {
  let passed = 0;
  let failed = 0;
  const check = (condition, label) => {
    if (condition) {
      passed += 1;
      console.log(`PASS  ${label}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${label}`);
    }
  };

  const marketDate = "2026-09-04";
  const seedPrevious = {
    contextSchemaVersion: "1.1",
    context_id: "ctx_2026-09-04_br_close_v1_seed",
    market_close_date: marketDate,
    version: 1,
  };
  const raw = {
    selic_target: latestObservationAtOrBefore(parseSgsRows(fixture("432"), { code: 432 }), marketDate),
    ipca_12m: latestObservationAtOrBefore(parseSgsRows(fixture("13522"), { code: 13522 }), marketDate),
    credit_gdp: latestObservationAtOrBefore(parseSgsRows(fixture("20622"), { code: 20622 }), marketDate),
  };
  check(raw.selic_target.date === marketDate, "cliente ignora observacao futura");

  const packageData = buildContextPackage({
    rawObservations: raw,
    previous: seedPrevious,
    marketDate,
    generatedAt: "2026-09-04T15:00:00.000Z",
  });
  check(packageData.contextSchemaVersion === "1.2", "produtor usa contrato 1.2");
  check(packageData.is_seed_mode === false, "pacote real sai do seed mode");
  check(packageData.brazil.macro.selic_target === 14, "Selic preserva percentual");
  check(packageData.brazil.macro.ipca_12m === 4.44, "IPCA preserva percentual");
  check(packageData.brazil.credit_system.credit_gdp === 0.5557, "credito/PIB vira fracao");
  check(packageData.version === 2, "reemissao da mesma data incrementa version");
  check(packageData.supersedes_context_id?.endsWith("_seed"), "lineage aponta para pacote anterior");
  check(validateContextPackage(packageData).ok, "pacote produzido passa no validador");

  const mismatched = structuredClone(packageData);
  mismatched.brazil.macro.selic_target = 13;
  check(!validateContextPackage(mismatched).ok, "validador bloqueia valor diferente da proveniencia");

  const futureDated = structuredClone(packageData);
  futureDated.source_observations.selic_target.observed_at = "2026-09-16";
  check(!validateContextPackage(futureDated).ok, "validador bloqueia observacao futura");

  const invalidCalendarDate = structuredClone(packageData);
  invalidCalendarDate.source_observations.selic_target.observed_at = "2026-02-31";
  check(!validateContextPackage(invalidCalendarDate).ok, "validador bloqueia data inexistente");

  const wrongSeries = structuredClone(packageData);
  wrongSeries.source_observations.ipca_12m.series_code = 432;
  check(!validateContextPackage(wrongSeries).ok, "validador bloqueia codigo de serie trocado");

  const wrongUnit = structuredClone(packageData);
  wrongUnit.source_observations.credit_gdp.unit = "percent";
  check(!validateContextPackage(wrongUnit).ok, "validador bloqueia unidade trocada");

  let regressionBlocked = false;
  try {
    buildContextPackage({
      rawObservations: { ...raw, selic_target: null },
      previous: packageData,
      marketDate,
      generatedAt: "2026-09-04T16:00:00.000Z",
    });
  } catch (error) {
    regressionBlocked = error.message.includes("anti-regressao");
  }
  check(regressionBlocked, "fonte oficial nao regride para indisponivel");

  console.log(`\n=== NMI BCB SELF-TEST: ${passed} passou, ${failed} falhou ===`);
  if (failed) process.exit(1);
}

async function main() {
  if (SELFTEST) return selfTest();
  if (!MARKET_DATE) {
    throw new Error("informe a data de mercado explicitamente: --as-of YYYY-MM-DD");
  }
  const previous = existsSync(OUTPUT_PATH) ? readJson(OUTPUT_PATH) : null;
  const rawObservations = await collectRawObservations(MARKET_DATE);
  const packageData = buildContextPackage({
    rawObservations,
    previous,
    marketDate: MARKET_DATE,
    generatedAt: new Date().toISOString(),
  });

  const officialCount = Object.values(packageData.source_observations).filter(
    (item) => item.status === "official"
  ).length;
  if (officialCount !== 3) {
    throw new Error(`coleta incompleta: ${officialCount}/3 series oficiais; pacote anterior preservado`);
  }

  if (
    previous?.contextSchemaVersion === CONTRACT_VERSION &&
    JSON.stringify(previous.source_observations) === JSON.stringify(packageData.source_observations)
  ) {
    console.log(`SEM ALTERACAO: ${previous.context_id} ja contem as observacoes mais recentes`);
    return;
  }

  if (DRY_RUN) {
    console.log(JSON.stringify(packageData, null, 2));
    return;
  }
  writeContextAtomically(OUTPUT_PATH, packageData);
  console.log(`OK: ${packageData.context_id} publicado em ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(`FALHA NMI: ${error.message}`);
  process.exit(1);
});
