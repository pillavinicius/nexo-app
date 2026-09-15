#!/usr/bin/env node
// =============================================================================
// nexo_b3_probe.mjs — Probe do BDI da B3 (tabela "Participação dos Investidores")
// -----------------------------------------------------------------------------
// Objetivo: OBSERVAR a fonte antes de hardcodar qualquer constante no
// nfi_collector.mjs. Não grava em data/, não toca produção, não roda na Vercel.
// Cloud Shell apenas. Não precisa de token.
//
// Uso:
//   NEXO_SELFTEST=1 node nexo_b3_probe.mjs           # offline, sem rede
//   node nexo_b3_probe.mjs > b3_probe_out.txt        # ao vivo
//
// Saídas:
//   stdout            -> relatório (devolver ao Claude)
//   ./b3_probe_raw/   -> PDFs e textos extraídos (auditoria; NÃO commitar)
//
// Perguntas que o probe responde:
//   Q1 Padrão de URL: qual capítulo/nome de arquivo serve a tabela?
//   Q2 Até onde o arquivo por data volta? (backfill desde 2010 é viável?)
//   Q3 pdftotext está disponível e -layout preserva a tabela?
//   Q4 A tabela é DIÁRIA ou ACUMULADA NO MÊS?  <-- a pergunta que mata o módulo
//   Q5 Quais categorias, com os nomes exatos?
//   Q6 Qual a unidade? (R$ mil é a hipótese)
//   Q7 O invariante soma-zero fecha? Com qual tolerância?
//   Q8 Dump do texto bruto para inspeção humana do layout
//
// Zero dependências npm. Node >= 18 (fetch nativo). pdftotext via poppler-utils.
// =============================================================================

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SELFTEST = process.env.NEXO_SELFTEST === '1';
const RAW_DIR = './b3_probe_raw';

// -----------------------------------------------------------------------------
// ⚠ CONSTANTES PENDENTES — todas confirmadas (ou refutadas) por este probe.
// -----------------------------------------------------------------------------
const C = {
  // Semente verificada: exemplo real observado de BDI, capítulo 02.
  // https://arquivos.b3.com.br/bdi/download/bdi/2025-03-28/BDI_02_20250328.pdf
  BASE: 'https://arquivos.b3.com.br/bdi/download/bdi',
  CAPITULOS: ['02', '01', '03', '04'],   // 02 é a semente; os outros são controle

  // Âncoras de texto para localizar a tabela. Se nenhuma casar, o probe reporta
  // e imprime o texto inteiro — nunca inventa uma extração.
  ANCORAS: [
    'PARTICIPAÇÃO DOS INVESTIDORES',
    'PARTICIPACAO DOS INVESTIDORES',
    'PARTICIPATION BY INVESTOR TYPE',
  ],

  // Categorias esperadas (hipótese de 5, vinda da descrição pública da tabela).
  // O probe NÃO força esta lista: ele reporta o que achou.
  CATEGORIAS_ESPERADAS: [
    'INSTITUCIONAIS', 'INSTITUICOES FINANCEIRAS', 'INVESTIDOR ESTRANGEIRO',
    'INVESTIDORES INDIVIDUAIS', 'OUTROS',
  ],

  UNIDADE_HIPOTESE: 'R$ mil',       // ⚠ Q6
  SOMA_ZERO_TOL_REL: 0.02,          // ⚠ Q7 — provisório
  TIMEOUT_MS: 30000,
  PAUSA_MS: 1200,                   // gentileza com o servidor da B3
};

// Datas de sondagem. 3 dias ÚTEIS CONSECUTIVOS são obrigatórios para o Q4.
const DATAS_CONSECUTIVAS = ['2026-09-08', '2026-09-09', '2026-09-10'];
// Sondagem de profundidade histórica (Q2), do mais recente ao mais antigo.
const DATAS_HISTORICO = [
  '2026-09-10', '2024-06-12', '2022-03-16', '2020-08-19',
  '2018-05-16', '2015-04-15', '2012-09-19', '2010-03-17',
];
// Controles negativos: não deve existir arquivo.
const DATAS_CONTROLE = ['2026-09-06' /* sábado */, '2099-01-04' /* futuro */];

// =============================================================================
// FUNÇÕES PURAS (testadas offline no self-test)
// =============================================================================

export function urlBDI(dataISO, capitulo) {
  const compacta = dataISO.replaceAll('-', '');
  return `${C.BASE}/${dataISO}/BDI_${capitulo}_${compacta}.pdf`;
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
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Localiza o bloco da tabela. Devolve {achou, ancora, bloco}. Nunca chuta. */
export function extrairBloco(texto, ancoras = C.ANCORAS, linhasDepois = 30) {
  const linhas = texto.split('\n');
  const alvo = ancoras.map(normalizar);
  for (let i = 0; i < linhas.length; i++) {
    const n = normalizar(linhas[i]);
    const hit = alvo.find((a) => n.includes(a));
    if (hit) {
      return { achou: true, ancora: hit, linha: i,
               bloco: linhas.slice(i, i + linhasDepois).join('\n') };
    }
  }
  return { achou: false, ancora: null, linha: -1, bloco: '' };
}

/**
 * Parser de tentativa. Assume layout em colunas preservado por `pdftotext -layout`.
 * Devolve linhas {categoria, nums[]} SEM nomear as colunas — nomear coluna é
 * decisão que só se toma depois de olhar o dump bruto (Q8).
 */
export function parsearLinhas(bloco) {
  const out = [];
  for (const linha of bloco.split('\n')) {
    const n = normalizar(linha);
    if (!n || n.length < 4) continue;
    const nums = (linha.match(/\(?-?[\d.]+,\d{1,2}\)?|\(?-?[\d.]{4,}\)?/g) || [])
      .map(parseNumBR).filter((v) => v !== null);
    if (nums.length < 2) continue;
    const categoria = linha.replace(/[\d.,()%-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (categoria.length < 3) continue;
    out.push({ categoria: normalizar(categoria), nums });
  }
  return out;
}

/**
 * Q4 — O TESTE DECISIVO.
 * Recebe o mesmo campo em 3 dias úteis consecutivos do MESMO mês.
 * Acumulada: |v| cresce monotonicamente e v3 ≈ v1 + deltas (nunca encolhe em módulo).
 * Diária: os valores oscilam de sinal ou encolhem em módulo.
 */
export function classificarCadencia(v1, v2, v3) {
  if ([v1, v2, v3].some((v) => typeof v !== 'number' || !isFinite(v))) {
    return 'indeterminado';
  }
  const cresceEmModulo = Math.abs(v2) >= Math.abs(v1) && Math.abs(v3) >= Math.abs(v2);
  const mesmoSinal = Math.sign(v1) === Math.sign(v2) && Math.sign(v2) === Math.sign(v3);
  if (cresceEmModulo && mesmoSinal) return 'provavelmente_acumulada';
  return 'provavelmente_diaria';
}

/** Q7 — invariante contábil: a soma dos saldos líquidos por dia tende a zero. */
export function somaZero(saldos, tolRel = C.SOMA_ZERO_TOL_REL) {
  const soma = saldos.reduce((a, b) => a + b, 0);
  const escala = saldos.reduce((a, b) => a + Math.abs(b), 0);
  if (escala === 0) return { fecha: false, soma, escala, razao: null };
  const razao = Math.abs(soma) / escala;
  return { fecha: razao <= tolRel, soma, escala, razao };
}

/** Q6 — ordem de grandeza. Volume diário da B3 à vista ~ R$ 20–40 bilhões. */
export function inferirUnidade(totalNegociado) {
  if (typeof totalNegociado !== 'number' || !isFinite(totalNegociado)) return 'indeterminada';
  const a = Math.abs(totalNegociado);
  if (a >= 1e9 && a < 1e12) return 'R$ (unidade)';
  if (a >= 1e6 && a < 1e9) return 'R$ mil';
  if (a >= 1e3 && a < 1e6) return 'R$ milhões';
  return 'indeterminada';
}

// =============================================================================
// SELF-TEST (offline, sem rede)
// =============================================================================

function selftest() {
  let pass = 0, fail = 0;
  const ok = (nome, cond) => {
    if (cond) { pass++; console.log(`PASS  ${nome}`); }
    else { fail++; console.log(`FAIL  ${nome}`); }
  };

  ok('urlBDI monta o padrão da semente verificada',
    urlBDI('2025-03-28', '02') ===
    'https://arquivos.b3.com.br/bdi/download/bdi/2025-03-28/BDI_02_20250328.pdf');

  ok('parseNumBR milhar+decimal BR', parseNumBR('1.234.567,89') === 1234567.89);
  ok('parseNumBR parênteses = negativo', parseNumBR('(1.240,50)') === -1240.5);
  ok('parseNumBR hífen = nulo', parseNumBR('-') === null);
  ok('parseNumBR lixo = nulo', parseNumBR('n/d') === null);
  ok('normalizar remove acento e caixa',
    normalizar('  Participação  dos Investidores ') === 'PARTICIPACAO DOS INVESTIDORES');

  const textoFake = [
    'BOLETIM DIARIO DO MERCADO',
    'INDICADORES E INFORMATIVOS',
    'PARTICIPAÇÃO DOS INVESTIDORES',
    'Tipo                     Compras      Vendas       Saldo',
    'Investidor Estrangeiro   8.120.400    9.360.400    (1.240.000)',
    'Institucionais           7.410.200    6.590.200    820.000',
    'Pessoas Físicas          5.240.100    4.930.100    310.000',
    'Instituições Financeiras 1.980.300    1.900.300    80.000',
    'Outros                     640.500      610.500     30.000',
    'RODAPE QUALQUER',
  ].join('\n');

  const b = extrairBloco(textoFake);
  ok('extrairBloco acha a âncora', b.achou === true);
  ok('extrairBloco devolve a tabela junto', b.bloco.includes('Investidor Estrangeiro'));
  ok('extrairBloco sem âncora reporta ausência',
    extrairBloco('texto sem nada disso aqui').achou === false);

  const linhas = parsearLinhas(b.bloco);
  ok('parsearLinhas acha 5 categorias', linhas.length === 5);
  ok('parsearLinhas preserva o negativo entre parênteses',
    linhas[0].nums[linhas[0].nums.length - 1] === -1240000);
  ok('parsearLinhas ignora cabeçalho sem número',
    !linhas.some((l) => l.categoria.includes('COMPRAS')));

  const saldos = [-1240000, 820000, 310000, 80000, 30000];
  const sz = somaZero(saldos);
  ok('somaZero fecha no caso sintético', sz.fecha === true && sz.soma === 0);
  const szq = somaZero([-1240000, 820000, 310000, 80000, 900000]);
  ok('somaZero reprova dia quebrado', szq.fecha === false);
  ok('somaZero com escala zero não divide por zero',
    somaZero([0, 0, 0]).razao === null);

  ok('cadência: série acumulada é detectada',
    classificarCadencia(-1240000, -2100000, -3050000) === 'provavelmente_acumulada');
  ok('cadência: série diária é detectada',
    classificarCadencia(-1240000, 430000, -220000) === 'provavelmente_diaria');
  ok('cadência: encolher em módulo indica diária',
    classificarCadencia(-3050000, -2100000, -1240000) === 'provavelmente_diaria');
  ok('cadência: valor faltante vira indeterminado',
    classificarCadencia(-1240000, null, -220000) === 'indeterminado');

  ok('unidade: 24 bi em reais', inferirUnidade(24_000_000_000) === 'R$ (unidade)');
  ok('unidade: 24 mi em R$ mil', inferirUnidade(24_000_000) === 'R$ mil');
  ok('unidade: NaN é indeterminada', inferirUnidade(NaN) === 'indeterminada');

  console.log(`\nnexo_b3_probe v0.1 self-test ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

// =============================================================================
// PARTE AO VIVO
// =============================================================================

function temPdftotext() {
  try {
    const v = execFileSync('pdftotext', ['-v'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, versao: String(v).trim().split('\n')[0] || 'desconhecida' };
  } catch (e) {
    try {
      const v = execFileSync('bash', ['-lc', 'pdftotext -v 2>&1 | head -1'], { encoding: 'utf8' });
      return { ok: /pdftotext/i.test(v), versao: v.trim() };
    } catch { return { ok: false, versao: null, erro: String(e.message) }; }
  }
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function baixar(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), C.TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, tipo: r.headers.get('content-type'), bytes: buf.length, buf };
  } catch (e) {
    return { status: 0, tipo: null, bytes: 0, buf: null, erro: String(e.message) };
  } finally { clearTimeout(t); }
}

function ehPDF(buf) {
  // Magic byte. O aprendizado do RAD/CVM vale aqui: content-type mente.
  return !!buf && buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF';
}

function extrairTexto(caminhoPdf, layout = true) {
  const saida = caminhoPdf.replace(/\.pdf$/, layout ? '.layout.txt' : '.raw.txt');
  const args = layout ? ['-layout', caminhoPdf, saida] : [caminhoPdf, saida];
  try {
    execFileSync('pdftotext', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    return existsSync(saida) ? readFileSync(saida, 'utf8') : null;
  } catch (e) { return null; }
}

async function aoVivo() {
  console.log('# nexo_b3_probe v0.1 — relatório');
  console.log(`# gerado em ${new Date().toISOString()}`);
  console.log(`# node ${process.version}\n`);

  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });

  // --- Q3 (antecipado): sem pdftotext, nada abaixo funciona.
  const pt = temPdftotext();
  console.log('## Q3 — pdftotext');
  console.log(`pdftotext disponível: ${pt.ok}`);
  console.log(`versão: ${pt.versao ?? 'n/d'}`);
  if (!pt.ok) {
    console.log('AÇÃO: instalar com `sudo apt-get update && sudo apt-get install -y poppler-utils`');
    console.log('O probe continua e baixa os PDFs, mas não extrai texto.\n');
  } else { console.log(''); }

  // --- Q1: qual capítulo serve a tabela?
  console.log('## Q1 — padrão de URL e capítulo');
  const dataRef = DATAS_CONSECUTIVAS[DATAS_CONSECUTIVAS.length - 1];
  let capituloBom = null;
  for (const cap of C.CAPITULOS) {
    const url = urlBDI(dataRef, cap);
    const r = await baixar(url);
    const pdf = ehPDF(r.buf);
    console.log(`cap ${cap}: HTTP ${r.status} | ${r.bytes} bytes | pdf=${pdf} | ${r.tipo ?? ''}${r.erro ? ' | ' + r.erro : ''}`);
    if (r.status === 200 && pdf) {
      const caminho = `${RAW_DIR}/BDI_${cap}_${dataRef}.pdf`;
      writeFileSync(caminho, r.buf);
      if (pt.ok && !capituloBom) {
        const txt = extrairTexto(caminho, true);
        if (txt && extrairBloco(txt).achou) {
          capituloBom = cap;
          console.log(`  -> âncora da tabela ENCONTRADA no capítulo ${cap}`);
        } else {
          console.log(`  -> âncora NÃO encontrada neste capítulo`);
        }
      }
    }
    await pausa(C.PAUSA_MS);
  }
  console.log(`capítulo eleito: ${capituloBom ?? 'NENHUM — ver dump do Q8'}\n`);

  // --- Controles negativos
  console.log('## Q1b — controles negativos (não deve existir arquivo)');
  for (const d of DATAS_CONTROLE) {
    const r = await baixar(urlBDI(d, capituloBom ?? '02'));
    console.log(`${d}: HTTP ${r.status} | pdf=${ehPDF(r.buf)} | ${r.bytes} bytes`);
    await pausa(C.PAUSA_MS);
  }
  console.log('');

  // --- Q2: profundidade histórica
  console.log('## Q2 — até onde o arquivo por data volta');
  for (const d of DATAS_HISTORICO) {
    const r = await baixar(urlBDI(d, capituloBom ?? '02'));
    console.log(`${d}: HTTP ${r.status} | ${r.bytes} bytes | pdf=${ehPDF(r.buf)}`);
    if (r.status === 200 && ehPDF(r.buf)) {
      writeFileSync(`${RAW_DIR}/BDI_hist_${d}.pdf`, r.buf);
    }
    await pausa(C.PAUSA_MS);
  }
  console.log('NOTA: backfill desde 2010 só é viável se as datas antigas voltarem 200.\n');

  // --- Q4 a Q7: três dias consecutivos
  console.log('## Q4–Q7 — cadência, categorias, unidade, soma-zero');
  const extraidos = [];
  for (const d of DATAS_CONSECUTIVAS) {
    const r = await baixar(urlBDI(d, capituloBom ?? '02'));
    if (r.status !== 200 || !ehPDF(r.buf)) {
      console.log(`${d}: indisponível (HTTP ${r.status}) — dia sem pregão?`);
      await pausa(C.PAUSA_MS);
      continue;
    }
    const caminho = `${RAW_DIR}/BDI_dia_${d}.pdf`;
    writeFileSync(caminho, r.buf);
    const txt = pt.ok ? extrairTexto(caminho, true) : null;
    if (!txt) { console.log(`${d}: PDF salvo, texto não extraído`); await pausa(C.PAUSA_MS); continue; }
    const bloco = extrairBloco(txt);
    const linhas = bloco.achou ? parsearLinhas(bloco.bloco) : [];
    extraidos.push({ data: d, bloco, linhas });
    console.log(`${d}: âncora=${bloco.achou} | linhas com números=${linhas.length}`);
    await pausa(C.PAUSA_MS);
  }
  console.log('');

  // Q5 — categorias
  console.log('### Q5 — categorias encontradas (nomes exatos, como vieram)');
  if (extraidos.length === 0) {
    console.log('nenhuma extração bem-sucedida — ver Q8');
  } else {
    for (const l of extraidos[extraidos.length - 1].linhas) {
      console.log(`  "${l.categoria}"  -> ${l.nums.length} números: ${l.nums.join(' | ')}`);
    }
    const achadas = extraidos[extraidos.length - 1].linhas.map((l) => l.categoria);
    const faltando = C.CATEGORIAS_ESPERADAS.filter(
      (e) => !achadas.some((a) => a.includes(e.split(' ')[0])));
    console.log(`esperadas e não encontradas: ${faltando.length ? faltando.join(', ') : 'nenhuma'}`);
  }
  console.log('');

  // Q4 — cadência, por categoria, usando a ÚLTIMA coluna numérica de cada linha
  console.log('### Q4 — DIÁRIA ou ACUMULADA? (o teste que decide o módulo)');
  if (extraidos.length < 3) {
    console.log(`INDETERMINADO: só ${extraidos.length} de 3 dias extraídos.`);
  } else {
    const [a, b2, c3] = extraidos;
    const chave = (e, cat) => {
      const l = e.linhas.find((x) => x.categoria.includes(cat));
      return l ? l.nums[l.nums.length - 1] : null;
    };
    for (const l of c3.linhas) {
      const cat = l.categoria;
      const v = [chave(a, cat), chave(b2, cat), chave(c3, cat)];
      console.log(`  ${cat}: ${v.join(' -> ')}  ==> ${classificarCadencia(...v)}`);
    }
    console.log('LEITURA: se der "acumulada", o fluxo diário é a DIFERENÇA entre dias');
    console.log('consecutivos, e o primeiro dia útil do mês é o próprio valor.');
  }
  console.log('');

  // Q6 e Q7
  console.log('### Q6/Q7 — unidade e invariante soma-zero');
  if (extraidos.length) {
    const ult = extraidos[extraidos.length - 1];
    const saldos = ult.linhas.map((l) => l.nums[l.nums.length - 1]).filter((v) => v !== null);
    const soma = somaZero(saldos);
    console.log(`saldos: ${saldos.join(' | ')}`);
    console.log(`soma=${soma.soma} | escala=${soma.escala} | razão=${soma.razao}`);
    console.log(`fecha com tol ${C.SOMA_ZERO_TOL_REL}? ${soma.fecha}`);
    const totalCompras = ult.linhas.reduce((s, l) => s + Math.abs(l.nums[0] ?? 0), 0);
    console.log(`total de compras (col. 1): ${totalCompras}`);
    console.log(`unidade inferida: ${inferirUnidade(totalCompras)} (hipótese: ${C.UNIDADE_HIPOTESE})`);
  } else { console.log('sem dados'); }
  console.log('');

  // Q8 — o dump cru. É o item mais importante do relatório.
  console.log('## Q8 — DUMP BRUTO DO BLOCO (inspeção humana obrigatória)');
  console.log('# pdftotext embaralha tabela. Este dump existe para decidir se o');
  console.log('# parser em Node serve ou se a tabela precisa ir para o Docling.');
  if (extraidos.length) {
    const ult = extraidos[extraidos.length - 1];
    console.log(`--- INÍCIO DUMP (${ult.data}, âncora "${ult.bloco.ancora}") ---`);
    console.log(ult.bloco.bloco);
    console.log('--- FIM DUMP ---');
  } else {
    console.log('Nenhum bloco extraído. Os PDFs estão em ' + RAW_DIR);
    console.log('Rode à mão para ver o que veio:');
    console.log(`  pdftotext -layout ${RAW_DIR}/BDI_02_${dataRef}.pdf - | head -120`);
  }
  console.log('\n# fim do relatório');
}

// =============================================================================
if (SELFTEST) selftest();
else aoVivo().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
