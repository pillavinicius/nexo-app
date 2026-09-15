#!/usr/bin/env node
// =============================================================================
// nexo_sgs_probe.mjs — v0.2 — Probe das séries SGS do BCB para o FXE e o contrato
// -----------------------------------------------------------------------------
// MUDOU DA v0.1: os códigos não são mais candidatos a preencher à mão. Foram
// extraídos das tabelas oficiais do BCB (IES-01, IES-13, Tab 3 de estatísticas
// monetárias), que publicam a linha "Código da série no SGS" junto dos dados.
//
// Uso:
//   NEXO_SELFTEST=1 node nexo_sgs_probe.mjs
//   node nexo_sgs_probe.mjs > sgs_probe_out.txt 2> sgs_probe_err.txt
//
// Não grava em data/, não toca produção, não precisa de token.
// Zero dependências npm. Node >= 18.
// =============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const SELFTEST = process.env.NEXO_SELFTEST === '1';
const RAW_DIR = './sgs_probe_raw';

const C = {
  BASE: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.',
  ANOS_HISTORICO: 10,        // o SGS limita série diária a 10 anos por consulta
  TIMEOUT_MS: 30000,
  PAUSA_MS: 900,
  TOL_IDENTIDADE: 0.01,      // US$ 0,01 milhão — as tabelas têm 2 casas
  MIN_COBERTURA_IDENT: 0.99, // 99% dos meses devem fechar as identidades
};

// -----------------------------------------------------------------------------
// Séries confirmadas nas tabelas do BCB (origem anotada em cada linha)
// -----------------------------------------------------------------------------
const SERIES = [
  // --- Câmbio contratado — IES-13 "Movimento de câmbio contratado", US$ milhões
  { cod: 13962, ap: 'cambio_com_exp_total',   grupo: 'cambio', per: 'M', origem: 'IES-13' },
  { cod: 13963, ap: 'cambio_com_exp_acc',     grupo: 'cambio', per: 'M', origem: 'IES-13' },
  { cod: 13964, ap: 'cambio_com_exp_pa',      grupo: 'cambio', per: 'M', origem: 'IES-13' },
  { cod: 13965, ap: 'cambio_com_exp_demais',  grupo: 'cambio', per: 'M', origem: 'IES-13' },
  { cod: 13966, ap: 'cambio_com_importacao',  grupo: 'cambio', per: 'M', origem: 'IES-13' },
  { cod: 13967, ap: 'cambio_com_saldo',       grupo: 'cambio', per: 'M', origem: 'IES-13' },  // <- insumo do conversion_ratio
  { cod: 13968, ap: 'cambio_fin_compras',     grupo: 'cambio', per: 'M', origem: 'IES-13' },
  { cod: 13969, ap: 'cambio_fin_vendas',      grupo: 'cambio', per: 'M', origem: 'IES-13' },
  { cod: 13970, ap: 'cambio_fin_saldo',       grupo: 'cambio', per: 'M', origem: 'IES-13' },
  { cod: 13961, ap: 'cambio_saldo_geral',     grupo: 'cambio', per: 'M', origem: 'IES-13' },

  // --- O conflito: a IES-14 dá 11050 para o mesmo conceito de 13970
  { cod: 11050, ap: 'cambio_fin_saldo_ies14', grupo: 'conflito', per: 'M', origem: 'IES-14' },

  // --- Contrato de dissonância
  { cod: 21084, ap: 'inadimplencia_pf',       grupo: 'contrato', per: 'M', origem: 'Tab 3 mon./créd.' },
  { cod: 24364, ap: 'ibcbr_dessaz',           grupo: 'contrato', per: 'M', origem: 'IES-01' },

  // --- Controles: se estes falharem, o problema é de ambiente, não dos códigos
  { cod: 1,     ap: 'CONTROLE_ptax_venda',    grupo: 'controle', per: 'D', origem: 'produção NEXO' },
  { cod: 433,   ap: 'CONTROLE_ipca_mensal',   grupo: 'controle', per: 'M', origem: 'produção NEXO' },
];

// ⚠ PENDENTE: transações correntes. Slot vazio de propósito — não inventar código.
// A camada caixa do FXE roda sem ela; ela é contexto macro, não insumo do ratio.
const PENDENTES = { SGS_TRANSACOES_CORRENTES: null };

// =============================================================================
// FUNÇÕES PURAS
// =============================================================================

export function urlSerie(cod, dataInicial, dataFinal) {
  return `${C.BASE}${cod}/dados?formato=json&dataInicial=${dataInicial}&dataFinal=${dataFinal}`;
}

export function dataBRparaISO(s) {
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function isoParaDataBR(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** O SGS devolve valor como string. Ponto decimal é o padrão, mas nem sempre. */
export function parseValor(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim();
  if (t === '' || t === '-') return null;
  const temPonto = t.includes('.'), temVirgula = t.includes(',');
  if (temPonto && temVirgula) t = t.replace(/\./g, '').replace(',', '.');   // 1.234,56
  else if (temVirgula) t = t.replace(',', '.');                             // 1234,56
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

export function normalizarSerie(json) {
  if (!Array.isArray(json)) return [];
  return json
    .map((o) => ({ data: dataBRparaISO(o.data), valor: parseValor(o.valor) }))
    .filter((o) => o.data !== null)
    .sort((a, b) => a.data.localeCompare(b.data));
}

export function inferirPeriodicidade(serie) {
  if (serie.length < 3) return 'indeterminada';
  const dias = serie[0].data.slice(8, 10);
  const todosDia1 = serie.every((o) => o.data.slice(8, 10) === dias);
  if (todosDia1) return 'M';
  const d1 = new Date(serie[0].data), d2 = new Date(serie[1].data);
  const delta = (d2 - d1) / 86400000;
  return delta <= 4 ? 'D' : 'M';
}

export function resumir(serie) {
  const vals = serie.map((o) => o.valor).filter((v) => v !== null);
  return {
    n: serie.length,
    n_nulos: serie.length - vals.length,
    primeira: serie[0]?.data ?? null,
    ultima: serie[serie.length - 1]?.data ?? null,
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    periodicidade: inferirPeriodicidade(serie),
  };
}

/** Alinha N séries por data. Só retorna datas presentes em todas. */
export function alinhar(mapaSeries, apelidos) {
  const mapas = apelidos.map((ap) => {
    const m = new Map();
    for (const o of (mapaSeries[ap] ?? [])) m.set(o.data, o.valor);
    return m;
  });
  const base = mapas[0] ?? new Map();
  const out = [];
  for (const [data, v0] of base) {
    const vals = [v0, ...mapas.slice(1).map((m) => m.get(data))];
    if (vals.every((v) => typeof v === 'number' && Number.isFinite(v))) out.push({ data, vals });
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

/** Verifica uma identidade contábil linha a linha. fn recebe os valores alinhados. */
export function checarIdentidade(linhas, fn, tol = C.TOL_IDENTIDADE) {
  let ok = 0; const falhas = [];
  for (const l of linhas) {
    const erro = Math.abs(fn(l.vals));
    if (erro <= tol) ok++;
    else if (falhas.length < 5) falhas.push({ data: l.data, erro });
  }
  const n = linhas.length;
  return { n, ok, cobertura: n ? ok / n : 0, falhas };
}

/** Compara duas séries que deveriam ser a mesma coisa (11050 x 13970). */
export function compararSeries(linhas) {
  if (!linhas.length) return { n: 0, identicas: false };
  let iguais = 0, somaAbs = 0, maxAbs = 0; const exemplos = [];
  for (const { data, vals } of linhas) {
    const d = Math.abs(vals[0] - vals[1]);
    if (d <= C.TOL_IDENTIDADE) iguais++;
    else if (exemplos.length < 5) exemplos.push({ data, a: vals[0], b: vals[1], dif: d });
    somaAbs += d; maxAbs = Math.max(maxAbs, d);
  }
  return {
    n: linhas.length, iguais, pct_iguais: iguais / linhas.length,
    dif_media_abs: somaAbs / linhas.length, dif_max_abs: maxAbs,
    identicas: iguais === linhas.length, exemplos,
  };
}

// =============================================================================
// SELF-TEST
// =============================================================================

function selftest() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}`); } };
  const perto = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

  ok('urlSerie inclui filtro de data (exigido desde mar/2025)',
    urlSerie(13967, '01/01/2016', '31/12/2026').includes('dataInicial=01/01/2016&dataFinal=31/12/2026'));
  ok('urlSerie usa o código pedido', urlSerie(21084, 'a', 'b').includes('bcdata.sgs.21084/'));

  ok('dataBRparaISO converte', dataBRparaISO('01/09/2026') === '2026-09-01');
  ok('dataBRparaISO rejeita lixo', dataBRparaISO('2026-09-01') === null);
  ok('isoParaDataBR converte de volta', isoParaDataBR('2026-09-01') === '01/09/2026');

  ok('parseValor ponto decimal', perto(parseValor('6.84'), 6.84));
  ok('parseValor vírgula decimal', perto(parseValor('6,84'), 6.84));
  ok('parseValor milhar BR + decimal', perto(parseValor('1.234,56'), 1234.56));
  ok('parseValor negativo', perto(parseValor('-27358.57'), -27358.57));
  ok('parseValor vazio vira null', parseValor('') === null);

  const bruto = [
    { data: '01/03/2026', valor: '3.0' },
    { data: '01/01/2026', valor: '1.0' },
    { data: '01/02/2026', valor: '2.0' },
  ];
  const s = normalizarSerie(bruto);
  ok('normalizarSerie ordena ascendente', s[0].data === '2026-01-01' && s[2].data === '2026-03-01');
  ok('normalizarSerie converte valores', perto(s[1].valor, 2.0));
  ok('normalizarSerie com não-array devolve vazio', normalizarSerie({ erro: 'x' }).length === 0);

  ok('periodicidade mensal detectada', inferirPeriodicidade(s) === 'M');
  ok('periodicidade diária detectada', inferirPeriodicidade([
    { data: '2026-09-01' }, { data: '2026-09-02' }, { data: '2026-09-03' }]) === 'D');

  const r = resumir(s);
  ok('resumir conta n e extremos', r.n === 3 && perto(r.min, 1) && perto(r.max, 3));
  ok('resumir conta nulos',
    resumir([{ data: '2026-01-01', valor: null }, { data: '2026-02-01', valor: 2 }]).n_nulos === 1);

  // Identidades com os números reais da IES-13 (set-dez/2008)
  const mapa = {
    exp_total: [{ data: '2008-12-01', valor: 57148.18 }],
    acc: [{ data: '2008-12-01', valor: 15216.64 }],
    pa: [{ data: '2008-12-01', valor: 10946.39 }],
    demais: [{ data: '2008-12-01', valor: 30985.15 }],
    imp: [{ data: '2008-12-01', valor: 46098.72 }],
    saldo_com: [{ data: '2008-12-01', valor: 11049.46 }],
    fin_saldo: [{ data: '2008-12-01', valor: -27358.57 }],
    geral: [{ data: '2008-12-01', valor: -16309.11 }],
    fin_saldo_b: [{ data: '2008-12-01', valor: -27358.57 }],
    divergente: [{ data: '2008-12-01', valor: -27000.00 }],
  };
  const lin1 = alinhar(mapa, ['exp_total', 'acc', 'pa', 'demais']);
  ok('alinhar casa 4 séries pela data', lin1.length === 1 && lin1[0].vals.length === 4);
  ok('identidade ACC+PA+Demais = Total',
    checarIdentidade(lin1, ([t, a, p, d]) => t - (a + p + d)).cobertura === 1);
  ok('identidade Exp − Imp = Saldo comercial',
    checarIdentidade(alinhar(mapa, ['exp_total', 'imp', 'saldo_com']),
      ([e, i, s2]) => (e - i) - s2).cobertura === 1);
  ok('identidade Saldo com + Saldo fin = Saldo geral',
    checarIdentidade(alinhar(mapa, ['saldo_com', 'fin_saldo', 'geral']),
      ([a, b, g]) => (a + b) - g).cobertura === 1);
  ok('identidade quebrada é reportada com exemplo',
    checarIdentidade(alinhar(mapa, ['saldo_com', 'divergente', 'geral']),
      ([a, b, g]) => (a + b) - g).falhas.length === 1);

  ok('alinhar descarta data ausente numa das séries',
    alinhar({ a: [{ data: '2026-01-01', valor: 1 }, { data: '2026-02-01', valor: 2 }],
              b: [{ data: '2026-01-01', valor: 9 }] }, ['a', 'b']).length === 1);

  const cmpIgual = compararSeries(alinhar(mapa, ['fin_saldo', 'fin_saldo_b']));
  ok('comparação detecta séries idênticas', cmpIgual.identicas === true);
  const cmpDif = compararSeries(alinhar(mapa, ['fin_saldo', 'divergente']));
  ok('comparação detecta divergência', cmpDif.identicas === false && cmpDif.dif_max_abs > 300);

  ok('slot de transações correntes segue null, sem chute',
    PENDENTES.SGS_TRANSACOES_CORRENTES === null);

  console.log(`\nnexo_sgs_probe v0.2 self-test ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

// =============================================================================
// AO VIVO
// =============================================================================

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function buscar(cod, di, df) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), C.TIMEOUT_MS);
  try {
    const r = await fetch(urlSerie(cod, di, df), { signal: ctrl.signal });
    const txt = await r.text();
    let json = null, erroParse = null;
    try { json = JSON.parse(txt); } catch (e) { erroParse = txt.slice(0, 200); }
    return { status: r.status, json, erroParse, bytes: txt.length };
  } catch (e) {
    return { status: 0, json: null, erroParse: String(e.message), bytes: 0 };
  } finally { clearTimeout(t); }
}

async function aoVivo() {
  console.log('# nexo_sgs_probe v0.2 — relatório');
  console.log(`# gerado em ${new Date().toISOString()} | node ${process.version}`);
  console.log(`# histórico: ${C.ANOS_HISTORICO} anos\n`);

  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });

  const hoje = new Date();
  const df = isoParaDataBR(hoje.toISOString().slice(0, 10));
  const ini = new Date(hoje); ini.setFullYear(ini.getFullYear() - C.ANOS_HISTORICO);
  const di = isoParaDataBR(ini.toISOString().slice(0, 10));
  console.log(`# janela: ${di} a ${df}\n`);

  const mapa = {};
  console.log('## Séries');
  for (const s of SERIES) {
    const r = await buscar(s.cod, di, df);
    if (r.status !== 200 || !Array.isArray(r.json)) {
      console.log(`STATUS FALHA | ${s.cod} | ${s.ap} | HTTP ${r.status} | ${r.erroParse ?? 'resposta não é array'}`);
      await pausa(C.PAUSA_MS);
      continue;
    }
    const serie = normalizarSerie(r.json);
    mapa[s.ap] = serie;
    writeFileSync(`${RAW_DIR}/sgs_${s.cod}.json`, JSON.stringify(r.json).slice(0, 2_000_000));
    const z = resumir(serie);
    const perOk = z.periodicidade === s.per ? 'ok' : `ESPERAVA ${s.per}`;
    console.log(`STATUS OK | ${s.cod} | ${s.ap} | n=${z.n} | ${z.primeira}..${z.ultima} | per=${z.periodicidade} (${perOk}) | nulos=${z.n_nulos} | min=${z.min} max=${z.max} | origem: ${s.origem}`);
    await pausa(C.PAUSA_MS);
  }
  console.log('');

  // --- Identidades do câmbio contratado
  console.log('## Identidades contábeis (IES-13)');
  const ids = [
    ['ACC + PA + Demais = Exportação total',
      ['cambio_com_exp_total', 'cambio_com_exp_acc', 'cambio_com_exp_pa', 'cambio_com_exp_demais'],
      ([t, a, p, d]) => t - (a + p + d)],
    ['Exportação − Importação = Saldo comercial',
      ['cambio_com_exp_total', 'cambio_com_importacao', 'cambio_com_saldo'],
      ([e, i, s]) => (e - i) - s],
    ['Compras − Vendas = Saldo financeiro',
      ['cambio_fin_compras', 'cambio_fin_vendas', 'cambio_fin_saldo'],
      ([c, v, s]) => (c - v) - s],
    ['Saldo comercial + Saldo financeiro = Saldo geral',
      ['cambio_com_saldo', 'cambio_fin_saldo', 'cambio_saldo_geral'],
      ([a, b, g]) => (a + b) - g],
  ];
  for (const [nome, aps, fn] of ids) {
    const lin = alinhar(mapa, aps);
    const res = checarIdentidade(lin, fn);
    const veredito = res.cobertura >= C.MIN_COBERTURA_IDENT ? 'OK' : 'FALHA';
    console.log(`IDENT ${veredito} | ${nome} | ${res.ok}/${res.n} (${(res.cobertura * 100).toFixed(2)}%)`);
    for (const f of res.falhas) console.log(`      falha em ${f.data}: erro ${f.erro.toFixed(4)}`);
  }
  console.log('');

  // --- O conflito 11050 x 13970
  console.log('## Conflito: 11050 (IES-14) x 13970 (IES-13) — mesmo conceito?');
  const lin = alinhar(mapa, ['cambio_fin_saldo_ies14', 'cambio_fin_saldo']);
  const cmp = compararSeries(lin);
  if (!cmp.n) {
    console.log('não foi possível alinhar as duas séries');
  } else {
    console.log(`meses comparados: ${cmp.n} | iguais: ${cmp.iguais} (${(cmp.pct_iguais * 100).toFixed(2)}%)`);
    console.log(`diferença média abs: ${cmp.dif_media_abs.toFixed(4)} | máxima: ${cmp.dif_max_abs.toFixed(4)}`);
    console.log(`==> ${cmp.identicas ? 'SÃO A MESMA SÉRIE — usar 13967/13970 e descartar 11050'
      : 'SÃO DIFERENTES — decidir qual conceito o FXE quer antes de codar'}`);
    for (const e of cmp.exemplos) console.log(`      ${e.data}: 11050=${e.a} | 13970=${e.b} | dif=${e.dif.toFixed(2)}`);
  }
  console.log('');

  console.log('## Pendências');
  console.log(`transações correntes: ${PENDENTES.SGS_TRANSACOES_CORRENTES ?? 'AUSENTE — slot vazio de propósito'}`);
  console.log('\n# fim do relatório');
}

// =============================================================================
if (SELFTEST) selftest();
else aoVivo().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
