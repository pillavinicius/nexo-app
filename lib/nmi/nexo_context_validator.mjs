// nexo_context_validator.mjs
// -----------------------------------------------------------------------------

import { pathToFileURL } from "node:url";
// Gate executavel do CONTRATO Context Package do NEXO (v1.x).
// Zero dependencia, ESM puro — mesmo padrao do nexo_macro_collector.
//
// Papeis:
//   1. validateContextPackage(pkg)   -> valida estrutura/tipos/ranges do v1.x core
//   2. checkCompatibility(pkgV, cV)  -> exact | forward_ok | degraded | incompatible
//   3. signalMissing(pkg, fields)    -> quais campos opcionais esperados faltam (ausencia ruidosa)
//   4. selfTest()                    -> bateria de casos-ouro; sai !=0 se falhar (gate)
//
// Regra de contrato embutida (semver para dados):
//   - adicionar campo OPCIONAL / ampliar enum  => MINOR (nao quebra ninguem)
//   - tornar obrigatorio / renomear /
//     remover / mudar unidade ou significado   => MAJOR (migracao consciente)
//   - nome de campo NUNCA e reutilizado com significado novo
//   - o 'required' abaixo e o CORE congelado do v1.x; campos MINOR sao sempre opcionais
//
// DELTA v1.0 -> v1.1 (as tres lacunas fechadas na v0.3 do modulo):
//   L1 GATE ANTES DA ESCRITA: validateContextPackage e pre-requisito de persistir.
//      Ver scripts/validate_context.mjs e a nota de integracao no RUNBOOK.
//   L2 WATERMARK HONESTO: novo status 'seed'. Dado semente NUNCA se declara
//      'official'. Se qualquer watermark e 'seed', is_seed_mode deve ser true,
//      seed_penalty > 0 e overall_confidence <= SEED_CONFIDENCE_CEILING.
//   L3 LINEAGE DE RECONCILIACAO: version > 1 exige supersedes_context_id != null,
//      e um pacote nao pode suceder a si mesmo.
// DELTA v1.1 -> v1.2:
//   L4 INDISPONIBILIDADE HONESTA: status unavailable e null explicito substituem
//      qualquer valor sintetico quando uma fonte ainda nao foi integrada.
//   L5 PROVENIENCIA: source_observations vincula valor, unidade, serie e data.
// DELTA v1.2 -> v1.3:
//   L6 NFI OPCIONAL: fluxo entra como domínio do NMI, com histórico e status
//      explícitos, sem qualquer permissão para alterar valuation.
//
// CODIGO CALCULA, CLAUDE INTERPRETA — este arquivo so calcula conformidade.
// -----------------------------------------------------------------------------

export const CONTRACT_MAJOR = 1;
export const CONTRACT_MINOR = 3;
export const CONTRACT_VERSION = `${CONTRACT_MAJOR}.${CONTRACT_MINOR}`;

// Teto de confianca quando o pacote contem dado semente.
export const SEED_CONFIDENCE_CEILING = 0.35;

const WATERMARK_STATUSES = ["official", "provisional", "licensed", "event_state", "seed", "unavailable"];

// ---- helpers de validacao ---------------------------------------------------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.length > 0;
const isIsoDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
  const ts = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(ts) && new Date(ts).toISOString().slice(0, 10) === v;
};

function req(errors, cond, path, msg) {
  if (!cond) errors.push(`${path}: ${msg}`);
}
function checkNum(errors, obj, key, path, { min, max, nullable = false } = {}) {
  const v = obj[key];
  if (v === undefined) { errors.push(`${path}.${key}: ausente (obrigatorio)`); return; }
  if (v === null) { if (!nullable) errors.push(`${path}.${key}: null nao permitido`); return; }
  if (!isNum(v)) { errors.push(`${path}.${key}: deve ser number`); return; }
  if (min !== undefined && v < min) errors.push(`${path}.${key}: ${v} < min ${min}`);
  if (max !== undefined && v > max) errors.push(`${path}.${key}: ${v} > max ${max}`);
}
function checkEnum(errors, obj, key, path, allowed, { optional = false } = {}) {
  const v = obj[key];
  if (v === undefined) { if (!optional) errors.push(`${path}.${key}: ausente (obrigatorio)`); return; }
  if (!allowed.includes(v)) errors.push(`${path}.${key}: '${v}' fora do enum [${allowed.join(", ")}]`);
}

// ---- 1. validacao estrutural do CORE v1.x -----------------------------------

export function validateContextPackage(pkg) {
  const errors = [];
  if (!isObj(pkg)) return { ok: false, errors: ["raiz: pacote deve ser objeto"] };
  const packageVersion = parseVer(pkg.contextSchemaVersion);
  const supportsUnavailable = packageVersion?.major === 1 && packageVersion.minor >= 2;

  // envelope
  req(errors, isStr(pkg.contextSchemaVersion) && /^[0-9]+\.[0-9]+$/.test(pkg.contextSchemaVersion || ""),
      "contextSchemaVersion", "ausente ou fora do formato MAJOR.MINOR");
  req(errors, isStr(pkg.context_id), "context_id", "ausente");
  req(errors, isStr(pkg.as_of), "as_of", "ausente");
  req(errors, isIsoDate(pkg.market_close_date),
      "market_close_date", "ausente ou fora de YYYY-MM-DD");
  checkEnum(errors, pkg, "run_type", "root", ["t0_provisional", "t1_final", "t2_reconciled"]);
  req(errors, Number.isInteger(pkg.version) && pkg.version >= 1, "version", "deve ser inteiro >= 1");

  // --- L3: lineage de reconciliacao (v1.1) ---
  if (Number.isInteger(pkg.version) && pkg.version > 1) {
    req(errors, isStr(pkg.supersedes_context_id), "supersedes_context_id",
      "version > 1 exige supersedes_context_id (lineage T+0 -> T+1 -> T+2 nao pode ficar solto)");
  }
  if (isStr(pkg.supersedes_context_id) && pkg.supersedes_context_id === pkg.context_id) {
    errors.push("supersedes_context_id: pacote nao pode suceder a si mesmo");
  }

  // source_watermarks (core: 6 fontes gratuitas)
  let seenSeed = false;
  if (!isObj(pkg.source_watermarks)) {
    errors.push("source_watermarks: ausente ou nao-objeto");
  } else {
    for (const src of ["bcb_sgs", "ibge", "tesouro", "b3_trades", "b3_investor_flow", "ratings"]) {
      const w = pkg.source_watermarks[src];
      if (!isObj(w)) { errors.push(`source_watermarks.${src}: ausente`); continue; }
      req(errors, isStr(w.as_of), `source_watermarks.${src}.as_of`, "ausente");
      checkEnum(errors, w, "status", `source_watermarks.${src}`, WATERMARK_STATUSES);
      if (w.status === "unavailable" && !supportsUnavailable) {
        errors.push(`source_watermarks.${src}.status: unavailable exige contrato >= 1.2`);
      }
      if (w.status === "seed") seenSeed = true;
    }
    // fontes extras tambem contam para o seed
    for (const [k, w] of Object.entries(pkg.source_watermarks)) {
      if (isObj(w) && w.status === "seed") seenSeed = true;
      if (isObj(w) && w.status !== undefined && !WATERMARK_STATUSES.includes(w.status))
        errors.push(`source_watermarks.${k}.status: '${w.status}' fora do enum`);
    }
  }

  // brazil.macro (core obrigatorio)
  const macro = pkg.brazil?.macro;
  if (!isObj(macro)) {
    errors.push("brazil.macro: ausente ou nao-objeto");
  } else {
    checkNum(errors, macro, "selic_target", "brazil.macro", { min: 0, max: 100, nullable: supportsUnavailable });
    checkNum(errors, macro, "focus_ipca_12m", "brazil.macro", { nullable: supportsUnavailable });
    checkNum(errors, macro, "ipca_12m", "brazil.macro", { nullable: supportsUnavailable });
    checkNum(errors, macro, "gross_debt_gdp", "brazil.macro", { min: 0, max: 5, nullable: supportsUnavailable });
    checkNum(errors, macro, "primary_balance_gdp", "brazil.macro", { min: -1, max: 1, nullable: supportsUnavailable });
    if ("real_rate_ex_12m" in macro) checkNum(errors, macro, "real_rate_ex_12m", "brazil.macro", { min: -50, max: 100, nullable: true });
    if ("structural_primary_balance_gdp" in macro) checkNum(errors, macro, "structural_primary_balance_gdp", "brazil.macro", { min: -1, max: 1, nullable: true });
    if ("unemployment" in macro) checkNum(errors, macro, "unemployment", "brazil.macro", { min: 0, max: 1, nullable: true });
  }

  // v1.2 - proveniencia mecanica por observacao. Fonte indisponivel e null,
  // nunca um numero sintetico nem um watermark seed.
  if (pkg.source_observations !== undefined) {
    if (!isObj(pkg.source_observations)) {
      errors.push("source_observations: deve ser objeto");
    } else {
      for (const [name, observation] of Object.entries(pkg.source_observations)) {
        if (!isObj(observation)) {
          errors.push(`source_observations.${name}: deve ser objeto`);
          continue;
        }
        req(errors, isStr(observation.provider), `source_observations.${name}.provider`, "ausente");
        req(errors, Number.isInteger(observation.series_code) && observation.series_code > 0,
          `source_observations.${name}.series_code`, "deve ser inteiro positivo");
        checkEnum(errors, observation, "status", `source_observations.${name}`, ["official", "unavailable"]);
        req(errors, isStr(observation.unit), `source_observations.${name}.unit`, "ausente");
        if (observation.status === "official") {
          req(errors, isIsoDate(observation.observed_at), `source_observations.${name}.observed_at`, "deve ser data YYYY-MM-DD valida para dado oficial");
          req(errors, isNum(observation.value), `source_observations.${name}.value`, "deve ser number para dado oficial");
        }
        if (observation.status === "unavailable") {
          req(errors, observation.observed_at === null, `source_observations.${name}.observed_at`, "deve ser null quando indisponivel");
          req(errors, observation.value === null, `source_observations.${name}.value`, "deve ser null quando indisponivel");
        }
      }
    }
  }

  // brazil.equity (opcional)
  const eq = pkg.brazil?.equity;
  if (isObj(eq) && "foreign_net_status" in eq) {
    checkEnum(errors, eq, "foreign_net_status", "brazil.equity", ["t2_official", "t2_pending", "proxy"]);
  }

  const nfi = pkg.brazil?.flow_intelligence;
  if (isObj(nfi)) {
    req(errors, nfi.version === "NFI_v1.0", "brazil.flow_intelligence.version", "deve ser NFI_v1.0");
    checkEnum(errors, nfi, "status", "brazil.flow_intelligence", ["ok", "insufficient_history", "pending", "unavailable"]);
    checkNum(errors, nfi, "janela_dias", "brazil.flow_intelligence", { min: 1 });
    checkNum(errors, nfi, "fluxo_liquido_janela_brl", "brazil.flow_intelligence", { nullable: true });
    checkNum(errors, nfi, "fluxo_percentil_24m", "brazil.flow_intelligence", { min: 0, max: 1, nullable: true });
    checkNum(errors, nfi, "fluxo_percentil_disponivel", "brazil.flow_intelligence", { min: 0, max: 1, nullable: true });
    checkEnum(errors, nfi, "pressao", "brazil.flow_intelligence", ["compradora", "vendedora", "neutra"]);
    checkEnum(errors, nfi, "status_fonte", "brazil.flow_intelligence", ["t2_official", "t2_pending", "proxy", "unavailable"]);
    req(errors, typeof nfi.explica_deslocamento === "boolean", "brazil.flow_intelligence.explica_deslocamento", "deve ser boolean");
    req(errors, nfi.valuation_effect === "none", "brazil.flow_intelligence.valuation_effect", "deve permanecer none");
    if (nfi.status === "pending") {
      req(errors, nfi.fluxo_liquido_janela_brl === null, "brazil.flow_intelligence.fluxo_liquido_janela_brl", "deve ser null em t2_pending");
    }
    if (nfi.explica_deslocamento) {
      req(errors, nfi.fluxo_percentil_24m !== null && (nfi.fluxo_percentil_24m < 0.1 || nfi.fluxo_percentil_24m > 0.9),
        "brazil.flow_intelligence.explica_deslocamento", "exige percentil canônico extremo");
    }
  }

  // brazil.credit_system (opcional)
  const cs = pkg.brazil?.credit_system;
  if (isObj(cs)) {
    for (const [k, max] of [["credit_gdp", 5], ["directed_credit_share", 1], ["delinquency_90d_pf", 1]]) {
      if (k in cs) checkNum(errors, cs, k, "brazil.credit_system", { min: 0, max, nullable: true });
    }
  }

  const observationBindings = [
    ["selic_target", macro?.selic_target, 432, "percent_per_year"],
    ["ipca_12m", macro?.ipca_12m, 13522, "percent_12m"],
    ["credit_gdp", cs?.credit_gdp, 20622, "fraction_of_gdp"],
  ];
  for (const [name, fieldValue, seriesCode, unit] of observationBindings) {
    const observation = pkg.source_observations?.[name];
    if (!isObj(observation)) continue;
    req(errors, observation.provider === "BCB_SGS",
      `source_observations.${name}.provider`, "deve ser BCB_SGS");
    req(errors, observation.series_code === seriesCode,
      `source_observations.${name}.series_code`, `deve ser ${seriesCode}`);
    req(errors, observation.unit === unit,
      `source_observations.${name}.unit`, `deve ser ${unit}`);
    if (observation.status === "official") {
      req(errors, observation.value === fieldValue,
        `source_observations.${name}.value`, "diverge do campo canonico do pacote");
      req(errors, isIsoDate(observation.observed_at) && isIsoDate(pkg.market_close_date)
        && observation.observed_at <= pkg.market_close_date,
        `source_observations.${name}.observed_at`, "nao pode ser posterior a market_close_date");
    }
    if (observation.status === "unavailable") {
      req(errors, fieldValue === null,
        `source_observations.${name}.value`, "campo canonico deve ser null quando indisponivel");
    }
  }

  // brazil.ratings (opcional)
  const ratings = pkg.brazil?.ratings;
  if (isObj(ratings)) {
    for (const [ag, r] of Object.entries(ratings)) {
      if (!isObj(r)) { errors.push(`brazil.ratings.${ag}: nao-objeto`); continue; }
      req(errors, isStr(r.rating), `brazil.ratings.${ag}.rating`, "ausente");
      checkEnum(errors, r, "outlook", `brazil.ratings.${ag}`, ["positive", "stable", "negative", "developing"]);
    }
  }

  // regime (core) — TRAVA: method === rule_based em v1.x
  const regime = pkg.regime;
  if (!isObj(regime)) {
    errors.push("regime: ausente ou nao-objeto");
  } else {
    req(errors, isStr(regime.label), "regime.label", "ausente");
    req(errors, regime.method === "rule_based", "regime.method",
      "em v1.x o unico metodo aceito e 'rule_based' (similaridade estatistica exige bump + A/B cego)");
    checkNum(errors, regime, "conviction_score", "regime", { min: 0, max: 1 });
  }

  // country_risk (opcional)
  const cr = pkg.country_risk;
  if (isObj(cr) && "embi_bps" in cr) checkNum(errors, cr, "embi_bps", "country_risk", { min: 0, nullable: true });

  // alerts (opcional)
  if (Array.isArray(pkg.alerts)) {
    pkg.alerts.forEach((a, i) => {
      if (!isObj(a)) { errors.push(`alerts[${i}]: nao-objeto`); return; }
      req(errors, isStr(a.code), `alerts[${i}].code`, "ausente");
      checkEnum(errors, a, "severity", `alerts[${i}]`, ["info", "warning", "critical"]);
      checkEnum(errors, a, "state", `alerts[${i}]`, ["active", "cleared"]);
    });
  }

  // quality (core)
  const q = pkg.quality;
  if (!isObj(q)) {
    errors.push("quality: ausente ou nao-objeto");
  } else {
    checkNum(errors, q, "freshness_score", "quality", { min: 0, max: 1 });
    checkNum(errors, q, "coverage_score", "quality", { min: 0, max: 1 });
    checkNum(errors, q, "overall_confidence", "quality", { min: 0, max: 1 });
    if ("provisional_penalty" in q) checkNum(errors, q, "provisional_penalty", "quality", { min: 0, max: 1, nullable: true });
    if ("seed_penalty" in q) checkNum(errors, q, "seed_penalty", "quality", { min: 0, max: 1, nullable: true });
  }

  // --- L2: honestidade do seed (v1.1) ---
  if ("is_seed_mode" in pkg && typeof pkg.is_seed_mode !== "boolean") {
    errors.push("is_seed_mode: deve ser boolean");
  }
  if (seenSeed) {
    req(errors, pkg.is_seed_mode === true, "is_seed_mode",
      "ha watermark com status 'seed'; o pacote DEVE se declarar is_seed_mode=true");
    if (isObj(q)) {
      req(errors, isNum(q.seed_penalty) && q.seed_penalty > 0, "quality.seed_penalty",
        "em seed mode a penalidade deve ser > 0 (ausencia ruidosa, nunca default silencioso)");
      req(errors, isNum(q.overall_confidence) && q.overall_confidence <= SEED_CONFIDENCE_CEILING,
        "quality.overall_confidence",
        `em seed mode a confianca nao pode passar de ${SEED_CONFIDENCE_CEILING}`);
    }
  } else if (pkg.is_seed_mode === true) {
    errors.push("is_seed_mode: declarado true mas nenhum watermark tem status 'seed' (marca desonesta ao contrario)");
  }

  return { ok: errors.length === 0, errors, isSeedMode: seenSeed };
}

// ---- 2. compatibilidade consumidor <-> pacote -------------------------------

function parseVer(s) {
  const m = /^([0-9]+)\.([0-9]+)$/.exec(String(s || ""));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function checkCompatibility(pkgVersion, consumerExpects) {
  const p = parseVer(pkgVersion), c = parseVer(consumerExpects);
  if (!p || !c) return { status: "incompatible", reason: "versao ilegivel" };
  if (p.major !== c.major)
    return { status: "incompatible", reason: `MAJOR difere (pkg ${p.major} vs consumidor ${c.major}) — semantica pode ter mudado` };
  if (p.minor === c.minor) return { status: "exact" };
  if (p.minor > c.minor)
    return { status: "forward_ok", reason: "pacote mais novo; campos extras devem ser ignorados" };
  return { status: "degraded", reason: "pacote mais antigo; campos opcionais esperados podem faltar — degrade com sinalizacao" };
}

// ---- 3. ausencia ruidosa (nunca default silencioso) -------------------------

export function signalMissing(pkg, expectedPaths) {
  const miss = [];
  for (const path of expectedPaths) {
    let node = pkg, ok = true;
    for (const key of path.split(".")) {
      if (isObj(node) && key in node) node = node[key];
      else { ok = false; break; }
    }
    if (!ok || node === null || node === undefined) miss.push(path);
  }
  return miss;
}

// ---- 4. self-test (gate) ----------------------------------------------------

function deepMerge(a, b) {
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const k of Object.keys(b)) {
    if (isObj(a?.[k]) && isObj(b[k])) out[k] = deepMerge(a[k], b[k]);
    else out[k] = b[k];
  }
  return out;
}

function validPackage(overrides = {}) {
  const base = {
    contextSchemaVersion: "1.1",
    context_id: "ctx_2026-07-08_br_close_v1_t0",
    as_of: "2026-07-08T18:35:00-03:00",
    market_close_date: "2026-07-08",
    run_type: "t0_provisional",
    version: 1,
    supersedes_context_id: null,
    is_seed_mode: false,
    source_watermarks: {
      bcb_sgs: { as_of: "2026-07-08T07:15:00-03:00", status: "official" },
      ibge: { as_of: "2026-07-04T09:00:00-03:00", status: "official" },
      tesouro: { as_of: "2026-07-07T18:00:00-03:00", status: "official" },
      b3_trades: { as_of: "2026-07-08T18:31:00-03:00", status: "provisional" },
      b3_investor_flow: { as_of: "2026-07-06T23:59:59-03:00", status: "event_state" },
      ratings: { as_of: "2026-06-25T00:00:00-03:00", status: "event_state" }
    },
    brazil: {
      macro: {
        selic_target: 14.25, real_rate_ex_12m: 8.9, focus_ipca_12m: 4.4,
        ipca_12m: 5.11, gross_debt_gdp: 0.80, primary_balance_gdp: -0.0048,
        structural_primary_balance_gdp: null, unemployment: 0.058
      },
      equity: { turnover_total_brl: 28900000000, foreign_net_brl: null, foreign_net_status: "t2_pending" },
      credit_system: { credit_gdp: 0.54, directed_credit_share: 0.42, delinquency_90d_pf: 0.066 },
      ratings: {
        sp: { rating: "BB", outlook: "stable" },
        moodys: { rating: "Ba1", outlook: "stable" },
        fitch: { rating: "BB", outlook: "stable" }
      }
    },
    regime: {
      label: "deterioracao_cronica_com_juros_altos", method: "rule_based", conviction_score: 0.74,
      drivers: { top_positive: ["juros_reais_altos", "divida_pib_ascendente"], top_negative: ["fluxo_externo_positivo"] }
    },
    country_risk: { embi_bps: 145 },
    alerts: [{ code: "ALRT_CURVE_STEEPENING", severity: "warning", state: "active" }],
    quality: { freshness_score: 0.91, coverage_score: 0.87, provisional_penalty: 0.12, overall_confidence: 0.79 }
  };
  return deepMerge(base, overrides);
}

// pacote semente honesto: watermarks 'seed', flag true, penalidade e teto de confianca
function seedPackage(overrides = {}) {
  const p = validPackage({
    context_id: "ctx_2026-07-08_br_close_v1_seed",
    is_seed_mode: true,
    quality: { seed_penalty: 0.55, overall_confidence: 0.22 }
  });
  for (const k of Object.keys(p.source_watermarks)) p.source_watermarks[k].status = "seed";
  return deepMerge(p, overrides);
}

export function selfTest() {
  const cases = [];
  const pass = (name) => cases.push({ name, ok: true });
  const fail = (name, detail) => cases.push({ name, ok: false, detail });

  // --- devem PASSAR ---
  {
    const r = validateContextPackage(validPackage());
    r.ok ? pass("valido t0 provisional") : fail("valido t0 provisional", r.errors);
  }
  {
    const r = validateContextPackage(validPackage({
      run_type: "t2_reconciled", context_id: "ctx_2026-07-08_br_close_v1_t2",
      version: 3, supersedes_context_id: "ctx_2026-07-08_br_close_v1_t1",
      brazil: { equity: { foreign_net_brl: -7800000000, foreign_net_status: "t2_official" } }
    }));
    r.ok ? pass("valido t2 reconciled com lineage e fluxo oficial") : fail("valido t2 reconciled com lineage e fluxo oficial", r.errors);
  }
  {
    const min = validPackage();
    delete min.brazil.equity; delete min.brazil.credit_system; delete min.brazil.ratings;
    delete min.country_risk; delete min.alerts;
    const r = validateContextPackage(min);
    r.ok ? pass("valido core minimo (sem opcionais)") : fail("valido core minimo (sem opcionais)", r.errors);
  }
  {
    const r = validateContextPackage(seedPackage());
    r.ok ? pass("valido seed HONESTO (flag + penalidade + teto)") : fail("valido seed HONESTO (flag + penalidade + teto)", r.errors);
  }
  {
    const p = validPackage({
      contextSchemaVersion: "1.2",
      is_seed_mode: false,
      source_watermarks: {
        bcb_sgs: { as_of: "2026-07-08", status: "official" },
        ibge: { as_of: "2026-07-08T18:35:00-03:00", status: "unavailable" },
        tesouro: { as_of: "2026-07-08T18:35:00-03:00", status: "unavailable" },
        b3_trades: { as_of: "2026-07-08T18:35:00-03:00", status: "unavailable" },
        b3_investor_flow: { as_of: "2026-07-08T18:35:00-03:00", status: "unavailable" },
        ratings: { as_of: "2026-07-08T18:35:00-03:00", status: "unavailable" }
      },
      brazil: { macro: { focus_ipca_12m: null, gross_debt_gdp: null, primary_balance_gdp: null } }
    });
    const r = validateContextPackage(p);
    r.ok ? pass("valido 1.2 com unavailable e null explicito") : fail("valido 1.2 com unavailable e null explicito", r.errors);
  }

  // --- devem FALHAR ---
  const mustReject = [
    ["sem contextSchemaVersion", () => { const p = validPackage(); delete p.contextSchemaVersion; return p; }],
    ["run_type invalido", () => validPackage({ run_type: "t3_final" })],
    ["conviction fora de [0,1]", () => validPackage({ regime: { conviction_score: 1.4 } })],
    ["regime.method statistical proibido em v1.x", () => validPackage({ regime: { method: "statistical" } })],
    ["outlook fora do enum", () => validPackage({ brazil: { ratings: { sp: { rating: "BB", outlook: "bullish" } } } })],
    ["directed_credit_share > 1", () => validPackage({ brazil: { credit_system: { directed_credit_share: 1.7 } } })],
    ["watermark obrigatorio ausente", () => { const p = validPackage(); delete p.source_watermarks.b3_investor_flow; return p; }],
    ["overall_confidence negativo", () => validPackage({ quality: { overall_confidence: -0.1 } })],
    ["gross_debt_gdp ausente", () => { const p = validPackage(); delete p.brazil.macro.gross_debt_gdp; return p; }],
    ["foreign_net_status invalido", () => validPackage({ brazil: { equity: { foreign_net_status: "d2" } } })],
    // L2 — desonestidade do seed
    ["L2 contaminacao mista: 1 fonte seed entre oficiais nao declarada", () => { const p = validPackage(); p.source_watermarks.tesouro.status = "seed"; return p; }],
    ["L2 seed sem is_seed_mode", () => { const p = seedPackage(); p.is_seed_mode = false; return p; }],
    ["L2 seed sem seed_penalty", () => { const p = seedPackage(); delete p.quality.seed_penalty; return p; }],
    ["L2 seed com confianca acima do teto", () => { const p = seedPackage(); p.quality.overall_confidence = 0.79; return p; }],
    ["L2 is_seed_mode true sem watermark seed", () => validPackage({ is_seed_mode: true })],
    // L3 — lineage
    ["L3 version 2 sem supersedes", () => validPackage({ version: 2, supersedes_context_id: null })],
    ["L3 pacote sucede a si mesmo", () => validPackage({ version: 2, supersedes_context_id: "ctx_2026-07-08_br_close_v1_t0" })],
    ["L4 unavailable proibido em 1.1", () => validPackage({ source_watermarks: { ibge: { status: "unavailable" } } })]
  ];
  for (const [name, build] of mustReject) {
    const r = validateContextPackage(build());
    r.ok ? fail(`rejeitar: ${name}`, "passou mas deveria falhar") : pass(`rejeitar: ${name}`);
  }

  // --- compatibilidade ---
  const compat = [
    ["exact 1.1<-1.1", checkCompatibility("1.1", "1.1").status, "exact"],
    ["forward 1.4->cons 1.1", checkCompatibility("1.4", "1.1").status, "forward_ok"],
    ["degraded 1.0->cons 1.1", checkCompatibility("1.0", "1.1").status, "degraded"],
    ["incompatible 2.0->cons 1.1", checkCompatibility("2.0", "1.1").status, "incompatible"]
  ];
  for (const [name, got, want] of compat) {
    got === want ? pass(`compat: ${name}`) : fail(`compat: ${name}`, `got ${got} want ${want}`);
  }

  // --- ausencia ruidosa ---
  {
    const p = validPackage({ brazil: { equity: { foreign_net_brl: null } } });
    const miss = signalMissing(p, ["brazil.equity.foreign_net_brl", "brazil.macro.selic_target"]);
    const ok = miss.length === 1 && miss[0] === "brazil.equity.foreign_net_brl";
    ok ? pass("signalMissing detecta fluxo null") : fail("signalMissing detecta fluxo null", miss);
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok ? "" : "  -> " + JSON.stringify(c.detail)}`);
  console.log(`\n=== SELF-TEST: ${cases.length - failed.length} passou, ${failed.length} falhou | contrato ${CONTRACT_VERSION} ===`);
  return { ok: failed.length === 0, total: cases.length, failed: failed.length };
}

const IS_DIRECT_EXECUTION = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (process.env.NEXO_SELFTEST === "1" && IS_DIRECT_EXECUTION) {
  const r = selfTest();
  process.exit(r.ok ? 0 : 1);
}
