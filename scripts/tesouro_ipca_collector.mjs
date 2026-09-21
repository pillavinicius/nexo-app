#!/usr/bin/env node
/**
 * tesouro_ipca_collector.mjs — Allocation Hurdle v3.0.1, coletor do caminho critico
 *
 * Coleta a taxa real do Tesouro IPCA+ (NTN-B Principal, cupom zero) a partir do
 * CSV oficial do Tesouro Transparente e grava serie point-in-time filtrada.
 *
 * Decisoes declaradas:
 *   - Taxa de COMPRA (o que o investidor consegue comprar), nao taxa indicativa ANBIMA.
 *   - So titulos OFERTADOS (taxa_compra > 0) entram na curva.
 *   - So NTN-B Principal: exclui "com Juros Semestrais", Educa+, Renda+.
 *   - availableAt = data_base 09:30 BRT (taxas "Manha").
 *   - Linhas do backfill inicial: pit="backfill" (podem conter revisoes nao detectaveis).
 *     Linhas coletadas depois: pit="live". Primeira versao vista VENCE; divergencias
 *     posteriores vao para revisions.csv, nunca sobrescrevem.
 *
 * Uso:
 *   node tesouro_ipca_collector.mjs                  # baixa e atualiza data/tesouro/
 *   node tesouro_ipca_collector.mjs --local=x.csv    # usa CSV local
 *   node tesouro_ipca_collector.mjs --out=outro/dir
 *   NEXO_SELFTEST=1 node tesouro_ipca_collector.mjs  # testes internos, sem rede
 *
 * Zero dependencia npm.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Readable, PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const SOURCE_URL =
  'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv';

const HEADER_OUT = ['data_base', 'vencimento', 'anos_ate_venc', 'taxa_compra', 'taxa_venda',
  'pu_compra', 'pu_venda', 'ofertado', 'available_at', 'pit', 'first_seen_at'];

// ---------------- normalizacao ----------------
export function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/[^\x00-\x7F]/g, '')                        // remove mojibake residual
    .toLowerCase().replace(/[\s\-_+.]/g, '');
}

/** true se o titulo e NTN-B Principal (IPCA+ sem cupom). */
export function isIpcaPrincipal(tipo) {
  const n = normName(tipo);
  if (n.includes('juros') || n.includes('semest')) return false;   // NTN-B com cupom
  if (n.includes('educa') || n.includes('renda')) return false;    // estruturas diferentes
  if (n.includes('ntnbprincipal')) return true;                     // nomenclatura antiga
  return n.includes('ipca');
}

export const brNum = s => {
  if (s == null || String(s).trim() === '') return null;
  const v = Number(String(s).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
export const brDate = s => {                       // dd/mm/yyyy -> yyyy-mm-dd
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
export const yearsBetween = (a, b) =>
  Math.round(((new Date(b) - new Date(a)) / 86400000 / 365.25) * 10000) / 10000;

// ---------------- parse de uma linha do CSV fonte ----------------
export function parseSourceLine(line) {
  const c = line.split(';');
  if (c.length < 8) return null;
  if (!isIpcaPrincipal(c[0])) return null;
  const venc = brDate(c[1]), base = brDate(c[2]);
  if (!venc || !base) return null;
  const tc = brNum(c[3]), tv = brNum(c[4]);
  return {
    data_base: base, vencimento: venc,
    anos_ate_venc: yearsBetween(base, venc),
    taxa_compra: tc, taxa_venda: tv,
    pu_compra: brNum(c[5]), pu_venda: brNum(c[6]),
    ofertado: tc != null && tc > 0,
    available_at: `${base}T09:30:00-03:00`,
  };
}

// ---------------- interpolacao por horizonte ----------------
/**
 * Taxa real (taxa_compra) no horizonte, para uma data.
 * Linear entre os dois vencimentos OFERTADOS que cercam o horizonte; flat fora da faixa.
 * Retorna null se nenhum titulo ofertado na data.
 */
export function realRateAtHorizon(rows, date, horizonYears) {
  const pts = rows
    .filter(r => r.data_base === date && r.ofertado && r.taxa_compra > 0 && r.anos_ate_venc > 0)
    .map(r => ({ t: r.anos_ate_venc, y: r.taxa_compra, v: r.vencimento }))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  if (horizonYears <= pts[0].t)
    return { rate: pts[0].y, method: 'flat_below', bracket: [pts[0].v] };
  if (horizonYears >= pts.at(-1).t)
    return { rate: pts.at(-1).y, method: 'flat_above', bracket: [pts.at(-1).v] };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (horizonYears >= a.t && horizonYears <= b.t) {
      const w = b.t === a.t ? 0 : (horizonYears - a.t) / (b.t - a.t);
      return { rate: Math.round((a.y + w * (b.y - a.y)) * 10000) / 10000,
               method: w === 0 ? 'exact' : 'linear', bracket: [a.v, b.v] };
    }
  }
  return null;
}

// ---------------- merge point-in-time ----------------
const key = r => `${r.data_base}|${r.vencimento}`;
const same = (a, b) => ['taxa_compra', 'taxa_venda', 'pu_compra', 'pu_venda']
  .every(k => (a[k] ?? null) === (b[k] ?? null));

/**
 * Primeira versao vista vence. Retorna { merged, added, revisions }.
 * isBackfill: true quando nao existe arquivo anterior.
 */
export function mergePit(existing, incoming, { isBackfill, nowIso }) {
  const map = new Map(existing.map(r => [key(r), r]));
  const revisions = []; let added = 0;
  for (const r of incoming) {
    const k = key(r); const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...r, pit: isBackfill ? 'backfill' : 'live', first_seen_at: nowIso });
      added++;
    } else if (!same(prev, r)) {
      revisions.push({
        detected_at: nowIso, data_base: r.data_base, vencimento: r.vencimento,
        campo_taxa_compra: `${prev.taxa_compra} -> ${r.taxa_compra}`,
        campo_taxa_venda: `${prev.taxa_venda} -> ${r.taxa_venda}`,
        pit_original: prev.pit,
      });
    }
  }
  const merged = [...map.values()].sort((a, b) =>
    a.data_base < b.data_base ? -1 : a.data_base > b.data_base ? 1 :
    a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0);
  return { merged, added, revisions };
}

// ---------------- IO ----------------
function httpStream(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('muitos redirects'));
    https.get(url, { headers: { 'User-Agent': 'nexo-collector/1.0' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(httpStream(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      resolve(res);
    }).on('error', reject);
  });
}

/** Le a fonte em fluxo, calcula sha256 no caminho, devolve so linhas IPCA+ Principal. */
async function readSource(src) {
  const raw = src instanceof Readable ? src : fs.createReadStream(src);
  const hash = crypto.createHash('sha256');
  const tee = new PassThrough();
  let bytes = 0;
  raw.on('data', ch => { hash.update(ch); bytes += ch.length; });
  raw.pipe(tee);
  // latin1: seguro para ASCII; acentos viram mojibake mas normName os descarta
  tee.setEncoding('latin1');
  const rl = readline.createInterface({ input: tee, crlfDelay: Infinity });
  const rows = []; let header = null, total = 0, headerOk = true;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = line.replace(/^\uFEFF/, '');
      headerOk = /tipo\s*t[ií]tulo/i.test(header) || /tipo/i.test(normName(header));
      continue;
    }
    total++;
    const r = parseSourceLine(line);
    if (r) rows.push(r);
  }
  return { rows, total, header, headerOk, sha256: hash.digest('hex'), bytes };
}

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const [h, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const cols = h.split(',');
  return lines.map(l => {
    const v = l.split(','); const o = {};
    cols.forEach((c, i) => { o[c] = v[i]; });
    for (const k of ['anos_ate_venc', 'taxa_compra', 'taxa_venda', 'pu_compra', 'pu_venda'])
      o[k] = o[k] === '' ? null : Number(o[k]);
    o.ofertado = o.ofertado === 'true';
    return o;
  });
}
function writeCsv(file, rows, cols) {
  const out = [cols.join(',')].concat(rows.map(r => cols.map(c => r[c] ?? '').join(',')));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, out.join('\n') + '\n');
  fs.renameSync(tmp, file);                        // escrita atomica
}

// ---------------- main ----------------
async function main() {
  const argv = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
  }));
  const outDir = path.resolve(argv.out || 'data/tesouro');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'tesouro_ipca_principal.csv');
  const revFile = path.join(outDir, 'revisions.csv');
  const metaFile = path.join(outDir, 'collector_meta.json');
  const nowIso = new Date().toISOString();

  console.log(`Tesouro IPCA+ collector | saida ${outDir}`);
  const src = argv.local ? path.resolve(argv.local) : await httpStream(SOURCE_URL);
  if (!argv.local) console.log('   lendo fonte oficial em fluxo...');
  const { rows, total, header, headerOk, sha256, bytes } = await readSource(src);

  if (!headerOk) throw new Error(`cabecalho inesperado: "${header}" — layout da fonte mudou`);
  if (!rows.length) throw new Error('nenhuma linha IPCA+ Principal encontrada — filtro ou fonte quebrados');

  const existing = readCsv(outFile);
  const isBackfill = existing.length === 0;
  const { merged, added, revisions } = mergePit(existing, rows, { isBackfill, nowIso });

  writeCsv(outFile, merged, HEADER_OUT);
  const revCols = ['detected_at', 'data_base', 'vencimento', 'campo_taxa_compra', 'campo_taxa_venda', 'pit_original'];
  const prevRev = fs.existsSync(revFile) ? readCsv(revFile) : [];
  const revKey = r => [r.data_base, r.vencimento, r.campo_taxa_compra, r.campo_taxa_venda].join('|');
  const known = new Set(prevRev.map(revKey));
  const newRevisions = revisions.filter(r => !known.has(revKey(r)));
  if (newRevisions.length) writeCsv(revFile, prevRev.concat(newRevisions), revCols);
  const datas = [...new Set(merged.map(r => r.data_base))].sort();
  const titulos = new Set(merged.map(r => r.vencimento));
  const meta = {
    collected_at: nowIso, source_url: SOURCE_URL, source_sha256: sha256, source_bytes: bytes,
    source_rows_total: total, ipca_principal_rows_in_source: rows.length,
    stored_rows: merged.length, added_this_run: added,
    revisions_new: newRevisions.length, revisions_known: revisions.length - newRevisions.length,
    mode: isBackfill ? 'backfill' : 'incremental',
    first_date: datas[0], last_date: datas.at(-1), distinct_maturities: titulos.size,
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  console.log(`   linhas na fonte: ${total} | IPCA+ Principal: ${rows.length}`);
  console.log(`   modo: ${meta.mode} | adicionadas: ${added} | revisoes novas: ${newRevisions.length} (ja registradas: ${revisions.length - newRevisions.length})`);
  console.log(`   periodo: ${meta.first_date} -> ${meta.last_date} | vencimentos distintos: ${titulos.size}`);
  if (newRevisions.length) console.log(`   ⚠️  ${newRevisions.length} revisao(oes) nova(s) em ${revFile} (valor original preservado)`);

  const last = meta.last_date;
  for (const h of [2, 5, 10]) {
    const r = realRateAtHorizon(merged, last, h);
    console.log(`   ${last} horizonte ${String(h).padStart(2)}a: ` +
      (r ? `IPCA + ${r.rate.toFixed(2)}% (${r.method}, ${r.bracket.join(' / ')})` : 'sem titulo ofertado'));
  }
  console.log(`   sha256 fonte: ${sha256.slice(0, 16)}…`);
}

// ---------------- selftest ----------------
function selftest() {
  let pass = 0, fail = 0;
  const t = (nome, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}`); };

  // filtro de nomes, incluindo variacoes de grafia
  t('IPCA+ simples',                isIpcaPrincipal('Tesouro IPCA+'));
  t('IPCA + com espaco',            isIpcaPrincipal('Tesouro IPCA +'));
  t('NTN-B Principal antigo',       isIpcaPrincipal('NTN-B Principal'));
  t('mojibake nao quebra',          isIpcaPrincipal('Tesouro IPCA\u00c3+'));
  t('exclui juros semestrais',      !isIpcaPrincipal('Tesouro IPCA+ com Juros Semestrais'));
  t('exclui Educa+',                !isIpcaPrincipal('Tesouro Educa+'));
  t('exclui Renda+',                !isIpcaPrincipal('Tesouro Renda+ Aposentadoria Extra'));
  t('exclui Selic',                 !isIpcaPrincipal('Tesouro Selic'));
  t('exclui Prefixado',             !isIpcaPrincipal('Tesouro Prefixado'));

  // parse numerico e de data
  t('decimal com virgula',          brNum('7,28') === 7.28);
  t('milhar com ponto',             brNum('3.984,47') === 3984.47);
  t('vazio -> null',                brNum('') === null);
  t('data dd/mm/yyyy',              brDate('15/05/2035') === '2035-05-15');
  t('data invalida -> null',        brDate('2035-05-15') === null);

  // parse de linha
  const l = parseSourceLine('Tesouro IPCA+;15/05/2035;19/09/2026;7,55;7,67;1850,10;1840,20;1839,00');
  t('linha parseada',               l && l.taxa_compra === 7.55 && l.ofertado === true);
  t('availableAt manha',            l && l.available_at === '2026-09-19T09:30:00-03:00');
  const l0 = parseSourceLine('Tesouro IPCA+;15/05/2024;19/09/2026;0,00;6,10;0;4000;4000');
  t('compra zero = nao ofertado',   l0 && l0.ofertado === false);
  t('linha de cupom descartada',    parseSourceLine('Tesouro IPCA+ com Juros Semestrais;15/08/2032;19/09/2026;7,90;8,02;4200;4180;4170') === null);

  // interpolacao
  const d = '2026-09-19';
  const rows = [
    { data_base: d, vencimento: '2029-05-15', anos_ate_venc: 2.65, taxa_compra: 8.20, ofertado: true },
    { data_base: d, vencimento: '2035-05-15', anos_ate_venc: 8.65, taxa_compra: 7.55, ofertado: true },
    { data_base: d, vencimento: '2045-05-15', anos_ate_venc: 18.65, taxa_compra: 7.30, ofertado: true },
    { data_base: d, vencimento: '2032-08-15', anos_ate_venc: 5.9, taxa_compra: 0, ofertado: false },
  ];
  const r1 = realRateAtHorizon(rows, d, 2.65);
  t('vertice exato',                r1.rate === 8.20);
  const r2 = realRateAtHorizon(rows, d, 5.65);
  t('linear no meio (8,20->7,55)',  Math.abs(r2.rate - 7.875) < 1e-9 && r2.method === 'linear');
  t('ignora nao ofertado',          !r2.bracket.includes('2032-08-15'));
  t('flat abaixo',                  realRateAtHorizon(rows, d, 1).method === 'flat_below');
  t('flat acima',                   realRateAtHorizon(rows, d, 30).rate === 7.30);
  t('data sem titulo -> null',      realRateAtHorizon(rows, '2020-01-01', 5) === null);

  // point-in-time: primeira versao vence, revisao e registrada
  const base = [{ data_base: d, vencimento: '2035-05-15', taxa_compra: 7.55, taxa_venda: 7.67, pu_compra: 1, pu_venda: 1 }];
  const m1 = mergePit([], base, { isBackfill: true, nowIso: 'T1' });
  t('backfill marca pit=backfill',  m1.merged[0].pit === 'backfill' && m1.added === 1);
  const revisado = [{ ...base[0], taxa_compra: 7.60 }];
  const m2 = mergePit(m1.merged, revisado, { isBackfill: false, nowIso: 'T2' });
  t('revisao NAO sobrescreve',      m2.merged[0].taxa_compra === 7.55);
  t('revisao e registrada',         m2.revisions.length === 1);
  const novo = [{ data_base: '2026-09-20', vencimento: '2035-05-15', taxa_compra: 7.50, taxa_venda: 7.62, pu_compra: 1, pu_venda: 1 }];
  const m3 = mergePit(m2.merged, novo, { isBackfill: false, nowIso: 'T3' });
  t('nova data marca pit=live',     m3.merged.find(r => r.data_base === '2026-09-20').pit === 'live');
  const m4 = mergePit(m3.merged, novo, { isBackfill: false, nowIso: 'T4' });
  t('rodar de novo e idempotente',  m4.added === 0 && m4.revisions.length === 0);

  console.log(`\nselftest: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  if (process.env.NEXO_SELFTEST) selftest();
  else main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
}
