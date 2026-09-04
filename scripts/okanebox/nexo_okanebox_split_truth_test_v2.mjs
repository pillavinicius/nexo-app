/**
 * NEXO OkaneBox Split Truth Test v2
 *
 * Pergunta única e binária:
 *   A série da OkaneBox vem CRUA (mostra o degrau do split) ou JÁ AJUSTADA (contínua)?
 *
 * Diferença para a v1:
 *   - FILTRO DE COERÊNCIA DE EVENTO: só usa como TESTEMUNHA um split que seja
 *     inequívoco. Rejeita eventos malformados (ex.: TIMS3, reverse_split com
 *     factor_from 0.01 e ratio 100 — type briga com a direção dos fatores).
 *   - AUTO-DESCOBERTA: varre uma lista ampla de tickers líquidos e deixa o HG
 *     declarar quais têm split real; o filtro decide quais servem de testemunha.
 *   - VEREDITO exige n >= 3 testemunhas LIMPAS e concordantes. Sem isso,
 *     devolve NO_CLEAN_WITNESSES (honesto), nunca um palpite.
 *   - MODO OFFLINE: `node ... --selftest` valida a lógica sem rede nem API.
 *
 * Uso ao vivo:
 *   export OKANE_EMAIL="seu-email-cadastrado"
 *   export HG_BRASIL_KEY="sua-chave-hg"
 *   node nexo_okanebox_split_truth_test_v2.mjs
 *   node nexo_okanebox_split_truth_test_v2.mjs PETR4 VALE3 ENJU3   # tickers manuais
 *
 * Self-test offline:
 *   node nexo_okanebox_split_truth_test_v2.mjs --selftest
 */

const OKANE_BASE = "https://www.okanebox.com.br/api";
const HG_BASE = "https://api.hgbrasil.com/v2/finance";
const DEFAULT_START = "2015-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);

// Pool amplo de nomes líquidos da B3. NÃO é uma lista de "sei que estes
// desdobraram" — é só o conjunto que o HG vai filtrar. Quem tiver split real
// e coerente vira testemunha; o resto é ignorado.
const DEFAULT_TICKERS = [
  "TIMS3","MGLU3","WEGE3","LREN3","PETR4","VALE3","ITUB4","BBDC4","ABEV3",
  "RAIL3","RADL3","EQTL3","SUZB3","KLBN11","SAPR11","TOTS3","RENT3","PRIO3",
  "ENJU3","CASH3","HAPV3","ASAI3","NTCO3","CSAN3","GGBR4","CMIG4","ELET3",
];

// ----- bandas de classificação (log-distância) -----
const CONTINUOUS_BAND = Math.log(1.10); // ±10% em torno de 1.0 => série contínua/ajustada
const RAW_STEP_BAND = Math.log(1.20);   // ±20% em torno de 1/ratio => degrau cru presente
const MIN_RATIO_MAGNITUDE = 1.5;        // split pequeno demais é ambíguo
const MIN_CANDLES_BEFORE = 20;
const MIN_CANDLES_AFTER = 5;
const FACTOR_FLOOR = 0.5;               // share count fracionário (0.01) = encoding suspeito
const FIELD_TOLERANCE = 0.10;           // ratio vs factor_to/factor_from

function toNumber(v){ if(v===null||v===undefined||v==="") return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function round(v,d=6){ const n=toNumber(v); if(n===null) return null; const p=10**d; return Math.round(n*p)/p; }
function ymdCompact(s){ return String(s||"").replaceAll("-","").slice(0,8); }
function normalizeDate(d){ return d ? String(d).slice(0,10) : null; }
function sortAsc(c=[]){ return [...c].sort((a,b)=>String(a.date).localeCompare(String(b.date))); }

/* =========================================================================
   FILTRO DE COERÊNCIA DE EVENTO — o coração da v2.
   Um evento só pode TESTEMUNHAR se for inequívoco. Sete checagens; basta
   uma falhar para o evento ser descartado como testemunha (com o motivo).
========================================================================= */
function assessWitnessQuality(event) {
  const reasons = [];
  const ratio = toNumber(event?.ratio);
  const ff = toNumber(event?.factor_from);
  const ft = toNumber(event?.factor_to);
  const type = String(event?.type || "").toLowerCase();
  const comDate = normalizeDate(event?.com_date);

  if (event?.status !== "confirmed") reasons.push("not_confirmed");
  if (ratio === null || ratio <= 0) reasons.push("ratio_invalid");
  if (!comDate) reasons.push("com_date_missing");

  // 1) fatores não-degenerados (rejeita o 0.01 do TIMS3)
  if (ff === null || ft === null || ff < FACTOR_FLOOR || ft < FACTOR_FLOOR)
    reasons.push("degenerate_factors");

  // 2) ratio reconcilia com factor_to/factor_from (campos HG internamente coerentes)
  if (ff && ft && ratio) {
    const implied = ft / ff;
    const rel = Math.abs(Math.log(ratio / implied));
    if (rel > Math.log(1 + FIELD_TOLERANCE)) reasons.push("ratio_mismatch_factors");
  }

  // 3) type concorda com a direção (split => ratio>1 ; reverse_split => ratio<1)
  if (ratio) {
    if (type === "split" && ratio <= 1) reasons.push("split_but_ratio_not_gt_1");
    if (type === "reverse_split" && ratio >= 1) reasons.push("reverse_split_but_ratio_not_lt_1");
  }

  // 4) magnitude inequívoca (evita confundir com volatilidade diária normal)
  if (ratio) {
    const mag = ratio >= 1 ? ratio : 1 / ratio;
    if (mag < MIN_RATIO_MAGNITUDE) reasons.push("magnitude_too_small");
  }

  return { usable: reasons.length === 0, reasons, ratio, com_date: comDate, type };
}

/* Classifica o que a série crua mostra na com_date.
   Série CRUA: observed (after/before) ≈ 1/ratio (o degrau está lá).
   Série AJUSTADA: observed ≈ 1.0 (contínua). */
function classifyContinuity(observedRatio, eventRatio) {
  if (!observedRatio || !eventRatio) return { verdict: "insufficient_data" };
  const toContinuous = Math.abs(Math.log(observedRatio));            // dist. de 1.0
  const toRawStep = Math.abs(Math.log(observedRatio * eventRatio));  // dist. de 1/ratio
  const dist = { toContinuous1x: round(toContinuous), toRawStep: round(toRawStep) };

  if (toContinuous < CONTINUOUS_BAND) return { verdict: "continuous_series", meaning: "already_adjusted_at_this_event", dist };
  if (toRawStep < RAW_STEP_BAND) return { verdict: "raw_step_present", meaning: "needs_adjustment_at_this_event", dist };
  return { verdict: "inconsistent", meaning: "neither_continuous_nor_expected_step", dist };
}

/* =========================== REDE (modo ao vivo) =========================== */
async function fetchJsonStrict(url, headers = {}) {
  const r = await fetch(url, { cache: "no-store", headers });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { return { ok:false, httpOk:r.ok, reason:"invalid_json", data:null }; }
  if (!r.ok) return { ok:false, httpOk:false, reason:"http_error", data };
  return { ok:true, httpOk:true, reason:"ok", data };
}
async function fetchOkaneDaily(ticker, email) {
  const url = `${OKANE_BASE}/acoes/hist/${encodeURIComponent(ticker)}/${ymdCompact(DEFAULT_START)}/${ymdCompact(DEFAULT_END)}/`;
  const res = await fetchJsonStrict(url, { Authorization:`Bearer ${email}`, Accept:"application/json" });
  if (!res.ok) return { ok:false, reason:res.reason, candles:[] };
  const d = res.data;
  const arr = Array.isArray(d)?d:Array.isArray(d?.data)?d.data:Array.isArray(d?.results)?d.results:Array.isArray(d?.historico)?d.historico:[];
  const candles = sortAsc(arr.map(q=>({date:normalizeDate(q.DATPRG),close:toNumber(q.PREULT)})).filter(c=>c.date&&c.close!==null));
  return { ok:true, candles };
}
function interpretHgSplits(res) {
  if (!res?.ok || !res?.httpOk) return { ok:false, splitStatus:"splits_unavailable", events:[] };
  const keyOk = res.data?.metadata?.key_status === "valid";
  const events = res.data?.results?.[0]?.events;
  if (!keyOk || !Array.isArray(events)) return { ok:false, splitStatus:"splits_unavailable", events:[] };
  const confirmed = events.filter(e=>e?.status==="confirmed");
  return { ok:true, splitStatus: confirmed.length?"confirmed_events_reported":"no_events_reported", events: confirmed };
}
async function fetchHgSplits(ticker, key) {
  const url = `${HG_BASE}/splits?tickers=B3:${encodeURIComponent(ticker)}&key=${encodeURIComponent(key)}`;
  return interpretHgSplits(await fetchJsonStrict(url, { Accept:"application/json" }));
}
function lastBefore(c, d){ return [...c].reverse().find(x=>String(x.date)<String(d)) || null; }
function firstOnAfter(c, d){ return c.find(x=>String(x.date)>=String(d)) || null; }

async function analyzeTicker(ticker) {
  const okane = await fetchOkaneDaily(ticker, process.env.OKANE_EMAIL);
  const splits = await fetchHgSplits(ticker, process.env.HG_BRASIL_KEY);
  if (!okane.ok) return { ticker, ok:false, reason:"okane_failed" };
  if (!splits.ok) return { ticker, ok:true, witnesses:[], note:"splits_unavailable" };

  const witnesses = [];
  for (const ev of splits.events) {
    const q = assessWitnessQuality(ev);
    if (!q.usable) { witnesses.push({ event:ev, usable:false, rejectedBecause:q.reasons }); continue; }
    const before = lastBefore(okane.candles, q.com_date);
    const after = firstOnAfter(okane.candles, q.com_date);
    const idx = okane.candles.findIndex(x=>String(x.date)>=String(q.com_date));
    const candlesBefore = idx;
    const candlesAfter = idx === -1 ? 0 : okane.candles.length - idx;
    if (!before || !after || candlesBefore < MIN_CANDLES_BEFORE || candlesAfter < MIN_CANDLES_AFTER) {
      witnesses.push({ event:ev, usable:false, rejectedBecause:["insufficient_coverage_window"] });
      continue;
    }
    const observed = after.close / before.close;
    witnesses.push({
      event:{ type:ev.type, ratio:ev.ratio, com_date:q.com_date },
      usable:true,
      before:{date:before.date,close:before.close},
      after:{date:after.date,close:after.close},
      observedRatio: round(observed),
      classification: classifyContinuity(observed, q.ratio),
    });
  }
  return { ticker, ok:true, witnesses };
}

function aggregate(results) {
  const clean = [];
  for (const r of results) for (const w of (r.witnesses||[])) if (w.usable) clean.push({ ticker:r.ticker, ...w });
  const tally = clean.reduce((a,w)=>{ const v=w.classification.verdict; a[v]=(a[v]||0)+1; return a; }, {});
  let verdict = "NO_CLEAN_WITNESSES";
  const n = clean.length;
  if (n >= 3) {
    if (clean.every(w=>w.classification.verdict==="continuous_series")) verdict = "OKANE_ALREADY_ADJUSTED__DROP_SPLIT_ENGINE";
    else if (clean.every(w=>w.classification.verdict==="raw_step_present")) verdict = "OKANE_RAW__KEEP_SPLIT_ENGINE";
    else verdict = "MIXED__DECIDE_PER_TICKER";
  } else if (n > 0) {
    verdict = "INSUFFICIENT_CLEAN_WITNESSES_NEED_3";
  }
  return { cleanWitnessCount:n, verdictTally:tally, finalVerdict:verdict };
}

/* =========================== SELF-TEST OFFLINE =========================== */
function selftest() {
  let pass=0, fail=0;
  const check=(name,cond)=>{ console.log(`  [${cond?"OK":"XX"}] ${name}`); cond?pass++:fail++; };

  console.log("\n# Filtro de testemunha (assessWitnessQuality)");
  check("TIMS3 malformado (reverse_split, 0.01->1, ratio 100) => REJEITADO",
    !assessWitnessQuality({type:"reverse_split",factor_from:0.01,factor_to:1,ratio:100,com_date:"2025-07-02",status:"confirmed"}).usable);
  check("desdobramento limpo 1->4 (ratio 4) => ACEITO",
    assessWitnessQuality({type:"split",factor_from:1,factor_to:4,ratio:4,com_date:"2021-01-01",status:"confirmed"}).usable);
  check("grupamento limpo 10->1 (ratio 0.1) => ACEITO",
    assessWitnessQuality({type:"reverse_split",factor_from:10,factor_to:1,ratio:0.1,com_date:"2021-01-01",status:"confirmed"}).usable);
  check("split minúsculo 1->1.1 (ratio 1.1) => REJEITADO (magnitude)",
    !assessWitnessQuality({type:"split",factor_from:1,factor_to:1.1,ratio:1.1,com_date:"2021-01-01",status:"confirmed"}).usable);
  check("ratio briga com fatores (1->4 mas ratio 2) => REJEITADO",
    !assessWitnessQuality({type:"split",factor_from:1,factor_to:4,ratio:2,com_date:"2021-01-01",status:"confirmed"}).usable);
  check("direção errada (reverse_split com fatores 1->4) => REJEITADO",
    !assessWitnessQuality({type:"reverse_split",factor_from:1,factor_to:4,ratio:4,com_date:"2021-01-01",status:"confirmed"}).usable);
  check("pending (não confirmado) => REJEITADO",
    !assessWitnessQuality({type:"split",factor_from:1,factor_to:4,ratio:4,com_date:"2021-01-01",status:"pending"}).usable);

  console.log("\n# Classificador de continuidade (classifyContinuity)");
  check("desdobr. 4 em série CRUA (40->10, obs 0.25) => raw_step_present",
    classifyContinuity(10/40, 4).verdict === "raw_step_present");
  check("desdobr. 4 em série AJUSTADA (10->10.1, obs ~1.0) => continuous_series",
    classifyContinuity(10.1/10, 4).verdict === "continuous_series");
  check("grupam. 0.1 em série CRUA (2->20, obs 10) => raw_step_present",
    classifyContinuity(20/2, 0.1).verdict === "raw_step_present");
  check("queda de 12.5% (obs 0.875, ratio 4) => inconsistent (não é degrau nem contínuo)",
    classifyContinuity(0.875, 4).verdict === "inconsistent");

  console.log("\n# Agregação");
  const mk=(v)=>({ticker:"X",witnesses:[{usable:true,classification:{verdict:v}}]});
  check("3 contínuas => DROP_SPLIT_ENGINE",
    aggregate([mk("continuous_series"),mk("continuous_series"),mk("continuous_series")]).finalVerdict==="OKANE_ALREADY_ADJUSTED__DROP_SPLIT_ENGINE");
  check("3 com degrau => KEEP_SPLIT_ENGINE",
    aggregate([mk("raw_step_present"),mk("raw_step_present"),mk("raw_step_present")]).finalVerdict==="OKANE_RAW__KEEP_SPLIT_ENGINE");
  check("misturado => DECIDE_PER_TICKER",
    aggregate([mk("continuous_series"),mk("raw_step_present"),mk("continuous_series")]).finalVerdict==="MIXED__DECIDE_PER_TICKER");
  check("só 1 testemunha (TIMS3-like) => INSUFFICIENT (não decide)",
    aggregate([mk("continuous_series")]).finalVerdict==="INSUFFICIENT_CLEAN_WITNESSES_NEED_3");
  check("zero testemunhas => NO_CLEAN_WITNESSES",
    aggregate([{ticker:"X",witnesses:[{usable:false}]}]).finalVerdict==="NO_CLEAN_WITNESSES");

  console.log(`\n===== SELF-TEST: ${pass} passou, ${fail} falhou =====`);
  process.exit(fail ? 1 : 0);
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();
  console.log("\nNEXO OkaneBox Split Truth Test v2 (auto-descoberta + filtro de coerência)");
  if (!process.env.OKANE_EMAIL) throw new Error('OKANE_EMAIL ausente.');
  if (!process.env.HG_BRASIL_KEY) throw new Error('HG_BRASIL_KEY ausente.');
  const args = process.argv.slice(2).filter(a=>!a.startsWith("--")).map(x=>x.toUpperCase());
  const tickers = args.length ? args : DEFAULT_TICKERS;

  const results = [];
  for (const t of tickers) { console.log(` . ${t}`); results.push(await analyzeTicker(t)); }

  console.log("\n--- Testemunhas por ticker ---");
  console.log(JSON.stringify(results.map(r=>({
    ticker:r.ticker,
    usableWitnesses:(r.witnesses||[]).filter(w=>w.usable).map(w=>({event:w.event,observedRatio:w.observedRatio,verdict:w.classification?.verdict})),
    rejected:(r.witnesses||[]).filter(w=>!w.usable).map(w=>({type:w.event?.type,ratio:w.event?.ratio,because:w.rejectedBecause})),
  })), null, 2));

  console.log("\n--- VEREDITO ---");
  console.log(JSON.stringify(aggregate(results), null, 2));
  console.log("\nLeitura:");
  console.log("  OKANE_ALREADY_ADJUSTED => apagar motor de splits; usar OkaneBox direto + checagem de sanidade.");
  console.log("  OKANE_RAW              => manter motor; mas só aceitar ajuste se o degrau SUMIR e o CAGR ficar plausível.");
  console.log("  NO_CLEAN_WITNESSES     => HG não reportou split limpo no pool; semear desdobramentos B3 conhecidos.");
}

main().catch(e=>{ console.error("\nERRO:", e?.message||e); process.exit(1); });
