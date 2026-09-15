#!/usr/bin/env node
// =============================================================================
// nexo_b3_probe.mjs — v0.2 — Probe do BDI da B3 ("Participação dos Investidores")
// -----------------------------------------------------------------------------
// O QUE MUDOU DA v0.1 (rodada de 15/set/2026):
//  1. CONFIRMADO pela fonte: a tabela é ACUMULADA NO MÊS. O cabeçalho diz
//     "Dados acumulados do início do mês até o dia DD/MM/AAAA". O classificador
//     de cadência da v0.1 foi REMOVIDO — ele lia a coluna de % e errava.
//  2. CONFIRMADO: D+2. O BDI de 10/09 traz dados até 08/09. `data_ref` passa a
//     sair da FRASE do cabeçalho, nunca do nome do arquivo.
//  3. CONFIRMADO: capítulo 02. Ausência = HTTP 500 (não 404).
//  4. São DUAS tabelas. T1 = compras/vendas em R$ MIL (fluxo, mês corrente).
//     T2 = compras+vendas em R$ (volume por tipo de mercado, mês anterior).
//     T2 é volume, não fluxo: nunca vira saldo.
//  5. Soma-zero REBAIXADO: como Σcompras ≡ Σvendas por construção, ele testa
//     parsing, não qualidade do dado da fonte.
//
// O QUE ESTE PROBE AINDA PRECISA DESCOBRIR:
//  Q1 Data exata do corte histórico (entre 2022-03-16 e 2024-06-12), por bisseção
//  Q2 Existe outro padrão de URL para o BDI antigo? (salva o caso 2022)
//  Q3 data_ref real x data do arquivo, em vários dias (defasagem é sempre 2 d.u.?)
//  Q4 Parsing das duas tabelas em R$, com saldo = compras − vendas
//  Q5 ESCOPO DE MERCADO: T1 cobre só à vista ou todos os mercados?  <-- muda o gate
//  Q6 Gate G-NFI-1: saldo estrangeiro de jan/2026 bate com os ~R$ 26,3 bi?
//  Q7 Reconstrução do fluxo diário a partir do acumulado, incluindo virada de mês
//  Q8 Dump bruto (inspeção humana continua obrigatória)
//
// Uso:
//   NEXO_SELFTEST=1 node nexo_b3_probe.mjs
//   node nexo_b3_probe.mjs > b3_probe_out2.txt 2> b3_probe_err2.txt
//
// Zero dependências npm. Node >= 18. pdftotext (poppler-utils) obrigatório.
// =============================================================================

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SELFTEST = process.env.NEXO_SELFTEST === '1';
const RAW_DIR = './b3_probe_raw2';

const C = {
  BASE: 'https://arquivos.b3.com.br/bdi/download/bdi',
  CAPITULO: '02',                      // ✅ confirmado na v0.1
  AUSENTE_HTTP: 500,                   // ✅ confirmado: a B3 devolve 500, não 404
  UNIDADE_T1: 1000,                    // ✅ "Compras (R$) mil" -> multiplicar por 1000
  DEFASAGEM_ESPERADA_DU: 2,            // ✅ D+2
  TOL_PARSING_REL: 1e-9,               // soma-zero agora é teste de parsing
  TIMEOUT_MS: 30000,
  PAUSA_MS: 1100,

  CATEGORIAS: [
    'INSTITUCIONAIS', 'INSTITUICOES FINANCEIRAS', 'INVESTIDOR ESTRANGEIRO',
    'INVESTIDORES INDIVIDUAIS', 'OUTROS',
  ],
  // T2: 6 tipos de mercado, cada um com par (R$, %)
  MERCADOS_T2: ['a_vista', 'a_termo', 'opcoes', 'exercicios', 'blocos', 'total_geral'],

  // Gate G-NFI-1 ⚠ valor de referência: fluxo estrangeiro jan/2026, secundário
  REF_JAN2026_BRL: 26_300_000_000,
  REF_TOL_REL: 0.05,
};

// Janela conhecida do corte: 2022-03-16 = ausente, 2024-06-12 = presente.
const CORTE_ANTES = '2022-03-16';
const CORTE_DEPOIS = '2024-06-12';

// Padrões alternativos de URL a testar numa data antiga (Q2). São PALPITES.
const DATA_ANTIGA = '2018-05-16';
const PADROES_ALT = [
  (d, c) => `${C.BASE}/${d}/BDI_${c}_${d.replaceAll('-', '')}.pdf`,
  (d) => `${C.BASE}/${d}/BDI${d.replaceAll('-', '')}.pdf`,
  (d) => `${C.BASE}/${d}/BDI_${d.replaceAll('-', '')}.pdf`,
  (d, c) => `${C.BASE}/${d}/BDI_${c}_${d.replaceAll('-', '')}.zip`,
  (d, c) => `${C.BASE}/${d.replaceAll('-', '')}/BDI_${c}_${d.replaceAll('-', '')}.pdf`,
];

// Q7: 8 datas de arquivo cobrindo a virada ago->set/2026.
const DATAS_VIRADA = [
  '2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01',
  '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08',
];
// Q5/Q6: datas de arquivo que provavelmente carregam o fechamento do mês.
const DATAS_FECHA_AGOSTO = ['2026-09-01', '2026-09-02', '2026-09-03'];
const DATAS_FECHA_JANEIRO = ['2026-02-02', '2026-02-03', '2026-02-04'];

// =============================================================================
// FUNÇÕES PURAS
// =============================================================================

export function urlBDI(dataISO, capitulo = C.CAPITULO) {
  return `${C.BASE}/${dataISO}/BDI_${capitulo}_${dataISO.replaceAll('-', '')}.pdf`;
}

export function parseNumBR(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim();
  if (t === '' || t === '-' || t === '--') return null;
  const negativo = /^\(.*\)$/.test(t) || t.startsWith('-');
  t = t.replace(/[()\-+]/g, '').replace(/\s/g, '');
  t = t.replace(/\./g, '').replace(/,/g, '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = parseFloat(t);
  return negativo ? -v : v;
}

export function normalizar(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Q3 — a data de referência REAL vem da frase do cabeçalho. */
export function extrairDataRef(texto) {
  const m = texto.match(/at[ée]\s+o\s+dia\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function diasUteisEntre(iniISO, fimISO) {
  const ini = new Date(iniISO + 'T12:00:00Z');
  const fim = new Date(fimISO + 'T12:00:00Z');
  if (isNaN(ini) || isNaN(fim) || fim < ini) return null;
  let n = 0;
  const cur = new Date(ini);
  while (cur < fim) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) n++;   // não considera feriado: é aproximação declarada
  }
  return n;
}

export function mesDe(dataISO) { return dataISO ? dataISO.slice(0, 7) : null; }

/**
 * Q4 — T1: fluxo acumulado do mês. 4 números por categoria:
 * [compras_mil, part_compras_pct, vendas_mil, part_vendas_pct]
 * Devolve valores já convertidos para R$ (×1000) e o saldo.
 */
export function parsearT1(bloco) {
  const linhas = [];
  for (const linha of bloco.split('\n')) {
    const n = normalizar(linha);
    const cat = C.CATEGORIAS.find((c) => n.startsWith(c));
    if (!cat) continue;
    const nums = (linha.match(/\d[\d.]*,\d{1,2}|\d[\d.]{2,}/g) || [])
      .map(parseNumBR).filter((v) => v !== null);
    if (nums.length !== 4) { linhas.push({ categoria: cat, erro: `esperava 4 números, veio ${nums.length}`, nums }); continue; }
    const compras = nums[0] * C.UNIDADE_T1;
    const vendas = nums[2] * C.UNIDADE_T1;
    linhas.push({
      categoria: cat, compras, vendas, saldo: compras - vendas,
      part_compras_pct: nums[1], part_vendas_pct: nums[3],
    });
  }
  // dedup: a mesma categoria pode reaparecer na T2; T1 vem primeiro
  const vistos = new Set();
  return linhas.filter((l) => { if (vistos.has(l.categoria)) return false; vistos.add(l.categoria); return true; });
}

/**
 * Q4 — T2: volume (compras+vendas) por tipo de mercado, mês anterior.
 * 12 números = 6 pares (R$, %). NÃO é fluxo: nunca vira saldo.
 */
export function parsearT2(bloco) {
  const out = [];
  for (const linha of bloco.split('\n')) {
    const n = normalizar(linha);
    const cat = C.CATEGORIAS.find((c) => n.startsWith(c));
    if (!cat) continue;
    const nums = (linha.match(/\d[\d.]*,\d{1,2}|\d[\d.]{2,}/g) || [])
      .map(parseNumBR).filter((v) => v !== null);
    if (nums.length !== 12) continue;
    const reg = { categoria: cat };
    C.MERCADOS_T2.forEach((m, i) => { reg[m] = nums[i * 2]; reg[m + '_pct'] = nums[i * 2 + 1]; });
    out.push(reg);
  }
  return out;
}

/** Soma-zero: agora é teste de PARSING, não de qualidade da fonte. */
export function checarParsing(linhasT1) {
  const compras = linhasT1.reduce((s, l) => s + (l.compras ?? 0), 0);
  const vendas = linhasT1.reduce((s, l) => s + (l.vendas ?? 0), 0);
  const saldo = linhasT1.reduce((s, l) => s + (l.saldo ?? 0), 0);
  const escala = compras + vendas;
  const razao = escala === 0 ? null : Math.abs(compras - vendas) / escala;
  return {
    compras, vendas, saldo, razao,
    identico: razao !== null && razao <= C.TOL_PARSING_REL,
    n_categorias: linhasT1.length,
  };
}

/** Q7 — fluxo diário a partir do acumulado. Reset na virada de mês. */
export function fluxoDiario(serie) {
  // serie: [{data_ref, saldo}] ordenada por data_ref ascendente
  const out = [];
  for (let i = 0; i < serie.length; i++) {
    const at = serie[i];
    const ant = i > 0 ? serie[i - 1] : null;
    const mesmoMes = ant && mesDe(ant.data_ref) === mesDe(at.data_ref);
    out.push({
      data_ref: at.data_ref,
      acumulado: at.saldo,
      fluxo_dia: mesmoMes ? at.saldo - ant.saldo : at.saldo,
      base: mesmoMes ? 'diff' : 'inicio_de_mes',
    });
  }
  return out;
}

/** Q5 — T1 cobre só à vista ou todos os mercados? */
export function classificarEscopo(volT1, t2Linha) {
  if (!t2Linha || !volT1) return { escopo: 'indeterminado' };
  const dist = (a, b) => (b === 0 ? Infinity : Math.abs(a - b) / b);
  const dAVista = dist(volT1, t2Linha.a_vista);
  const dTotal = dist(volT1, t2Linha.total_geral);
  const escopo = dAVista < 0.02 ? 'somente_a_vista'
    : dTotal < 0.02 ? 'todos_os_mercados' : 'indeterminado';
  return { escopo, dist_a_vista: dAVista, dist_total: dTotal };
}

// =============================================================================
// SELF-TEST
// =============================================================================

const T1_FAKE = [
  'Participação dos investidores',
  'Dados acumulados do início do mês até o dia 08/09/2026.',
  'Tipos de investidores          Compras (R$) mil     Participação (%)   Vendas (R$) mil    Participação (%)',
  'Institucionais                       39.581.415             12,05         42.852.441            13,05',
  'Instituições Financeiras              2.899.249              0,88          2.821.011             0,86',
  'Investidor Estrangeiro              102.641.915             31,25         96.657.202            29,43',
  'Investidores Individuais             18.093.883              5,51         20.421.916             6,22',
  'Outros                                1.007.405              0,31          1.471.297             0,45',
].join('\n');

const T2_FAKE = [
  'Participação dos investidores mensal',
  'Institucionais       274.811.942.485  25,00  3.210.659.580  76,00  12.864.823.128  24,00  33.764.364.596  31,00  9.119.407.696  47,00  333.771.197.484  26,00',
  'Investidor Estrangeiro 638.327.183.953 59,00    46.241.061   1,00  27.878.352.759  52,00  63.957.965.295  58,00  9.247.364.536  47,00  739.457.107.604  58,00',
].join('\n');

function selftest() {
  let pass = 0, fail = 0;
  const ok = (nome, cond) => { if (cond) { pass++; console.log(`PASS  ${nome}`); } else { fail++; console.log(`FAIL  ${nome}`); } };
  const perto = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

  ok('urlBDI usa o capítulo confirmado',
    urlBDI('2026-09-10') === 'https://arquivos.b3.com.br/bdi/download/bdi/2026-09-10/BDI_02_20260910.pdf');

  ok('data_ref sai da frase do cabeçalho', extrairDataRef(T1_FAKE) === '2026-09-08');
  ok('data_ref ausente vira null', extrairDataRef('sem frase nenhuma') === null);
  ok('data_ref aceita "ate" sem acento', extrairDataRef('acumulados ate o dia 31/01/2026.') === '2026-01-31');

  ok('D+2 entre 08/09 (ter) e 10/09 (qui)', diasUteisEntre('2026-09-08', '2026-09-10') === 2);
  ok('fim de semana não conta', diasUteisEntre('2026-09-04', '2026-09-07') === 1);
  ok('data invertida vira null', diasUteisEntre('2026-09-10', '2026-09-08') === null);

  const t1 = parsearT1(T1_FAKE);
  ok('T1 acha as 5 categorias', t1.length === 5);
  ok('T1 converte R$ mil para R$',
    perto(t1.find((l) => l.categoria === 'INVESTIDOR ESTRANGEIRO').compras, 102_641_915_000));
  ok('T1 calcula saldo = compras − vendas',
    perto(t1.find((l) => l.categoria === 'INVESTIDOR ESTRANGEIRO').saldo, 5_984_713_000));
  ok('T1 saldo negativo para institucionais',
    t1.find((l) => l.categoria === 'INSTITUCIONAIS').saldo < 0);
  ok('T1 não confunde % com valor',
    perto(t1.find((l) => l.categoria === 'OUTROS').part_vendas_pct, 0.45));
  ok('T1 reporta linha com contagem errada em vez de chutar',
    parsearT1('Outros   1.007.405   0,31').some((l) => l.erro));

  const chk = checarParsing(t1);
  ok('parsing: Σcompras ≡ Σvendas (identidade construtiva)', chk.identico === true);
  ok('parsing: saldo total ≈ 0', perto(chk.saldo, 0, 1e-9));
  ok('parsing: Σcompras = 164.223.867 mil', perto(chk.compras, 164_223_867_000));

  const t2 = parsearT2(T2_FAKE);
  ok('T2 acha as linhas de 12 números', t2.length === 2);
  ok('T2 separa à vista de total geral',
    perto(t2[0].a_vista, 274_811_942_485) && perto(t2[0].total_geral, 333_771_197_484));
  ok('T2 não é lido como T1', parsearT1(T2_FAKE).every((l) => l.erro));

  const esc = classificarEscopo(333_771_197_484, t2[0]);
  ok('escopo: bate com total geral', esc.escopo === 'todos_os_mercados');
  ok('escopo: bate com à vista',
    classificarEscopo(274_811_942_485, t2[0]).escopo === 'somente_a_vista');
  ok('escopo: valor estranho fica indeterminado',
    classificarEscopo(1, t2[0]).escopo === 'indeterminado');

  const fd = fluxoDiario([
    { data_ref: '2026-08-27', saldo: 1000 },
    { data_ref: '2026-08-28', saldo: 1500 },
    { data_ref: '2026-09-01', saldo: -200 },
    { data_ref: '2026-09-02', saldo: -50 },
  ]);
  ok('fluxo diário é diferença dentro do mês', fd[1].fluxo_dia === 500 && fd[1].base === 'diff');
  ok('virada de mês NÃO vira diferença', fd[2].fluxo_dia === -200 && fd[2].base === 'inicio_de_mes');
  ok('fluxo diário após virada volta a ser diff', fd[3].fluxo_dia === 150);

  console.log(`\nnexo_b3_probe v0.2 self-test ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

// =============================================================================
// AO VIVO
// =============================================================================

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function baixar(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), C.TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, bytes: buf.length, buf };
  } catch (e) {
    return { status: 0, bytes: 0, buf: null, erro: String(e.message) };
  } finally { clearTimeout(t); }
}

const ehPDF = (buf) => !!buf && buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF';

function textoDe(buf, tag) {
  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });
  const pdf = `${RAW_DIR}/${tag}.pdf`, txt = `${RAW_DIR}/${tag}.txt`;
  writeFileSync(pdf, buf);
  try {
    execFileSync('pdftotext', ['-layout', pdf, txt], { stdio: ['ignore', 'pipe', 'pipe'] });
    return existsSync(txt) ? readFileSync(txt, 'utf8') : null;
  } catch { return null; }
}

/** Baixa e extrai um dia. Devolve null se ausente. */
async function lerDia(dataArquivo, tag) {
  const r = await baixar(urlBDI(dataArquivo));
  await pausa(C.PAUSA_MS);
  if (r.status !== 200 || !ehPDF(r.buf)) return { dataArquivo, status: r.status, ausente: true };
  const texto = textoDe(r.buf, tag ?? `bdi_${dataArquivo}`);
  if (!texto) return { dataArquivo, status: 200, ausente: false, erro: 'pdftotext falhou' };
  const dataRef = extrairDataRef(texto);
  const t1 = parsearT1(texto);
  const t2 = parsearT2(texto);
  return { dataArquivo, status: 200, ausente: false, texto, dataRef, t1, t2 };
}

async function aoVivo() {
  console.log('# nexo_b3_probe v0.2 — relatório');
  console.log(`# gerado em ${new Date().toISOString()} | node ${process.version}\n`);

  // ---- Q1: bisseção binária do corte histórico
  console.log('## Q1 — data exata do corte histórico (bisseção)');
  console.log(`janela inicial: ausente em ${CORTE_ANTES}, presente em ${CORTE_DEPOIS}`);
  let lo = new Date(CORTE_ANTES + 'T12:00:00Z');
  let hi = new Date(CORTE_DEPOIS + 'T12:00:00Z');
  const iso = (d) => d.toISOString().slice(0, 10);

  // Um 500 isolado pode ser feriado. Só declara ausência se 5 dias seguidos derem 500.
  const existeJanela = async (dISO) => {
    const base = new Date(dISO + 'T12:00:00Z');
    for (let k = 0; k < 5; k++) {
      const cur = new Date(base); cur.setUTCDate(cur.getUTCDate() + k);
      const dia = cur.getUTCDay();
      if (dia === 0 || dia === 6) continue;
      const r = await baixar(urlBDI(iso(cur)));
      await pausa(C.PAUSA_MS);
      if (r.status === 200 && ehPDF(r.buf)) return { existe: true, em: iso(cur) };
    }
    return { existe: false, em: null };
  };

  let iter = 0;
  while ((hi - lo) > 7 * 86400000 && iter < 10) {
    iter++;
    const mid = new Date((lo.getTime() + hi.getTime()) / 2);
    const res = await existeJanela(iso(mid));
    console.log(`  iter ${iter}: ${iso(mid)} -> ${res.existe ? 'PRESENTE (' + res.em + ')' : 'ausente'}`);
    if (res.existe) hi = new Date(res.em + 'T12:00:00Z'); else lo = mid;
  }
  console.log(`corte está entre ${iso(lo)} e ${iso(hi)}`);
  console.log('LEITURA: tudo antes disso não tem fluxo por esta fonte.\n');

  // ---- Q2: padrões alternativos numa data antiga
  console.log(`## Q2 — padrões alternativos de URL em ${DATA_ANTIGA} (palpites)`);
  for (const [i, f] of PADROES_ALT.entries()) {
    const url = f(DATA_ANTIGA, C.CAPITULO);
    const r = await baixar(url);
    console.log(`  p${i + 1}: HTTP ${r.status} | ${r.bytes} bytes | pdf=${ehPDF(r.buf)} | ${url}`);
    await pausa(C.PAUSA_MS);
  }
  console.log('');

  // ---- Q3 + Q7: série da virada de mês
  console.log('## Q3/Q7 — data_ref, defasagem e reconstrução do fluxo diário');
  const dias = [];
  for (const d of DATAS_VIRADA) {
    const r = await lerDia(d);
    if (r.ausente) { console.log(`  ${d}: ausente (HTTP ${r.status})`); continue; }
    if (r.erro) { console.log(`  ${d}: ${r.erro}`); continue; }
    const lag = r.dataRef ? diasUteisEntre(r.dataRef, d) : null;
    const est = r.t1.find((l) => l.categoria === 'INVESTIDOR ESTRANGEIRO');
    console.log(`  arquivo ${d} | data_ref ${r.dataRef ?? 'NÃO ACHADA'} | defasagem ${lag} d.u. | categorias ${r.t1.length}`);
    if (r.dataRef && est && !est.erro) dias.push({ data_ref: r.dataRef, saldo: est.saldo, dia: r });
  }
  const lags = dias.map((x) => diasUteisEntre(x.data_ref, x.dia.dataArquivo));
  console.log(`defasagens observadas: ${[...new Set(lags)].join(', ')} (esperado ${C.DEFASAGEM_ESPERADA_DU})`);
  console.log('');
  console.log('### fluxo diário do ESTRANGEIRO reconstruído do acumulado');
  dias.sort((a, b) => a.data_ref.localeCompare(b.data_ref));
  for (const f of fluxoDiario(dias.map(({ data_ref, saldo }) => ({ data_ref, saldo })))) {
    console.log(`  ${f.data_ref}: acum=${(f.acumulado / 1e9).toFixed(3)} bi | dia=${(f.fluxo_dia / 1e9).toFixed(3)} bi | ${f.base}`);
  }
  console.log('CHECAR: nenhum "diff" deve saltar para a ordem de grandeza do acumulado.\n');

  // ---- Q4: parsing e identidade
  console.log('## Q4 — parsing e identidade contábil (último dia lido)');
  if (dias.length) {
    const ult = dias[dias.length - 1].dia;
    const chk = checarParsing(ult.t1);
    console.log(`data_ref ${ult.dataRef} | categorias ${chk.n_categorias}`);
    for (const l of ult.t1) {
      if (l.erro) { console.log(`  ${l.categoria}: ERRO ${l.erro} | ${l.nums?.join(' | ')}`); continue; }
      console.log(`  ${l.categoria}: compras=${(l.compras / 1e9).toFixed(3)} bi | vendas=${(l.vendas / 1e9).toFixed(3)} bi | saldo=${(l.saldo / 1e9).toFixed(3)} bi`);
    }
    console.log(`Σcompras=${(chk.compras / 1e9).toFixed(3)} bi | Σvendas=${(chk.vendas / 1e9).toFixed(3)} bi | razão=${chk.razao}`);
    console.log(`identidade construtiva confirmada? ${chk.identico}`);
  } else { console.log('sem dias lidos'); }
  console.log('');

  // ---- Q5: escopo de mercado
  console.log('## Q5 — T1 cobre só à vista ou todos os mercados? (muda o gate)');
  let fechaAgosto = null;
  for (const d of DATAS_FECHA_AGOSTO) {
    const r = await lerDia(d, `fecha_ago_${d}`);
    if (r.ausente || r.erro || !r.dataRef) continue;
    console.log(`  arquivo ${d} -> data_ref ${r.dataRef}`);
    if (mesDe(r.dataRef) === '2026-08') { fechaAgosto = r; }
  }
  if (!fechaAgosto) {
    console.log('  não achei um BDI com data_ref no fim de agosto — Q5 indeterminado');
  } else {
    const volT1 = fechaAgosto.t1.reduce((s, l) => s + (l.compras ?? 0) + (l.vendas ?? 0), 0);
    // T2 do BDI de setembro traz agosto. Pego o T2 do último dia lido no Q7.
    const t2ref = dias.length ? dias[dias.length - 1].dia.t2 : [];
    const totalT2 = C.MERCADOS_T2.reduce((acc, m) => {
      acc[m] = t2ref.reduce((s, l) => s + (l[m] ?? 0), 0); return acc;
    }, {});
    console.log(`  T1 agosto (compras+vendas): ${(volT1 / 1e9).toFixed(1)} bi`);
    console.log(`  T2 agosto à vista:          ${(totalT2.a_vista / 1e9).toFixed(1)} bi`);
    console.log(`  T2 agosto total geral:      ${(totalT2.total_geral / 1e9).toFixed(1)} bi`);
    const esc = classificarEscopo(volT1, { a_vista: totalT2.a_vista, total_geral: totalT2.total_geral });
    console.log(`  ==> ESCOPO DE T1: ${esc.escopo} (dist à vista ${esc.dist_a_vista?.toFixed(4)}, dist total ${esc.dist_total?.toFixed(4)})`);
  }
  console.log('');

  // ---- Q6: gate G-NFI-1
  console.log('## Q6 — Gate G-NFI-1: saldo estrangeiro de jan/2026');
  let fechaJan = null;
  for (const d of DATAS_FECHA_JANEIRO) {
    const r = await lerDia(d, `fecha_jan_${d}`);
    if (r.ausente || r.erro || !r.dataRef) continue;
    console.log(`  arquivo ${d} -> data_ref ${r.dataRef}`);
    if (mesDe(r.dataRef) === '2026-01') fechaJan = r;
  }
  if (!fechaJan) {
    console.log('  não achei BDI com data_ref no fim de janeiro/2026 — gate não avaliado');
  } else {
    const est = fechaJan.t1.find((l) => l.categoria === 'INVESTIDOR ESTRANGEIRO');
    const dist = Math.abs(est.saldo - C.REF_JAN2026_BRL) / C.REF_JAN2026_BRL;
    console.log(`  saldo estrangeiro acum. jan/2026 (data_ref ${fechaJan.dataRef}): ${(est.saldo / 1e9).toFixed(3)} bi`);
    console.log(`  referência: ${(C.REF_JAN2026_BRL / 1e9).toFixed(1)} bi | distância relativa: ${(dist * 100).toFixed(2)}%`);
    console.log(`  ==> G-NFI-1 ${dist <= C.REF_TOL_REL ? 'PASSA' : 'NÃO PASSA'} com tolerância ${C.REF_TOL_REL * 100}%`);
    console.log('  NOTA: se não passar, conferir antes se a referência é do mesmo escopo de mercado (Q5).');
  }
  console.log('');

  // ---- Q8: dump
  console.log('## Q8 — DUMP BRUTO (inspeção humana)');
  if (dias.length) {
    const ult = dias[dias.length - 1].dia;
    const i = ult.texto.search(/Participação dos investidores/i);
    console.log(`--- INÍCIO DUMP (arquivo ${ult.dataArquivo}, data_ref ${ult.dataRef}) ---`);
    console.log(ult.texto.slice(Math.max(0, i), i + 4200));
    console.log('--- FIM DUMP ---');
  } else {
    console.log(`sem texto. PDFs em ${RAW_DIR}`);
  }
  console.log('\n# fim do relatório');
}

// =============================================================================
if (SELFTEST) selftest();
else aoVivo().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
