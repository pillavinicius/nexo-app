/**
 * NEXO OkaneBox Split Truth Test v3 (SEEDED)
 *
 * Pergunta única: a série da OkaneBox vem CRUA ou JÁ AJUSTADA?
 *
 * Diferença para a v2: NÃO usa o /splits do HG (provado esparso e malformado —
 * só conhecia 2 de 27 tickers, ambos eventos fantasmas). Em vez disso, usa uma
 * tabela de splits REAIS e VERIFICADOS por fontes independentes, e observa a
 * continuidade da série OkaneBox exatamente nas datas conhecidas.
 *
 * Testemunhas (verificadas — InfoMoney/MoneyTimes, fatos relevantes B3):
 *   - MGLU3, desdobramento 1:4, ex em 2020-10-14  (~R$88,94 -> ~R$22)
 *   - MGLU3, grupamento 10:1,   grupada em 2024-05-27 (~R$1,41 -> ~R$14)
 *   Dois eventos OPOSTOS no mesmo ticker = controle de direção embutido.
 *
 * Uso ao vivo:
 *   export OKANE_EMAIL="seu-email-cadastrado"
 *   node nexo_okanebox_split_truth_test_v3_seeded.mjs
 *
 * Self-test offline (sem rede):
 *   node nexo_okanebox_split_truth_test_v3_seeded.mjs --selftest
 */

const OKANE_BASE = "https://www.okanebox.com.br/api";
const DEFAULT_START = "2015-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);

const CONTINUOUS_BAND = Math.log(1.10); // ±10% de 1.0  => contínua/ajustada
const RAW_STEP_BAND = Math.log(1.25);   // ±25% de 1/ratio => degrau cru presente

// eventRatio na convenção: série CRUA => observed (after/before) ≈ 1/eventRatio.
//   desdobramento 1:4 => preço cai p/ 1/4 => observed ≈ 0.25 => eventRatio = 4
//   grupamento 10:1   => preço sobe 10x  => observed ≈ 10   => eventRatio = 0.1
const VERIFIED_SPLITS = [
  {
    ticker: "SAPR11", boundaryDate: "2020-03-30", type: "split", eventRatio: 3,
    rawExpectedObserved: 0.3333,
    source: "Sanepar desdobramento 3:1 (cada Unit -> 3 Units), ex-desdobramento em 30/03/2020 (XP/fato relevante; alvo caiu de R$98 p/ R$33).",
  },
  {
    // Mantido como testemunha secundaria; OkaneBox pode nao cobrir 2020/2024 p/ MGLU3.
    ticker: "MGLU3", boundaryDate: "2024-05-27", type: "reverse_split", eventRatio: 0.1,
    rawExpectedObserved: 10,
    source: "Magalu grupamento 10:1, negociacao grupada a partir de 27/05/2024 (InfoMoney/MoneyTimes).",
  },
];

function toNumber(v){ if(v===null||v===undefined||v==="") return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function round(v,d=6){ const n=toNumber(v); if(n===null) return null; const p=10**d; return Math.round(n*p)/p; }
function ymdCompact(s){ return String(s||"").replaceAll("-","").slice(0,8); }
function normalizeDate(d){ return d ? String(d).slice(0,10) : null; }
function sortAsc(c=[]){ return [...c].sort((a,b)=>String(a.date).localeCompare(String(b.date))); }

function classifyContinuity(observedRatio, eventRatio) {
  if (!observedRatio || !eventRatio) return { verdict: "insufficient_data" };
  const toContinuous = Math.abs(Math.log(observedRatio));
  const toRawStep = Math.abs(Math.log(observedRatio * eventRatio));
  const dist = { toContinuous1x: round(toContinuous), toRawStep: round(toRawStep) };
  if (toContinuous < CONTINUOUS_BAND) return { verdict: "continuous_series", meaning: "already_adjusted_at_this_event", dist };
  if (toRawStep < RAW_STEP_BAND) return { verdict: "raw_step_present", meaning: "raw_needs_adjustment_at_this_event", dist };
  return { verdict: "inconsistent", meaning: "neither_continuous_nor_expected_step", dist };
}

async function fetchJsonStrict(url, headers = {}) {
  const r = await fetch(url, { cache: "no-store", headers });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { return { ok:false, reason:"invalid_json" }; }
  if (!r.ok) return { ok:false, reason:"http_error" };
  return { ok:true, data };
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
function lastBefore(c, d){ return [...c].reverse().find(x=>String(x.date)<String(d)) || null; }
function firstOnAfter(c, d){ return c.find(x=>String(x.date)>=String(d)) || null; }

function analyzeOneEvent(candles, ev) {
  const before = lastBefore(candles, ev.boundaryDate);
  const after = firstOnAfter(candles, ev.boundaryDate);
  if (!before || !after) {
    return { ...ev, usable:false, reason:"event_outside_okane_coverage",
      coverage:{ first:candles[0]?.date||null, last:candles[candles.length-1]?.date||null } };
  }
  const observed = after.close / before.close;
  return {
    ticker: ev.ticker, boundaryDate: ev.boundaryDate, type: ev.type, eventRatio: ev.eventRatio,
    rawExpectedObserved: ev.rawExpectedObserved,
    before: { date: before.date, close: before.close },
    after: { date: after.date, close: after.close },
    observedRatio: round(observed),
    classification: classifyContinuity(observed, ev.eventRatio),
    source: ev.source,
  };
}

function decide(events) {
  const usable = events.filter(e => e.classification);
  const verdicts = usable.map(e => e.classification.verdict);
  let finalVerdict = "INDETERMINATE";
  if (usable.length >= 2 && verdicts.every(v => v === "continuous_series"))
    finalVerdict = "OKANE_ALREADY_ADJUSTED__DROP_SPLIT_ENGINE";
  else if (usable.length >= 2 && verdicts.every(v => v === "raw_step_present"))
    finalVerdict = "OKANE_RAW__KEEP_SPLIT_ENGINE";
  else if (verdicts.some(v => v === "raw_step_present") && verdicts.some(v => v === "continuous_series"))
    finalVerdict = "MIXED__INVESTIGATE_PER_TICKER";
  else if (usable.length < 2)
    finalVerdict = "INSUFFICIENT_USABLE_WITNESSES";
  return { usableWitnesses: usable.length, verdicts, finalVerdict };
}

/* =========================== SELF-TEST OFFLINE =========================== */
function selftest() {
  let pass=0, fail=0;
  const check=(n,c)=>{ console.log(`  [${c?"OK":"XX"}] ${n}`); c?pass++:fail++; };
  const mock = (rows) => sortAsc(rows.map(([date,close])=>({date,close})));

  // Série CRUA: degrau real nas datas
  const rawMglu = mock([
    ["2020-03-27",60.48],["2020-03-30",20.16],["2020-03-31",20.50],
    ["2024-05-24",1.41],["2024-05-27",14.10],["2024-05-28",13.95],
  ]);
  // Série AJUSTADA: contínua (preços antigos já trazidos p/ escala atual)
  const adjMglu = mock([
    ["2020-03-27",20.16],["2020-03-30",20.16],["2020-03-31",20.50],
    ["2024-05-24",14.10],["2024-05-27",14.10],["2024-05-28",13.95],
  ]);

  console.log("\n# Série CRUA (deve detectar degrau nos dois eventos)");
  const rawRes = VERIFIED_SPLITS.map(ev => analyzeOneEvent(rawMglu, ev));
  check("desdobr. SAPR11 2020 (60.48 -> 20.16, obs ~0.333) => raw_step_present",
    rawRes[0].classification.verdict === "raw_step_present");
  check("grupam. 2024 (1.41 -> 14.10, obs ~10) => raw_step_present",
    rawRes[1].classification.verdict === "raw_step_present");
  check("veredito CRU => KEEP_SPLIT_ENGINE",
    decide(rawRes).finalVerdict === "OKANE_RAW__KEEP_SPLIT_ENGINE");

  console.log("\n# Série AJUSTADA (deve ver continuidade nos dois eventos)");
  const adjRes = VERIFIED_SPLITS.map(ev => analyzeOneEvent(adjMglu, ev));
  check("desdobr. SAPR11 2020 (20.16 -> 20.16, obs ~1.0) => continuous_series",
    adjRes[0].classification.verdict === "continuous_series");
  check("grupam. 2024 (14.10 -> 14.10, obs ~1.0) => continuous_series",
    adjRes[1].classification.verdict === "continuous_series");
  check("veredito AJUSTADO => DROP_SPLIT_ENGINE",
    decide(adjRes).finalVerdict === "OKANE_ALREADY_ADJUSTED__DROP_SPLIT_ENGINE");

  console.log("\n# Cobertura insuficiente");
  const shortSeries = mock([["2025-01-02",10],["2025-01-03",10.1]]);
  check("evento fora da janela OkaneBox => usable:false",
    analyzeOneEvent(shortSeries, VERIFIED_SPLITS[0]).usable === false);

  console.log(`\n===== SELF-TEST: ${pass} passou, ${fail} falhou =====`);
  process.exit(fail ? 1 : 0);
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();
  console.log("\nNEXO OkaneBox Split Truth Test v3 (SEEDED, sem HG /splits)");
  if (!process.env.OKANE_EMAIL) throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="seu-email"');

  const byTicker = {};
  for (const ev of VERIFIED_SPLITS) (byTicker[ev.ticker] ||= []).push(ev);

  const allEvents = [];
  for (const ticker of Object.keys(byTicker)) {
    console.log(` . baixando OkaneBox ${ticker} ...`);
    const okane = await fetchOkaneDaily(ticker, process.env.OKANE_EMAIL);
    if (!okane.ok) { console.log(`   ! falha OkaneBox ${ticker}: ${okane.reason}`); continue; }
    console.log(`   cobertura: ${okane.candles[0]?.date} -> ${okane.candles[okane.candles.length-1]?.date} (${okane.candles.length} candles)`);
    for (const ev of byTicker[ticker]) allEvents.push(analyzeOneEvent(okane.candles, ev));
  }

  console.log("\n--- Eventos verificados x série OkaneBox ---");
  console.log(JSON.stringify(allEvents, null, 2));

  console.log("\n--- VEREDITO ---");
  console.log(JSON.stringify(decide(allEvents), null, 2));
  console.log("\nLeitura:");
  console.log("  KEEP_SPLIT_ENGINE  => OkaneBox é CRUA: manter motor de ajuste (com critério: degrau some + CAGR plausível).");
  console.log("  DROP_SPLIT_ENGINE  => OkaneBox JÁ AJUSTADA: apagar motor de splits, usar direto + sanidade.");
  console.log("  MIXED              => por ticker; investigar (não deveria acontecer com 2 eventos do mesmo papel).");
}

main().catch(e=>{ console.error("\nERRO:", e?.message||e); process.exit(1); });
