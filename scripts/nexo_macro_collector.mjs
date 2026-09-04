// ============================================================================
// NEXO — Coletor Macro (Brasil + EUA)  v0.1
// ----------------------------------------------------------------------------
// Ferramenta OFFLINE. Roda no Google Cloud Shell, NÃO na Vercel.
// Produz UMA tabela única (nexo_macro.csv): 1 linha por gestão presidencial.
// Princípio NEXO: o código coleta, calcula e classifica. Claude interpreta.
//
// COMO RODAR:
//   1) Salve este arquivo.
//   2) Pegue uma chave gratuita do FRED: https://fred.stlouisfed.org/docs/api/api_key.html
//   3) export FRED_API_KEY="suachave"
//   4) node nexo_macro_collector.mjs
//   5) Confira nexo_macro.csv e o resumo impresso no terminal.
//
// TESTE DE LÓGICA (sem internet, valida só os cálculos/classificações):
//   NEXO_SELFTEST=1 node nexo_macro_collector.mjs
// ============================================================================

import { writeFileSync, readFileSync } from "node:fs";

// ----------------------------------------------------------------------------
// 0. GUARDAS DE AMBIENTE
// ----------------------------------------------------------------------------
const SELFTEST = process.env.NEXO_SELFTEST === "1";
const VERSION = "v0.3 (refresh-mode)";
const REFRESH = process.argv.includes("--refresh");
// No full puxa desde 1974; no refresh só os últimos anos (rápido), pois só
// recalcula o mandato atual.
const SINCE_YEAR = REFRESH ? new Date().getFullYear() - 3 : 1974;
if (typeof fetch === "undefined") {
  console.error("✗ Seu Node não tem fetch nativo. Use Node 18+ (no Cloud Shell: `node -v`).");
  process.exit(1);
}

// ----------------------------------------------------------------------------
// 1. SCAFFOLD: GESTÕES PRESIDENCIAIS (data_inicio, data_fim em ISO AAAA-MM-DD)
//    fim = null  -> mandato em curso (usa data de hoje como "fim").
// ----------------------------------------------------------------------------
const MANDATOS = [
  // BRASIL — a partir da criação da CVM (1976). Pré-1994-07 = qualitativo.
  { id: "BR-1974-GEISEL",     pais: "BR", gestao: "Geisel",     n: 1, ini: "1974-03-15", fim: "1979-03-15" },
  { id: "BR-1979-FIGUEIREDO", pais: "BR", gestao: "Figueiredo", n: 1, ini: "1979-03-15", fim: "1985-03-15" },
  { id: "BR-1985-SARNEY",     pais: "BR", gestao: "Sarney",     n: 1, ini: "1985-03-15", fim: "1990-03-15" },
  { id: "BR-1990-COLLOR",     pais: "BR", gestao: "Collor",     n: 1, ini: "1990-03-15", fim: "1992-12-29" },
  { id: "BR-1992-ITAMAR",     pais: "BR", gestao: "Itamar",     n: 1, ini: "1992-12-29", fim: "1995-01-01" },
  { id: "BR-1995-FHC1",       pais: "BR", gestao: "FHC",        n: 1, ini: "1995-01-01", fim: "1999-01-01" },
  { id: "BR-1999-FHC2",       pais: "BR", gestao: "FHC",        n: 2, ini: "1999-01-01", fim: "2003-01-01" },
  { id: "BR-2003-LULA1",      pais: "BR", gestao: "Lula",       n: 1, ini: "2003-01-01", fim: "2007-01-01" },
  { id: "BR-2007-LULA2",      pais: "BR", gestao: "Lula",       n: 2, ini: "2007-01-01", fim: "2011-01-01" },
  { id: "BR-2011-DILMA1",     pais: "BR", gestao: "Dilma",      n: 1, ini: "2011-01-01", fim: "2015-01-01" },
  { id: "BR-2015-DILMA2",     pais: "BR", gestao: "Dilma",      n: 2, ini: "2015-01-01", fim: "2016-08-31" },
  { id: "BR-2016-TEMER",      pais: "BR", gestao: "Temer",      n: 1, ini: "2016-08-31", fim: "2019-01-01" },
  { id: "BR-2019-BOLSONARO",  pais: "BR", gestao: "Bolsonaro",  n: 1, ini: "2019-01-01", fim: "2023-01-01" },
  { id: "BR-2023-LULA3",      pais: "BR", gestao: "Lula",       n: 3, ini: "2023-01-01", fim: null },

  // EUA — janela paralela (1976→). Dado limpo, mas alguns campos só existem mais tarde.
  { id: "US-1974-FORD",       pais: "US", gestao: "Ford",       n: 1, ini: "1974-08-09", fim: "1977-01-20" },
  { id: "US-1977-CARTER",     pais: "US", gestao: "Carter",     n: 1, ini: "1977-01-20", fim: "1981-01-20" },
  { id: "US-1981-REAGAN1",    pais: "US", gestao: "Reagan",     n: 1, ini: "1981-01-20", fim: "1985-01-20" },
  { id: "US-1985-REAGAN2",    pais: "US", gestao: "Reagan",     n: 2, ini: "1985-01-20", fim: "1989-01-20" },
  { id: "US-1989-BUSHSR",     pais: "US", gestao: "Bush (pai)", n: 1, ini: "1989-01-20", fim: "1993-01-20" },
  { id: "US-1993-CLINTON1",   pais: "US", gestao: "Clinton",    n: 1, ini: "1993-01-20", fim: "1997-01-20" },
  { id: "US-1997-CLINTON2",   pais: "US", gestao: "Clinton",    n: 2, ini: "1997-01-20", fim: "2001-01-20" },
  { id: "US-2001-BUSHJR1",    pais: "US", gestao: "Bush (filho)", n: 1, ini: "2001-01-20", fim: "2005-01-20" },
  { id: "US-2005-BUSHJR2",    pais: "US", gestao: "Bush (filho)", n: 2, ini: "2005-01-20", fim: "2009-01-20" },
  { id: "US-2009-OBAMA1",     pais: "US", gestao: "Obama",      n: 1, ini: "2009-01-20", fim: "2013-01-20" },
  { id: "US-2013-OBAMA2",     pais: "US", gestao: "Obama",      n: 2, ini: "2013-01-20", fim: "2017-01-20" },
  { id: "US-2017-TRUMP1",     pais: "US", gestao: "Trump",      n: 1, ini: "2017-01-20", fim: "2021-01-20" },
  { id: "US-2021-BIDEN",      pais: "US", gestao: "Biden",      n: 1, ini: "2021-01-20", fim: "2025-01-20" },
  { id: "US-2025-TRUMP2",     pais: "US", gestao: "Trump",      n: 2, ini: "2025-01-20", fim: null },
];

// ----------------------------------------------------------------------------
// 2. MAPEAMENTO DE SÉRIES (Passo 1 já confirmado nas fontes oficiais)
//    src: "bcb" | "fred" | "wb"
//    kind: "level" (variação em %) | "rate" (variação em p.p.)
//    Códigos marcados // CANDIDATO confirmam-se no resumo do teste real.
// ----------------------------------------------------------------------------
const SERIES = {
  juro_basico:  { BR: { src: "bcb", code: 432 },                 US: { src: "fred", code: "FEDFUNDS" },  kind: "rate" },
  inflacao_12m: { BR: { src: "bcb", code: 13522 },               US: { src: "fred", code: "CPIAUCSL", units: "pc1" }, kind: "rate" },
  pib_real_yoy: { BR: { src: "wb",  code: "NY.GDP.MKTP.KD.ZG" }, US: { src: "wb",  code: "NY.GDP.MKTP.KD.ZG" }, kind: "rate" },
  cambio:       { BR: { src: "bcb", code: 1 },                   US: { src: "fred", code: "DTWEXBGS" },  kind: "level" },
  bolsa:        { BR: { src: "bcb", code: 7 /* CANDIDATO */ },    US: { src: "fred", code: "SP500" },     kind: "level" },
  credito_pib:  { BR: { src: "bcb", code: 20622 },               US: { src: "fred", code: "QUSPAM770A" /* CANDIDATO */ }, kind: "rate" },
  desemprego:   { BR: { src: "bcb", code: 24369 /* CANDIDATO */ },US: { src: "fred", code: "UNRATE" },    kind: "rate" },
};

// Metas de inflação para classificar "ancorada/desancorada" (heurística v0.1).
const META_INFLACAO = { BR: 3.0, US: 2.0 };
const DATA_REAL = "1994-07-01"; // marco do Plano Real

// ----------------------------------------------------------------------------
// 3. UTILIDADES PURAS (testáveis offline)
// ----------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => new Date().toISOString().slice(0, 10);

function parseBRDate(s) { const [d, m, y] = s.split("/"); return new Date(`${y}-${m}-${d}`); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function round(n, d = 2) { return n == null ? null : Math.round(n * 10 ** d) / 10 ** d; }

// Escolhe a observação mais próxima do alvo, preferindo a última <= alvo.
// maxGapDays: se o ponto mais próximo estiver mais longe que isso, a série
// NÃO cobre a data -> devolve null (em vez de plantar um valor de outra época).
function pickNearest(obs, targetISO, maxGapDays = 140) {
  if (!obs || obs.length === 0) return null;
  const t = new Date(targetISO).getTime();
  let best = null, bestDiff = Infinity, lastBefore = null;
  for (const o of obs) {
    if (o.value == null) continue;
    const diff = Math.abs(o.ts - t);
    if (o.ts <= t) lastBefore = o; // memoriza última conhecida até a data
    if (diff < bestDiff) { bestDiff = diff; best = o; }
  }
  const cand = lastBefore ?? best;            // valor vigente; senão o mais próximo
  if (cand == null) return null;
  if (Math.abs(cand.ts - t) > maxGapDays * 86400000) return null; // fora da cobertura
  return cand;
}

function computeVar(ini, fim, kind) {
  if (ini == null || fim == null) return null;
  return kind === "level" ? round((fim / ini - 1) * 100) : round(fim - ini); // % ou p.p.
}

function dataQuality(pais, iniISO, fimISO) {
  if (pais !== "BR") return "comparavel";
  const real = new Date(DATA_REAL).getTime();
  const i = new Date(iniISO).getTime(), f = new Date(fimISO).getTime();
  if (f < real) return "hiperinflacao";
  if (i < real && f >= real) return "transicao";
  return "comparavel";
}

// ---- Classificadores de regime (heurísticas v0.1 — calibrar livremente) ----
function regimeJuro(realFim, nomIni, nomFim) {
  let nivel = "?";
  if (realFim != null) nivel = realFim >= 4 ? "alto" : realFim >= 1 ? "neutro" : "baixo";
  let dir = "estável";
  if (nomIni != null && nomFim != null) {
    const d = nomFim - nomIni;
    dir = d > 0.5 ? "subindo" : d < -0.5 ? "caindo" : "estável";
  }
  return `${nivel}/${dir}`;
}
function regimeInflacao(inflFim, meta) {
  if (inflFim == null) return null;
  if (inflFim < 0) return "deflação";
  if (inflFim <= meta + 1.5) return "ancorada";
  if (inflFim <= meta + 5) return "pressionada";
  return "desancorada";
}
function regimeCredito(varPP) {
  if (varPP == null) return null;
  return varPP > 0.5 ? "expansão" : varPP < -0.5 ? "contração" : "neutro";
}
function regimeCambial(pais, varPct) {
  if (varPct == null) return null;
  if (pais === "BR") return varPct > 5 ? "BRL depreciou" : varPct < -5 ? "BRL apreciou" : "estável";
  return varPct > 3 ? "dólar fortaleceu" : varPct < -3 ? "dólar enfraqueceu" : "estável";
}
function faseCiclo(pibIni, pibFim) {
  if (pibFim == null) return null;
  if (pibFim < 0) return pibIni != null && pibIni < 0 ? "contração" : "entrando em contração";
  if (pibIni != null && pibIni < 0) return "recuperação";
  if (pibIni != null && pibFim < pibIni) return "desaceleração";
  return "expansão";
}

// ----------------------------------------------------------------------------
// 4. CAMADA DE COLETA (rede) — cada série puxada UMA vez em janelas seguras.
// ----------------------------------------------------------------------------
async function fetchJSON(url, label, opts = {}) {
  for (let tent = 1; tent <= 3; tent++) {
    try {
      const res = await fetch(url);
      if (res.status === 404 && opts.quiet404) return null; // janela sem dado (esperado)
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (tent === 3) { console.warn(`  ⚠ falha ${label}: ${e.message}`); return null; }
      await sleep(400 * tent);
    }
  }
}

// BCB SGS — sem chave. Desde 26/03/2025 o filtro de data é OBRIGATÓRIO.
// Puxa em blocos de 8 anos p/ respeitar o limite de volume.
async function fetchBCB(code, startYear) {
  const out = [];
  const endYear = new Date().getFullYear();
  for (let y = startYear; y <= endYear; y += 8) {
    const di = `01/01/${y}`, df = `31/12/${Math.min(y + 7, endYear)}`;
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${di}&dataFinal=${df}`;
    const data = await fetchJSON(url, `BCB ${code} ${y}`, { quiet404: true });
    if (Array.isArray(data)) {
      for (const r of data) out.push({ ts: parseBRDate(r.data).getTime(), value: num(r.valor) });
    }
    await sleep(150);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// FRED — precisa de chave. units: "lin" (nível) ou "pc1" (% a/a).
async function fetchFRED(id, units = "lin") {
  const key = process.env.FRED_API_KEY;
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}` +
    `&api_key=${key}&file_type=json&observation_start=${SINCE_YEAR}-01-01&units=${units}`;
  const data = await fetchJSON(url, `FRED ${id}`);
  if (!data?.observations) return [];
  return data.observations
    .map((o) => ({ ts: new Date(o.date).getTime(), value: o.value === "." ? null : num(o.value) }))
    .sort((a, b) => a.ts - b.ts);
}

// World Bank — PIB real (% a/a), anual, sem chave. country: BRA | USA.
async function fetchWB(country, indicator) {
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&date=${SINCE_YEAR}:${new Date().getFullYear()}&per_page=200`;
  const data = await fetchJSON(url, `WB ${country}`);
  const rows = Array.isArray(data) ? data[1] : null;
  if (!rows) return [];
  return rows
    .filter((r) => r.value != null)
    .map((r) => ({ ts: new Date(`${r.date}-07-01`).getTime(), value: num(r.value) }))
    .sort((a, b) => a.ts - b.ts);
}

async function buildCache() {
  const cache = {}; // cache[field][pais] = [obs...]
  for (const [field, conf] of Object.entries(SERIES)) {
    cache[field] = {};
    for (const pais of ["BR", "US"]) {
      const s = conf[pais];
      process.stdout.write(`  • ${field} ${pais} (${s.src}:${s.code}) ... `);
      let obs = [];
      if (s.src === "bcb") obs = await fetchBCB(s.code, SINCE_YEAR);
      else if (s.src === "fred") obs = await fetchFRED(s.code, s.units || "lin");
      else if (s.src === "wb") obs = await fetchWB(pais === "BR" ? "BRA" : "USA", s.code);
      cache[field][pais] = obs;
      console.log(`${obs.length} pontos`);
    }
  }
  return cache;
}

// ----------------------------------------------------------------------------
// 5. MONTAGEM DA FICHA POR GESTÃO
// ----------------------------------------------------------------------------
function snap(cache, field, pais, iniISO, fimISO) {
  const obs = cache[field]?.[pais] || [];
  const gap = SERIES[field][pais].src === "wb" ? 550 : 140; // PIB anual aceita janela maior
  return {
    ini: pickNearest(obs, iniISO, gap)?.value ?? null,
    fim: pickNearest(obs, fimISO, gap)?.value ?? null,
  };
}

function montarFicha(m, cache) {
  const fimISO = m.fim ?? todayISO();
  const get = (f) => snap(cache, f, m.pais, m.ini, fimISO);

  const juro = get("juro_basico"), infl = get("inflacao_12m"), pib = get("pib_real_yoy");
  const cam = get("cambio"), bol = get("bolsa"), cred = get("credito_pib"), des = get("desemprego");

  const juroRealIni = juro.ini != null && infl.ini != null ? round(juro.ini - infl.ini) : null;
  const juroRealFim = juro.fim != null && infl.fim != null ? round(juro.fim - infl.fim) : null;

  const camVar = computeVar(cam.ini, cam.fim, "level");
  const credVar = computeVar(cred.ini, cred.fim, "rate");
  const dq = dataQuality(m.pais, m.ini, fimISO);

  const notas = [];
  if (!m.fim) notas.push("mandato em curso (fim = hoje)");
  if (dq !== "comparavel") notas.push(`série ${dq}: números nominais não comparáveis`);
  if (bol.ini == null && bol.fim == null) notas.push("bolsa sem dado (histórico curto/candidato)");

  return {
    id: m.id, pais: m.pais, gestao: m.gestao, n: m.n,
    ini: m.ini, fim: fimISO, data_quality: dq,
    juro_ini: juro.ini, juro_fim: juro.fim, juro_var: computeVar(juro.ini, juro.fim, "rate"),
    infl_ini: infl.ini, infl_fim: infl.fim, infl_var: computeVar(infl.ini, infl.fim, "rate"),
    jr_ini: juroRealIni, jr_fim: juroRealFim,
    pib_ini: pib.ini, pib_fim: pib.fim,
    cam_ini: cam.ini, cam_fim: cam.fim, cam_var: camVar,
    bol_ini: bol.ini, bol_fim: bol.fim, bol_var: computeVar(bol.ini, bol.fim, "level"),
    cred_ini: cred.ini, cred_fim: cred.fim, cred_var: credVar,
    des_ini: des.ini, des_fim: des.fim,
    regime_juro: regimeJuro(juroRealFim, juro.ini, juro.fim),
    regime_inflacao: regimeInflacao(infl.fim, META_INFLACAO[m.pais]),
    regime_credito: regimeCredito(credVar),
    regime_cambial: regimeCambial(m.pais, camVar),
    fase_ciclo: faseCiclo(pib.ini, pib.fim),
    notas: notas.join(" | "),
  };
}

// ----------------------------------------------------------------------------
// 6. ESCRITA DA TABELA ÚNICA (CSV)
// ----------------------------------------------------------------------------
const COLS = [
  "id","pais","gestao","n","ini","fim","data_quality",
  "juro_ini","juro_fim","juro_var","infl_ini","infl_fim","infl_var","jr_ini","jr_fim",
  "pib_ini","pib_fim","cam_ini","cam_fim","cam_var","bol_ini","bol_fim","bol_var",
  "cred_ini","cred_fim","cred_var","des_ini","des_fim",
  "regime_juro","regime_inflacao","regime_credito","regime_cambial","fase_ciclo","notas",
];
function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(fichas) {
  const head = COLS.join(",");
  const body = fichas.map((f) => COLS.map((c) => csvCell(f[c])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

// Divide uma linha CSV respeitando aspas (campo "notas" pode ter vírgula).
function splitCSVLine(line) {
  const out = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const head = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = splitCSVLine(line);
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}
// Mantém as linhas antigas intactas (congeladas); troca só as dos ids atuais.
function mergeRows(existentes, novos, idsAtuais) {
  return existentes.map((r) => (idsAtuais.has(r.id) ? novos[r.id] : r));
}

// ----------------------------------------------------------------------------
// 7. AUTO-CHECAGEM (estilo E2E)
// ----------------------------------------------------------------------------
function resumo(fichas) {
  console.log("\n==================== RESUMO ====================");
  const has = (x) => x !== "" && x != null; // vale p/ ficha (null) e linha do CSV ("")
  let warn = 0;
  for (const f of fichas) {
    const campos = [f.juro_fim, f.infl_fim, f.pib_fim, f.cam_fim, f.cred_fim, f.des_fim];
    const preenchidos = campos.filter(has).length;
    let flag = "ok";
    if (preenchidos === 0) { flag = "✗ TODOS NULL (verificar datas/código)"; warn++; }
    else if (preenchidos <= 2 && f.data_quality === "comparavel") { flag = "⚠ poucos campos"; warn++; }
    console.log(`${f.id.padEnd(20)} ${String(preenchidos).padStart(1)}/6  ${f.data_quality.padEnd(13)} ${flag}`);
  }
  // confirma os 3 códigos candidatos
  const temBolsaBR = fichas.some((f) => f.pais === "BR" && has(f.bol_fim));
  const temDesBR   = fichas.some((f) => f.pais === "BR" && has(f.des_fim));
  const temCredUS  = fichas.some((f) => f.pais === "US" && has(f.cred_fim));
  console.log("\n-- candidatos a confirmar --");
  console.log(`  bolsa BR (SGS 7):      ${temBolsaBR ? "✓ retornou dado" : "✗ vazio — trocar fonte"}`);
  console.log(`  desemprego BR (24369): ${temDesBR ? "✓ retornou dado" : "✗ vazio — confirmar código"}`);
  console.log(`  crédito/PIB US (FRED): ${temCredUS ? "✓ retornou dado" : "✗ vazio — confirmar código BIS"}`);
  console.log(`\n${fichas.length} gestões processadas, ${warn} avisos.`);
  console.log("===============================================");
}

// ----------------------------------------------------------------------------
// 8. SELF-TEST (offline) — valida só a lógica pura, sem internet
// ----------------------------------------------------------------------------
function selftest() {
  console.log(`NEXO coletor ${VERSION}`);
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log(`  ✗ ${msg}`); } };

  // pickNearest
  const obs = [
    { ts: new Date("2020-01-01").getTime(), value: 10 },
    { ts: new Date("2020-06-01").getTime(), value: 20 },
    { ts: new Date("2021-01-01").getTime(), value: 30 },
  ];
  ok(pickNearest(obs, "2020-06-15").value === 20, "pickNearest pega última <= alvo");
  ok(pickNearest(obs, "2019-06-01") === null, "alvo fora da cobertura (gap grande) -> null");
  ok(pickNearest(obs, "2019-11-15", 140)?.value === 10, "alvo dentro da tolerância -> pega ponto");
  ok(pickNearest([], "2020-01-01") === null, "pickNearest vazio -> null");

  // computeVar
  ok(computeVar(100, 150, "level") === 50, "var nível = +50%");
  ok(computeVar(10, 13, "rate") === 3, "var rate = +3 p.p.");
  ok(computeVar(null, 10, "level") === null, "var com null -> null");

  // dataQuality
  ok(dataQuality("BR", "1985-03-15", "1990-03-15") === "hiperinflacao", "Sarney = hiperinflacao");
  ok(dataQuality("BR", "1992-12-29", "1995-01-01") === "transicao", "Itamar atravessa o Real");
  ok(dataQuality("BR", "1995-01-01", "1999-01-01") === "comparavel", "FHC1 = comparavel");
  ok(dataQuality("US", "1981-01-20", "1985-01-20") === "comparavel", "EUA sempre comparavel");

  // regimes
  ok(regimeJuro(6, 10, 13) === "alto/subindo", "juro real alto + subindo");
  ok(regimeJuro(0.5, 12, 8) === "baixo/caindo", "juro real baixo + caindo");
  ok(regimeInflacao(3.5, 3.0) === "ancorada", "infl 3.5 c/ meta 3 = ancorada");
  ok(regimeInflacao(12, 3.0) === "desancorada", "infl 12 = desancorada");
  ok(regimeInflacao(-1, 2.0) === "deflação", "infl negativa = deflação");
  ok(regimeCredito(3) === "expansão", "crédito subindo = expansão");
  ok(regimeCredito(null) === null, "crédito null -> null");
  ok(regimeCambial("BR", 40) === "BRL depreciou", "USD/BRL +40% = BRL depreciou");
  ok(regimeCambial("US", -8) === "dólar enfraqueceu", "índice dólar -8% = enfraqueceu");
  ok(faseCiclo(2, -3) === "entrando em contração", "PIB vira negativo");
  ok(faseCiclo(-2, 1.5) === "recuperação", "PIB negativo->positivo = recuperação");

  // CSV
  ok(csvCell("a,b") === '"a,b"', "CSV escapa vírgula");
  ok(csvCell(null) === "", "CSV null -> vazio");
  ok(splitCSVLine('a,"b,c",d')[1] === "b,c", "CSV split respeita aspas");
  ok(parseCSV("id,x\n1,foo\n2,bar")[1].x === "bar", "parseCSV lê linha");

  // merge do refresh: congela antigas, troca só as atuais
  const ex = [{ id: "A", v: "1" }, { id: "B", v: "2" }];
  const merged = mergeRows(ex, { B: { id: "B", v: "99" } }, new Set(["B"]));
  ok(merged[0].v === "1", "refresh mantém linha congelada");
  ok(merged[1].v === "99", "refresh troca só o mandato atual");

  console.log(`\n=== SELF-TEST: ${pass} passou, ${fail} falhou ===`);
  process.exit(fail === 0 ? 0 : 1);
}

// ----------------------------------------------------------------------------
// 9. MAIN
// ----------------------------------------------------------------------------
async function main() {
  if (SELFTEST) return selftest();
  console.log(`NEXO coletor ${VERSION}${REFRESH ? " — modo REFRESH (só mandato atual)" : ""}`);

  if (!process.env.FRED_API_KEY) {
    console.error("✗ Defina FRED_API_KEY antes de rodar (export FRED_API_KEY=...).");
    process.exit(1);
  }
  console.log("Coletando séries (BCB + FRED + World Bank)...");
  const cache = await buildCache();

  if (REFRESH) {
    let existentes;
    try { existentes = parseCSV(readFileSync("nexo_macro.csv", "utf8")); }
    catch { console.error("✗ nexo_macro.csv não existe. Rode o full primeiro (sem --refresh)."); process.exit(1); }
    const atuais = MANDATOS.filter((m) => m.fim === null);
    const idsAtuais = new Set(atuais.map((m) => m.id));
    const novos = Object.fromEntries(atuais.map((m) => [m.id, montarFicha(m, cache)]));
    const merged = mergeRows(existentes, novos, idsAtuais);
    writeFileSync("nexo_macro.csv", toCSV(merged));
    console.log(`\n✓ Refresh: ${atuais.length} mandato(s) atual(is) atualizado(s); ${existentes.length - atuais.length} linha(s) congelada(s).`);
  } else {
    const fichas = MANDATOS.map((m) => montarFicha(m, cache));
    writeFileSync("nexo_macro.csv", toCSV(fichas));
    console.log(`\n✓ Tabela gravada: nexo_macro.csv (${fichas.length} linhas)`);
  }
  // resumo sempre relendo o arquivo final (uniformiza linha nova e congelada)
  resumo(parseCSV(readFileSync("nexo_macro.csv", "utf8")));
}

main().catch((e) => { console.error("Erro fatal:", e); process.exit(1); });
