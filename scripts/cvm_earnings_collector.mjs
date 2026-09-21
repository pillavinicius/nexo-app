#!/usr/bin/env node
/**
 * cvm_earnings_collector.mjs — Allocation Hurdle v3.0.1, coletor do caminho critico
 *
 * Extrai dos dados abertos da CVM (ITR/DFP), por empresa e por formulario:
 *   - lucro liquido atribuivel aos CONTROLADORES (subconta .01), YTD e TTM
 *   - acoes em circulacao por classe (ON/PN) = capital integralizado - tesouraria
 *
 * Decisoes declaradas (todas derivadas do probe de 21/09/2026):
 *   - CVM SOBRESCREVE valores reapresentados; o indice preserva DT_RECEB de cada versao.
 *     => available_at = DT_RECEB da versao cujos valores estao no CSV (conservador:
 *        atraso possivel, antecipacao impossivel).
 *   - Tabela VERSIONADA: chave = cnpj|dt_refer|doc|versao. Versao nova vira linha nova.
 *     Mesma chave com valor diferente = revisao silenciosa -> revisions.csv, 1a versao vence.
 *   - Consolidado quando existe; individual para cias sem subsidiarias (sem penalidade).
 *   - Conta de lucro por DESCRICAO (codigo varia: 3.11 na maioria, 3.09 no Itau).
 *   - Periodos validos: 3, 6, 9, 12 meses. Demais descartados e contados.
 *   - TTM = YTD atual + (anual anterior - YTD anterior de mesmo prazo), casando o
 *     anual pelo inicio do exercicio (funciona para exercicio nao-calendario).
 *     available_at do TTM = max(ITR, DFP usada).
 *   - Escala normalizada para UNIDADE (MIL x1000). Moeda registrada; nao-REAL e sinalizada.
 *   - Acoes: composicao do capital, disponivel desde 2020.
 *
 * Regra de consumo pela engine: para a data t, por (cnpj, dt_refer), usar a linha de
 * MAIOR versao com available_at <= t.
 *
 * Uso:
 *   node cvm_earnings_collector.mjs                         # ITR 2011..ano atual, DFP 2010..ano atual
 *   node cvm_earnings_collector.mjs --itr=2024 --dfp=2023   # anos especificos
 *   node cvm_earnings_collector.mjs --local=./zips          # zips locais (teste)
 *   node cvm_earnings_collector.mjs --refresh-years=2       # janela do modo incremental (padrao 2)
 *   node cvm_earnings_collector.mjs --keep-zips             # guarda os zips no cache (padrao: apaga)
 *
 * Modos: sem data/cvm/earnings_quarterly.csv -> BACKFILL (ITR 2011.., DFP 2010..).
 *        com o arquivo -> INCREMENTAL (so os anos da janela; o historico ja esta versionado).
 * Disco: extrai so 4 dos 19 arquivos de cada zip e apaga extraidos e zip ao fim de cada ano.
 *   NEXO_SELFTEST=1 node cvm_earnings_collector.mjs         # testes internos
 *
 * Saida: data/cvm/{earnings_quarterly.csv, shares_outstanding.csv, revisions.csv, collector_meta.json}
 * Cache de zips: ~/nexo_cvm_cache (fora do repo)
 * Zero dependencia npm. Usa `unzip` do sistema.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC';

// ================= funcoes puras (testadas no selftest) =================
const strip = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/** Linha-mae de lucro liquido do periodo (consolidado ou individual). */
export function isParentNI(cd, ds) {
  if (!/^3\.\d{2}$/.test(String(cd || '').trim())) return false;
  const d = strip(ds).toLowerCase().replace(/\s+/g, ' ');
  if (/operac/.test(d)) return false;                        // continuadas/descontinuadas
  return /^lucro ?(\/|ou) ?prejuizo( liquido)?( consolidado)? do periodo$/.test(d);
}

/** Subconta de controladores da linha-mae. Rejeita "nao controladores". */
export function isControllerChild(parentCd, cd, ds) {
  if (!String(cd || '').startsWith(String(parentCd) + '.')) return false;
  const d = strip(ds).toLowerCase();
  return /empresa controladora/.test(d) && !/\bnao\b/.test(d);
}

export function scaleFactor(esc) {
  const e = strip(esc).toUpperCase();
  if (e === 'MIL') return 1000;
  if (e === 'UNIDADE') return 1;
  return null;                                              // escala desconhecida -> descarta
}

export function parseVal(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  let x = t;
  if (x.includes(',') && x.includes('.')) x = x.replace(/\./g, '').replace(',', '.');
  else if (x.includes(',')) x = x.replace(',', '.');
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

/** Meses do periodo; null se nao for 3/6/9/12 com tolerancia de 5 dias. */
export function periodMonths(ini, fim) {
  const d = (new Date(fim) - new Date(ini)) / 86400000 + 1;
  if (!Number.isFinite(d)) return null;
  const m = Math.round(d / 30.4375);
  if (![3, 6, 9, 12].includes(m)) return null;
  return Math.abs(d - m * 30.4375) <= 5 ? m : null;
}

export const ordem = o => {
  const s = strip(o).toUpperCase();
  return s === 'ULTIMO' ? 'U' : s === 'PENULTIMO' ? 'P' : null;
};

/**
 * Resolve o lucro de UM formulario+demonstrativo a partir das linhas candidatas.
 * rows: [{cd, ds, ord, ini, fim, val, fator, moeda}]
 * Retorna lista de periodos: [{ord, ini, fim, months, value, src, moeda}]
 */
export function resolveNI(rows) {
  const out = [];
  const parents = rows.filter(r => isParentNI(r.cd, r.ds));
  for (const p of parents) {
    const months = periodMonths(p.ini, p.fim);
    if (!months || !p.ord) continue;
    const child = rows.find(r => r.ord === p.ord && r.ini === p.ini && r.fim === p.fim &&
      isControllerChild(p.cd, r.cd, r.ds));
    const base = child || p;
    if (base.val == null || base.fator == null) continue;
    out.push({ ord: p.ord, ini: p.ini, fim: p.fim, months,
      value: base.val * base.fator, src: child ? 'controladora' : 'total', moeda: base.moeda });
  }
  return out;
}

/**
 * TTM de um formulario.
 * filing: {doc, periods, available_at}; annuals: DFPs da mesma cia [{ini, value, available_at}]
 */
export function computeTTM(filing, annuals) {
  const U = filing.periods.filter(p => p.ord === 'U');
  if (!U.length) return { status: 'sem_periodo_atual' };
  const ytd = U.reduce((a, b) => (b.months > a.months ? b : a));
  if (filing.doc === 'DFP' || ytd.months === 12) {
    if (ytd.months !== 12) return { status: 'dfp_sem_12m' };
    return { status: 'ok', ttm: ytd.value, ytd, fy_start: ytd.ini, available_at: filing.available_at };
  }
  // YTD anterior = PENULTIMO de mesmo prazo (isola o acumulado, nao o trimestre)
  const prior = filing.periods.find(p => p.ord === 'P' && p.months === ytd.months);
  if (!prior) return { status: 'sem_ytd_anterior', ytd };
  const annual = annuals.find(a => a.ini === prior.ini);
  if (!annual) return { status: 'sem_anual_anterior', ytd };
  const avail = [filing.available_at, annual.available_at].filter(Boolean).sort().at(-1);
  return { status: 'ok', ttm: ytd.value + (annual.value - prior.value), ytd, prior,
    fy_start: ytd.ini, available_at: avail };
}

export function sharesOutstanding(r) {
  const n = k => { const v = parseVal(r[k]); return v == null ? 0 : v; };
  const on = n('QT_ACAO_ORDIN_CAP_INTEGR') - n('QT_ACAO_ORDIN_TESOURO');
  const pn = n('QT_ACAO_PREF_CAP_INTEGR') - n('QT_ACAO_PREF_TESOURO');
  return { on_out: on, pn_out: pn, total_out: on + pn };
}

/** Merge versionado: chave nova entra; mesma chave com valor diferente = revisao silenciosa. */
export function mergeVersioned(existing, incoming, keyFn, fields, { isBackfill, nowIso }) {
  const map = new Map(existing.map(r => [keyFn(r), r]));
  const revisions = []; let added = 0;
  const norm = v => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : String(v));
  for (const r of incoming) {
    const k = keyFn(r); const prev = map.get(k);
    if (!prev) { map.set(k, { ...r, pit: isBackfill ? 'backfill' : 'live', first_seen_at: nowIso }); added++; continue; }
    const diff = fields.filter(f => norm(prev[f]) !== norm(r[f]));
    if (diff.length) revisions.push({ detected_at: nowIso, key: k,
      mudancas: diff.map(f => `${f}:${prev[f]}->${r[f]}`).join(' | '), pit_original: prev.pit });
  }
  return { merged: [...map.values()], added, revisions };
}

// ================= IO =================
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('muitos redirects'));
    https.get(url, { headers: { 'User-Agent': 'nexo-collector/1.0' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); return resolve(download(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const f = fs.createWriteStream(dest); res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest))); f.on('error', reject);
    }).on('error', reject);
  });
}
function isZip(file) {
  const b = Buffer.alloc(4); const fd = fs.openSync(file, 'r');
  fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
  return b.toString('hex') === '504b0304';
}
function splitCsv(line, delim = ';') {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
async function* rows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'latin1' }), crlfDelay: Infinity });
  let h = null;
  for await (const raw of rl) {
    const line = raw.replace(/^\uFEFF/, ''); if (!line.trim()) continue;
    const c = splitCsv(line);
    if (!h) { h = c; continue; }
    const o = {}; h.forEach((k, i) => { o[k] = c[i]; }); yield o;
  }
}
function readOutCsv(file) {
  if (!fs.existsSync(file)) return [];
  const [h, ...ls] = fs.readFileSync(file, 'utf8').trim().split('\n');
  if (!h) return [];
  const cols = splitCsv(h, ',');
  return ls.map(l => { const v = splitCsv(l, ','); const o = {}; cols.forEach((c, i) => { o[c] = v[i] ?? ''; }); return o; });
}
function writeOutCsv(file, data, cols) {
  const esc = v => { const s = v == null ? '' : String(v); return /[,\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, [cols.join(',')].concat(data.map(r => cols.map(c => esc(r[c])).join(','))).join('\n') + '\n');
  fs.renameSync(tmp, file);
}

async function getZip(kind, year, { cache, local, refresh }) {
  const name = `${kind.toLowerCase()}_cia_aberta_${year}.zip`;
  const dir = local || cache; fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  if (fs.existsSync(dest) && !refresh && isZip(dest)) return dest;
  if (local) throw new Error(`zip local ausente: ${dest}`);
  await download(`${BASE}/${kind}/DADOS/${name}`, dest);
  if (!isZip(dest)) { fs.unlinkSync(dest); throw new Error(`${name} nao e zip valido`); }
  return dest;
}

// ================= processamento de um ano =================
async function processYear(kind, year, opts) {
  const zip = await getZip(kind, year, opts);
  const dir = path.join(opts.cache, 'csv', `${kind.toLowerCase()}_${year}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const k = kind.toLowerCase();
  // So os 4 arquivos usados. Os outros 15 (BPA, BPP, DFC, DMPL, DVA, parecer...) somam GBs.
  const wanted = [`${k}_cia_aberta_${year}.csv`, '*DRE_con*', '*DRE_ind*', '*composicao_capital*'];
  try {
    try { execFileSync('unzip', ['-o', '-q', zip, ...wanted, '-d', dir], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) { if (e.status !== 11) throw e; }        // 11 = algum padrao sem arquivo (ex.: capital antes de 2020)
    return await extractYear(kind, year, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });  // limpa mesmo se unzip ou parse falharem
    if (!opts.local && !opts.keepZip) fs.rmSync(zip, { force: true });
  }
}

async function extractYear(kind, year, dir) {
  const files = fs.readdirSync(dir);
  const f = re => { const x = files.find(n => re.test(n)); return x ? path.join(dir, x) : null; };
  const k = kind.toLowerCase();

  // 1. indice: DT_RECEB por versao e data original
  const receb = new Map(), original = new Map();
  const idx = f(new RegExp(`^${k}_cia_aberta_${year}\\.csv$`, 'i'));
  if (idx) for await (const r of rows(idx)) {
    receb.set(`${r.CNPJ_CIA}|${r.DT_REFER}|${r.VERSAO}`, r.DT_RECEB);
    const ok = `${r.CNPJ_CIA}|${r.DT_REFER}`;
    if (r.DT_RECEB && (!original.has(ok) || r.DT_RECEB < original.get(ok))) original.set(ok, r.DT_RECEB);
  }

  // 2. DRE: guarda so linhas-mae de lucro e subcontas de controladora
  const cand = new Map(); const meta = new Map();
  for (const stmt of ['con', 'ind']) {
    const file = f(new RegExp(`DRE_${stmt}_${year}`, 'i')); if (!file) continue;
    for await (const r of rows(file)) {
      const cd = (r.CD_CONTA || '').trim();
      const keep = isParentNI(cd, r.DS_CONTA) ||
        (/^3\.\d{2}\.\d{2}$/.test(cd) && /controladora/i.test(strip(r.DS_CONTA)));
      if (!keep) continue;
      const key = `${r.CNPJ_CIA}|${r.DT_REFER}|${r.VERSAO}`;
      if (!cand.has(key)) cand.set(key, { con: [], ind: [] });
      cand.get(key)[stmt].push({ cd, ds: r.DS_CONTA, ord: ordem(r.ORDEM_EXERC), ini: r.DT_INI_EXERC,
        fim: r.DT_FIM_EXERC, val: parseVal(r.VL_CONTA), fator: scaleFactor(r.ESCALA_MOEDA), moeda: strip(r.MOEDA) });
      meta.set(key, { cd_cvm: r.CD_CVM, denom: r.DENOM_CIA });
    }
  }
  const filings = [];
  let invalid = 0;
  for (const [key, st] of cand) {
    const [cnpj, dt_refer, versao] = key.split('|');
    let stmt = 'con', periods = resolveNI(st.con);
    if (!periods.length) { stmt = 'ind'; periods = resolveNI(st.ind); }
    if (!periods.length) { invalid++; continue; }
    filings.push({ doc: kind, cnpj, dt_refer, versao: Number(versao), stmt, periods,
      moeda: periods[0].moeda, ...meta.get(key),
      available_at: receb.get(key) || null, original_receb: original.get(`${cnpj}|${dt_refer}`) || null });
  }

  // 3. acoes
  const shares = [];
  const cap = f(/composicao_capital/i);
  if (cap) for await (const r of rows(cap)) {
    shares.push({ cnpj: r.CNPJ_CIA, dt_refer: r.DT_REFER, versao: Number(r.VERSAO), doc: kind,
      denom: (r.DENOM_CIA || '').replace(/,/g, ' '), ...sharesOutstanding(r),
      available_at: receb.get(`${r.CNPJ_CIA}|${r.DT_REFER}|${r.VERSAO}`) || null });
  }
  return { filings, shares, invalid };
}

// ================= main =================
const EARN_COLS = ['cnpj', 'cd_cvm', 'denom', 'doc', 'dt_refer', 'versao', 'available_at', 'original_receb',
  'restated', 'stmt', 'ni_source', 'moeda', 'ytd_months', 'ni_ytd', 'fy_start', 'ni_ttm', 'ttm_status',
  'pit', 'first_seen_at'];
const SHARE_COLS = ['cnpj', 'denom', 'doc', 'dt_refer', 'versao', 'available_at', 'on_out', 'pn_out',
  'total_out', 'pit', 'first_seen_at'];
const REV_COLS = ['detected_at', 'tabela', 'key', 'mudancas', 'pit_original'];

async function main() {
  const argv = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
  }));
  const Y = new Date().getFullYear();
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  const refreshN = Number(argv['refresh-years'] ?? 2);
  const outDir = path.resolve(argv.out || 'data/cvm'); fs.mkdirSync(outDir, { recursive: true });
  const hasOutput = fs.existsSync(path.join(outDir, 'earnings_quarterly.csv'));
  // Backfill: tudo. Incremental: so a janela de reapresentacao. A DFP vai 1 ano alem
  // porque o TTM do ITR do ano X precisa do anual de X-1.
  const itrYears = argv.itr ? String(argv.itr).split(',') : hasOutput ? range(Y - refreshN + 1, Y) : range(2011, Y);
  const dfpYears = argv.dfp ? String(argv.dfp).split(',') : hasOutput ? range(Y - refreshN, Y) : range(2010, Y);
  const cache = path.join(process.env.HOME || '.', 'nexo_cvm_cache');
  const local = argv.local ? path.resolve(argv.local) : null;
  const nowIso = new Date().toISOString();

  console.log(`CVM earnings collector | ITR ${itrYears[0]}..${itrYears.at(-1)} | DFP ${dfpYears[0]}..${dfpYears.at(-1)}`);
  const all = { filings: [], shares: [] }; const avisos = []; let invalid = 0;
  for (const [kind, years] of [['DFP', dfpYears], ['ITR', itrYears]]) {
    for (const y of years) {
      const refresh = !local && Number(y) > Y - refreshN;
      try {
        process.stdout.write(`   ${kind} ${y}${refresh ? ' (atualizando)' : ''}... `);
        const r = await processYear(kind, y, { cache, local, refresh, keepZip: Boolean(argv['keep-zips']) });
        all.filings.push(...r.filings); all.shares.push(...r.shares); invalid += r.invalid;
        console.log(`${r.filings.length} formularios, ${r.shares.length} registros de acoes`);
      } catch (e) { console.log(`PULADO (${e.message})`); avisos.push(`${kind} ${y}: ${e.message}`); }
    }
  }

  // DFPs anuais por cia, para o TTM
  const annuals = new Map();
  for (const fl of all.filings.filter(x => x.doc === 'DFP')) {
    for (const p of fl.periods.filter(p => p.ord === 'U' && p.months === 12)) {
      if (!annuals.has(fl.cnpj)) annuals.set(fl.cnpj, []);
      annuals.get(fl.cnpj).push({ ini: p.ini, value: p.value, available_at: fl.available_at, versao: fl.versao });
    }
  }
  for (const list of annuals.values()) list.sort((a, b) => b.versao - a.versao);

  const statusCount = {}; const moedaCount = {};
  const incomingE = all.filings.map(fl => {
    const t = computeTTM(fl, annuals.get(fl.cnpj) || []);
    statusCount[t.status] = (statusCount[t.status] || 0) + 1;
    moedaCount[fl.moeda] = (moedaCount[fl.moeda] || 0) + 1;
    return { cnpj: fl.cnpj, cd_cvm: fl.cd_cvm, denom: (fl.denom || '').replace(/,/g, ' '), doc: fl.doc,
      dt_refer: fl.dt_refer, versao: fl.versao, available_at: t.available_at || fl.available_at,
      original_receb: fl.original_receb, restated: fl.versao > 1, stmt: fl.stmt,
      ni_source: t.ytd?.src ?? '', moeda: fl.moeda, ytd_months: t.ytd?.months ?? '',
      ni_ytd: t.ytd?.value ?? '', fy_start: t.fy_start ?? '', ni_ttm: t.ttm ?? '', ttm_status: t.status };
  });

  const earnFile = path.join(outDir, 'earnings_quarterly.csv');
  const shareFile = path.join(outDir, 'shares_outstanding.csv');
  const revFile = path.join(outDir, 'revisions.csv');
  const exE = readOutCsv(earnFile), exS = readOutCsv(shareFile);
  const kE = r => `${r.cnpj}|${r.dt_refer}|${r.doc}|${r.versao}`;
  const mE = mergeVersioned(exE, incomingE, kE, ['ni_ytd', 'ni_ttm'], { isBackfill: exE.length === 0, nowIso });
  const mS = mergeVersioned(exS, all.shares, kE, ['on_out', 'pn_out'], { isBackfill: exS.length === 0, nowIso });

  const sortK = (a, b) => (a.cnpj + a.dt_refer + a.doc + String(a.versao).padStart(3, '0'))
    .localeCompare(b.cnpj + b.dt_refer + b.doc + String(b.versao).padStart(3, '0'));
  writeOutCsv(earnFile, mE.merged.sort(sortK), EARN_COLS);
  writeOutCsv(shareFile, mS.merged.sort(sortK), SHARE_COLS);

  const prevRev = readOutCsv(revFile);
  const known = new Set(prevRev.map(r => r.key + r.mudancas));
  const newRev = [...mE.revisions.map(r => ({ ...r, tabela: 'earnings' })),
                  ...mS.revisions.map(r => ({ ...r, tabela: 'shares' }))].filter(r => !known.has(r.key + r.mudancas));
  if (newRev.length) writeOutCsv(revFile, prevRev.concat(newRev), REV_COLS);

  const restated = incomingE.filter(r => r.restated).length;
  const meta = {
    collected_at: nowIso, mode: exE.length === 0 ? 'backfill' : 'incremental',
    itr_years: itrYears, dfp_years: dfpYears, refresh_years: refreshN,
    formularios: incomingE.length, sem_lucro_resolvido: invalid,
    ttm_status: statusCount, moeda: moedaCount,
    reapresentados_pct: incomingE.length ? Math.round(restated / incomingE.length * 1000) / 10 : 0,
    earnings_rows: mE.merged.length, earnings_added: mE.added,
    shares_rows: mS.merged.length, shares_added: mS.added, revisoes_novas: newRev.length, avisos,
  };
  fs.writeFileSync(path.join(outDir, 'collector_meta.json'), JSON.stringify(meta, null, 2));

  console.log(`\n   modo: ${meta.mode} | formularios: ${meta.formularios} | sem lucro resolvido: ${invalid}`);
  console.log(`   TTM: ${JSON.stringify(statusCount)}`);
  console.log(`   moeda: ${JSON.stringify(moedaCount)}`);
  console.log(`   reapresentados: ${meta.reapresentados_pct}% | linhas lucro: ${mE.merged.length} (+${mE.added}) | acoes: ${mS.merged.length} (+${mS.added}) | revisoes novas: ${newRev.length}`);
  if (avisos.length) console.log(`   avisos: ${avisos.length} ano(s) pulado(s) — ver collector_meta.json`);

  console.log('\n   SANIDADE — ultimo TTM dos controladores (R$ bi):');
  for (const [tag, re] of [['PETROBRAS', /PETROBRAS/], ['VALE', /^VALE S/], ['ITAU', /ITAU UNIBANCO HOLDING/],
                           ['BRADESCO', /BCO BRADESCO/], ['BB', /BCO BRASIL S/]]) {
    const r = mE.merged.filter(x => re.test(x.denom) && x.ttm_status === 'ok' && x.ni_ttm !== '')
      .sort((a, b) => (a.dt_refer + a.versao).localeCompare(b.dt_refer + b.versao)).at(-1);
    console.log(`     ${tag.padEnd(10)} ${r ? `${r.dt_refer} ${r.doc} v${r.versao}: ${(Number(r.ni_ttm) / 1e9).toFixed(2)} (${r.ni_source}, ${r.moeda})` : 'nao encontrado'}`);
  }
}

// ================= selftest =================
function selftest() {
  let pass = 0, fail = 0;
  const t = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); };

  t('mae consolidada 3.11',        isParentNI('3.11', 'Lucro/Prejuízo Consolidado do Período'));
  t('mae banco 3.11 "ou liquido"', isParentNI('3.11', 'Lucro ou Prejuízo Líquido Consolidado do Período'));
  t('mae Itau 3.09',               isParentNI('3.09', 'Lucro/Prejuízo Consolidado do Período'));
  t('mae individual',              isParentNI('3.11', 'Lucro/Prejuízo do Período'));
  t('rejeita continuadas',         !isParentNI('3.09', 'Resultado Líquido das Operações Continuadas'));
  t('rejeita descontinuadas',      !isParentNI('3.10', 'Resultado Líquido de Operações Descontinuadas'));
  t('rejeita subnivel',            !isParentNI('3.10.01', 'Lucro/Prejuízo Líquido das Operações Descontinuadas'));
  t('controladora .01',            isControllerChild('3.11', '3.11.01', 'Atribuído a Sócios da Empresa Controladora'));
  t('controladora "aos"',          isControllerChild('3.11', '3.11.01', 'Atribuído aos Sócios da Empresa Controladora'));
  t('rejeita nao controladores',   !isControllerChild('3.11', '3.11.02', 'Atribuído a Sócios Não Controladores'));
  t('rejeita outra mae',           !isControllerChild('3.11', '3.09.01', 'Atribuído a Sócios da Empresa Controladora'));
  t('escala MIL',                  scaleFactor('MIL') === 1000);
  t('escala UNIDADE',              scaleFactor('UNIDADE') === 1);
  t('escala desconhecida -> null', scaleFactor('MILHAO') === null);
  t('valor ponto decimal',         parseVal('1234.5000000000') === 1234.5);
  t('valor virgula decimal',       parseVal('1234,5') === 1234.5);
  t('valor negativo',              parseVal('-98.2') === -98.2);
  t('periodo 3m',                  periodMonths('2024-01-01', '2024-03-31') === 3);
  t('periodo 6m',                  periodMonths('2024-01-01', '2024-06-30') === 6);
  t('periodo 9m',                  periodMonths('2024-01-01', '2024-09-30') === 9);
  t('periodo 12m',                 periodMonths('2023-01-01', '2023-12-31') === 12);
  t('rejeita 1 mes',               periodMonths('2022-12-01', '2022-12-31') === null);
  t('ordem ULTIMO com acento',     ordem('ÚLTIMO') === 'U' && ordem('PENÚLTIMO') === 'P');

  // resolveNI: controladora preferida, escala aplicada
  const rows = [
    { cd: '3.11', ds: 'Lucro/Prejuízo Consolidado do Período', ord: 'U', ini: '2024-01-01', fim: '2024-06-30', val: 1000, fator: 1000, moeda: 'REAL' },
    { cd: '3.11.01', ds: 'Atribuído a Sócios da Empresa Controladora', ord: 'U', ini: '2024-01-01', fim: '2024-06-30', val: 900, fator: 1000, moeda: 'REAL' },
    { cd: '3.11.02', ds: 'Atribuído a Sócios Não Controladores', ord: 'U', ini: '2024-01-01', fim: '2024-06-30', val: 100, fator: 1000, moeda: 'REAL' },
  ];
  const r = resolveNI(rows);
  t('usa controladora, nao total', r.length === 1 && r[0].value === 900000 && r[0].src === 'controladora');
  const semFilho = resolveNI([rows[0]]);
  t('sem subconta usa total',      semFilho[0].src === 'total' && semFilho[0].value === 1000000);

  // TTM calendario: YTD 6m 2024 + anual 2023 - YTD 6m 2023
  const itr = { doc: 'ITR', available_at: '2024-08-10', periods: [
    { ord: 'U', ini: '2024-01-01', fim: '2024-06-30', months: 6, value: 60, src: 'controladora' },
    { ord: 'U', ini: '2024-04-01', fim: '2024-06-30', months: 3, value: 35, src: 'controladora' },
    { ord: 'P', ini: '2023-01-01', fim: '2023-06-30', months: 6, value: 50, src: 'controladora' },
    { ord: 'P', ini: '2023-04-01', fim: '2023-06-30', months: 3, value: 28, src: 'controladora' },
  ] };
  const ann = [{ ini: '2023-01-01', value: 110, available_at: '2024-03-20' }];
  const T1 = computeTTM(itr, ann);
  t('TTM = 60 + (110 - 50) = 120', T1.status === 'ok' && T1.ttm === 120);
  t('TTM usa YTD, nao trimestre',  T1.ytd.months === 6);
  t('available_at = max',          T1.available_at === '2024-08-10');
  const annTardio = [{ ini: '2023-01-01', value: 110, available_at: '2024-09-01' }];
  t('DFP reapresentada depois atrasa o TTM', computeTTM(itr, annTardio).available_at === '2024-09-01');
  t('sem anual anterior -> status', computeTTM(itr, []).status === 'sem_anual_anterior');

  // exercicio nao-calendario (abr-mar)
  const itrNC = { doc: 'ITR', available_at: '2024-11-10', periods: [
    { ord: 'U', ini: '2024-04-01', fim: '2024-09-30', months: 6, value: 40, src: 'total' },
    { ord: 'P', ini: '2023-04-01', fim: '2023-09-30', months: 6, value: 30, src: 'total' },
  ] };
  const TNC = computeTTM(itrNC, [{ ini: '2023-04-01', value: 70, available_at: '2024-06-15' }]);
  t('exercicio abr-mar: 40 + (70 - 30) = 80', TNC.status === 'ok' && TNC.ttm === 80);

  const dfp = { doc: 'DFP', available_at: '2024-03-20', periods: [
    { ord: 'U', ini: '2023-01-01', fim: '2023-12-31', months: 12, value: 110, src: 'controladora' }] };
  t('DFP: TTM = anual',            computeTTM(dfp, []).ttm === 110);

  // acoes por classe
  const s = sharesOutstanding({ QT_ACAO_ORDIN_CAP_INTEGR: '7442454142', QT_ACAO_PREF_CAP_INTEGR: '5602042788',
    QT_ACAO_ORDIN_TESOURO: '0', QT_ACAO_PREF_TESOURO: '281000000' });
  t('ON e PN separados',           s.on_out === 7442454142 && s.pn_out === 5321042788);
  t('total = ON + PN em circulacao', s.total_out === 12763496930);

  // merge versionado
  const kf = x => `${x.cnpj}|${x.dt_refer}|${x.doc}|${x.versao}`;
  const v1 = [{ cnpj: 'A', dt_refer: '2024-03-31', doc: 'ITR', versao: 1, ni_ttm: 100, ni_ytd: 25 }];
  const m1 = mergeVersioned([], v1, kf, ['ni_ttm', 'ni_ytd'], { isBackfill: true, nowIso: 'T1' });
  t('backfill marcado',            m1.merged[0].pit === 'backfill');
  const v2 = [...v1, { ...v1[0], versao: 2, ni_ttm: 96 }];
  const m2 = mergeVersioned(m1.merged, v2, kf, ['ni_ttm', 'ni_ytd'], { isBackfill: false, nowIso: 'T2' });
  t('versao nova = linha nova',    m2.added === 1 && m2.merged.length === 2);
  t('versao 1 preservada',         m2.merged.find(x => x.versao === 1).ni_ttm === 100);
  t('versao 2 marcada live',       m2.merged.find(x => x.versao === 2).pit === 'live');
  const silent = [{ ...v1[0], ni_ttm: 99 }];
  const m3 = mergeVersioned(m2.merged, silent, kf, ['ni_ttm', 'ni_ytd'], { isBackfill: false, nowIso: 'T3' });
  t('revisao silenciosa detectada', m3.revisions.length === 1 && m3.merged.find(x => x.versao === 1).ni_ttm === 100);
  const m4 = mergeVersioned(m2.merged, v2, kf, ['ni_ttm', 'ni_ytd'], { isBackfill: false, nowIso: 'T4' });
  t('idempotente',                 m4.added === 0 && m4.revisions.length === 0);

  // releitura de CSV com nome entre aspas contendo virgulas
  const tmp = path.join(process.env.TMPDIR || '/tmp', `nexo_cvm_selftest_${process.pid}.csv`);
  writeOutCsv(tmp, [{ cnpj: 'X', denom: 'B3 S.A. - BRASIL, BOLSA, BALCAO', dt_refer: '2024-06-30' }], ['cnpj', 'denom', 'dt_refer']);
  const back = readOutCsv(tmp); fs.rmSync(tmp, { force: true });
  t('releitura respeita aspas',    back[0].denom === 'B3 S.A. - BRASIL, BOLSA, BALCAO' && back[0].dt_refer === '2024-06-30');

  console.log(`\nselftest: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  if (process.env.NEXO_SELFTEST) selftest();
  else main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
}
