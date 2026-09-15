#!/usr/bin/env node
// =============================================================================
// nexo_dpm_probe.mjs — Probe das fontes do DPM (Decisões de Política Monetária)
// -----------------------------------------------------------------------------
// Objetivo: OBSERVAR as fontes antes de hardcodar constantes no coletor
// dpm_collector.mjs. Não grava nada em data/, não toca produção, não roda na
// Vercel. Cloud Shell apenas. Não precisa de token (FRED via CSV público).
//
// Uso:
//   NEXO_SELFTEST=1 node nexo_dpm_probe.mjs              # offline, sem rede
//   node nexo_dpm_probe.mjs > dpm_probe_out.txt           # ao vivo
//
// Saídas:
//   stdout             -> relatório (devolver ao Claude)
//   ./dpm_probe_raw/   -> corpos brutos (auditoria; NÃO commitar)
//
// Perguntas que o probe responde:
//   Q1 API Copom: formato e campos da lista de atas (nº da reunião, datas)
//   Q2 API Copom: nomes reais dos endpoints de comunicados (lista e detalhe)
//   Q3 Texto do comunicado: HTML ou texto puro? regex "unanimidade" casa?
//   Q4 Olinda/Focus: nomes das entidades, campos e formato da reunião ("R5/2026"?)
//   Q5 SGS 432/433/13522: última data e defasagem aparente
//   Q6 SGS 432 x reuniões Copom: a meta muda quantos dias após a decisão?
//   Q7 FRED DFEDTARU/DFEDTARL/DGS2: cobertura e datas de mudança do teto
//
// Zero dependências. Node >= 18 (fetch nativo).
// =============================================================================

import { mkdirSync, writeFileSync } from "node:fs";

const PROBE_VERSION = "NEXO dpm probe v0.1";
const TIMEOUT_MS = 30000;
const RAW_DIR = "dpm_probe_raw";

const COPOM_BASE = "https://www.bcb.gov.br/api/servico/sitebcb/copom";
const OLINDA_ROOT = "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/";
const SGS_BASE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=";

const COMUNICADOS_LISTA_CANDIDATOS = ["/comunicados?quantidade=10", "/comunicado?quantidade=10"];
const COMUNICADOS_DETALHE_CANDIDATOS = ["/comunicados_detalhes?nro_reuniao=", "/comunicado_detalhes?nro_reuniao="];

const OLINDA_CANDIDATOS = [
  { entidade: "ExpectativasMercadoSelic", filtro: null, uso: "N1/D1 — Selic por reunião" },
  { entidade: "ExpectativaMercadoMensais", filtro: "Indicador eq 'IPCA'", uso: "D2 — IPCA do mês" },
  { entidade: "ExpectativasMercadoInflacao12Meses", filtro: "Indicador eq 'IPCA'", uso: "N2 — IPCA 12m" },
  { entidade: "ExpectativasMercadoAnuais", filtro: "Indicador eq 'Selic'", uso: "N1 — Selic fim de ano" },
];

// ATENÇÃO: o SGS exige dataInicial/dataFinal (desde mar/2025) e limita séries
// diárias a janelas de até 10 anos. Por isso 3 anos para a diária.
const SGS_SERIES = [
  { codigo: 432, apelido: "selic_meta", anos: 3 },
  { codigo: 433, apelido: "ipca_mensal", anos: 10 },
  { codigo: 13522, apelido: "ipca_12m", anos: 10 },
];

const FRED_SERIES = ["DFEDTARU", "DFEDTARL", "DGS2"];

// -----------------------------------------------------------------------------
// Helpers puros (cobertos pelo self-test)
// -----------------------------------------------------------------------------

export function fmtBR(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export function parseBR(s) {
  const [d, m, a] = String(s).split("/").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function parseISODate(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export function diasEntre(a, b) {
  return Math.round((b - a) / 86400000);
}

export function extractArray(json) {
  if (Array.isArray(json)) return { arr: json, via: "raiz" };
  if (json && typeof json === "object") {
    for (const k of ["conteudo", "value", "data", "items", "resultado"]) {
      if (Array.isArray(json[k])) return { arr: json[k], via: k };
    }
    for (const [k, v] of Object.entries(json)) {
      if (Array.isArray(v)) return { arr: v, via: k };
    }
  }
  return { arr: [], via: "nenhum" };
}

export function findNroReuniao(item) {
  if (!item || typeof item !== "object") return null;
  for (const [k, v] of Object.entries(item)) {
    if (/nro|reuniao|numero/i.test(k)) {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return null;
}

export function findDateFields(item) {
  const out = {};
  if (!item || typeof item !== "object") return out;
  for (const [k, v] of Object.entries(item)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) out[k] = v.slice(0, 10);
  }
  return out;
}

export function findLongestString(obj, best = { key: null, val: "" }, path = "") {
  if (typeof obj === "string") {
    if (obj.length > best.val.length) return { key: path || "(raiz)", val: obj };
    return best;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      best = findLongestString(v, best, path ? `${path}.${k}` : k);
    }
  }
  return best;
}

export function looksHTML(s) {
  return /<\/?[a-z][^>]*>/i.test(String(s));
}

export function stripHTML(s) {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function semAcento(s) {
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function temUnanimidade(texto) {
  return /unanimidade|unanime/.test(semAcento(texto));
}

export function parseFredCSV(text) {
  const linhas = String(text).trim().split(/\r?\n/);
  if (linhas.length < 2) return [];
  const out = [];
  for (const l of linhas.slice(1)) {
    const [d, v] = l.split(",");
    const date = parseISODate(d);
    if (!date) continue;
    const num = v === undefined || v.trim() === "." || v.trim() === "" ? null : Number(v);
    out.push({ date, value: Number.isFinite(num) ? num : null });
  }
  return out;
}

export function detectChanges(serie) {
  const out = [];
  let prev = null;
  for (const p of serie) {
    if (p.value === null) continue;
    if (prev !== null && p.value !== prev.value) out.push({ date: p.date, from: prev.value, to: p.value });
    prev = p;
  }
  return out;
}

// Para cada mudança, a reunião mais recente com data <= data da mudança.
export function offsetsMudancaVsReuniao(mudancas, datasReuniao) {
  const ords = [...datasReuniao].sort((a, b) => a - b);
  return mudancas.map((m) => {
    let alvo = null;
    for (const d of ords) if (d <= m.date) alvo = d;
    return { mudanca: m.date, reuniao: alvo, dias: alvo ? diasEntre(alvo, m.date) : null };
  });
}

export function buildOlindaUrl(entidade, { top = 3, orderby = "Data desc", filtro = null } = {}) {
  let q = `?$top=${top}&$format=json`;
  if (orderby) q += `&$orderby=${encodeURIComponent(orderby)}`;
  if (filtro) q += `&$filter=${encodeURIComponent(filtro)}`;
  return `${OLINDA_ROOT}${entidade}${q}`;
}

export function trunc(s, n = 160) {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

// -----------------------------------------------------------------------------
// Rede
// -----------------------------------------------------------------------------

let rawSeq = 0;
function salvarBruto(nome, body) {
  try {
    mkdirSync(RAW_DIR, { recursive: true });
    rawSeq += 1;
    writeFileSync(`${RAW_DIR}/${String(rawSeq).padStart(2, "0")}_${nome}`, body);
  } catch {
    /* auditoria é best-effort */
  }
}

async function fetchText(url, nomeBruto) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json, text/csv, */*" }, signal: ctrl.signal });
    const body = await res.text();
    if (nomeBruto) salvarBruto(nomeBruto, body);
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type") || "?", body };
  } catch (e) {
    return { ok: false, status: 0, contentType: "?", body: "", erro: `${e.name}: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// Lição do RAD/CVM: não confiar no content-type — inspecionar o corpo.
function tentarJSON(body) {
  const head = String(body).trimStart().slice(0, 1);
  if (head !== "[" && head !== "{") return { json: null, erro: `corpo não parece JSON (1º char='${head}')` };
  try {
    return { json: JSON.parse(body), erro: null };
  } catch (e) {
    return { json: null, erro: `JSON inválido: ${e.message}` };
  }
}

const L = (s = "") => console.log(s);
const SEP = "─".repeat(78);

// -----------------------------------------------------------------------------
// Seções do relatório
// -----------------------------------------------------------------------------

async function secaoAtas(resumo) {
  L(SEP);
  L("Q1 — API Copom: lista de atas");
  const url = `${COPOM_BASE}/atas?quantidade=10`;
  const r = await fetchText(url, "copom_atas.json");
  L(`  GET ${url}`);
  L(`  HTTP ${r.status} content-type=${r.contentType}${r.erro ? ` erro=${r.erro}` : ""}`);
  if (!r.ok) { resumo.Q1 = "FALHA"; return { reunioes: [] }; }
  const { json, erro } = tentarJSON(r.body);
  if (erro) { L(`  ${erro}`); resumo.Q1 = "FALHA"; return { reunioes: [] }; }
  const { arr, via } = extractArray(json);
  L(`  chaves de topo: ${Array.isArray(json) ? "(array)" : Object.keys(json).join(", ")}`);
  L(`  array em: ${via} | itens: ${arr.length}`);
  if (arr[0]) L(`  chaves do item: ${Object.keys(arr[0]).join(", ")}`);
  arr.slice(0, 3).forEach((it, i) => L(`  item[${i}]: ${trunc(it, 300)}`));
  const reunioes = arr
    .map((it) => ({ nro: findNroReuniao(it), datas: findDateFields(it) }))
    .filter((x) => x.nro);
  L(`  reuniões identificadas: ${reunioes.map((x) => `${x.nro} ${JSON.stringify(x.datas)}`).join(" | ") || "nenhuma"}`);
  resumo.Q1 = reunioes.length ? "OK" : "PARCIAL (nº da reunião não identificado)";

  if (reunioes[0]) {
    const u2 = `${COPOM_BASE}/atas_detalhes?nro_reuniao=${reunioes[0].nro}`;
    const r2 = await fetchText(u2, "copom_atas_detalhes.json");
    L(`  GET ${u2} -> HTTP ${r2.status}`);
    const j2 = tentarJSON(r2.body);
    if (j2.json) {
      const { arr: a2 } = extractArray(j2.json);
      const alvo = a2[0] || j2.json;
      L(`  chaves do detalhe: ${Object.keys(alvo).join(", ")}`);
      const longo = findLongestString(alvo);
      L(`  maior campo de texto: ${longo.key} (${longo.val.length} chars, HTML=${looksHTML(longo.val)})`);
    }
  }
  return { reunioes };
}

async function secaoComunicados(resumo) {
  L(SEP);
  L("Q2 — API Copom: endpoints de comunicados");
  let lista = null;
  let rotaLista = null;
  for (const c of COMUNICADOS_LISTA_CANDIDATOS) {
    const url = `${COPOM_BASE}${c}`;
    const r = await fetchText(url, `copom_lista_${c.split("?")[0].slice(1)}.json`);
    const j = r.ok ? tentarJSON(r.body) : { json: null };
    const { arr } = j.json ? extractArray(j.json) : { arr: [] };
    L(`  ${c.padEnd(32)} -> HTTP ${r.status} itens=${arr.length}`);
    if (arr.length && !lista) { lista = arr; rotaLista = c; }
  }
  if (!lista) { resumo.Q2 = "FALHA (nenhum endpoint de lista respondeu)"; resumo.Q3 = "não testado"; return; }
  L(`  rota de lista válida: ${rotaLista}`);
  L(`  chaves do item: ${Object.keys(lista[0]).join(", ")}`);
  lista.slice(0, 2).forEach((it, i) => L(`  item[${i}]: ${trunc(it, 300)}`));
  const nro = findNroReuniao(lista[0]);
  if (!nro) { resumo.Q2 = `PARCIAL (lista ${rotaLista}; nº da reunião não identificado)`; resumo.Q3 = "não testado"; return; }

  L(SEP);
  L(`Q3 — texto do comunicado (reunião ${nro})`);
  let detalhe = null;
  let rotaDet = null;
  for (const c of COMUNICADOS_DETALHE_CANDIDATOS) {
    const url = `${COPOM_BASE}${c}${nro}`;
    const r = await fetchText(url, `copom_det_${c.split("?")[0].slice(1)}.json`);
    const j = r.ok ? tentarJSON(r.body) : { json: null };
    L(`  ${(c + nro).padEnd(40)} -> HTTP ${r.status}${j.json ? " JSON" : ""}`);
    if (j.json && !detalhe) { detalhe = j.json; rotaDet = c; }
  }
  if (!detalhe) { resumo.Q2 = `PARCIAL (lista ${rotaLista}; detalhe não respondeu)`; resumo.Q3 = "FALHA"; return; }
  resumo.Q2 = `OK (lista ${rotaLista} | detalhe ${rotaDet}<nro>)`;
  const { arr } = extractArray(detalhe);
  const alvo = arr[0] || detalhe;
  L(`  chaves do detalhe: ${Object.keys(alvo).join(", ")}`);
  const longo = findLongestString(alvo);
  const html = looksHTML(longo.val);
  const limpo = html ? stripHTML(longo.val) : longo.val;
  L(`  maior campo de texto: ${longo.key} | ${longo.val.length} chars | HTML=${html}`);
  L(`  regex "unanimidade" casa? ${temUnanimidade(limpo)}`);
  L(`  início (limpo): ${trunc(limpo, 400)}`);
  resumo.Q3 = `OK (campo ${longo.key}, HTML=${html}, unanimidade=${temUnanimidade(limpo)})`;
}

async function secaoOlinda(resumo) {
  L(SEP);
  L("Q4 — Olinda / Focus");
  const rRoot = await fetchText(`${OLINDA_ROOT}?$format=json`, "olinda_root.json");
  L(`  GET raiz do serviço -> HTTP ${rRoot.status}`);
  const jRoot = rRoot.ok ? tentarJSON(rRoot.body) : { json: null };
  if (jRoot.json) {
    const { arr } = extractArray(jRoot.json);
    const nomes = arr.map((x) => x.name || x.url || trunc(x, 60));
    L(`  entidades publicadas (${nomes.length}): ${nomes.join(", ")}`);
  } else {
    L("  raiz não retornou JSON (seguindo com os candidatos)");
  }
  const status = [];
  for (const c of OLINDA_CANDIDATOS) {
    L(`  · ${c.entidade}  [${c.uso}]`);
    let r = await fetchText(buildOlindaUrl(c.entidade, { filtro: c.filtro }), `olinda_${c.entidade}.json`);
    let j = r.ok ? tentarJSON(r.body) : { json: null };
    if (!j.json) {
      r = await fetchText(buildOlindaUrl(c.entidade, { filtro: c.filtro, orderby: null }), `olinda_${c.entidade}_semorder.json`);
      j = r.ok ? tentarJSON(r.body) : { json: null };
      L(`    (sem $orderby) HTTP ${r.status}`);
    } else {
      L(`    HTTP ${r.status}`);
    }
    const { arr } = j.json ? extractArray(j.json) : { arr: [] };
    if (!arr.length) { L("    sem linhas"); status.push(`${c.entidade}=FALHA`); continue; }
    L(`    campos: ${Object.keys(arr[0]).join(", ")}`);
    arr.slice(0, 3).forEach((it, i) => L(`    linha[${i}]: ${trunc(it, 260)}`));
    const reuniao = arr.map((x) => x.Reuniao ?? x.reuniao).filter(Boolean);
    if (reuniao.length) L(`    formato do campo Reuniao: ${[...new Set(reuniao)].join(" | ")}`);
    status.push(`${c.entidade}=OK`);
  }
  resumo.Q4 = status.join("; ");
}

async function secaoSGS(resumo, reunioes) {
  L(SEP);
  L("Q5 — SGS: cobertura e defasagem aparente");
  const hoje = new Date();
  let serie432 = null;
  const st = [];
  for (const s of SGS_SERIES) {
    const ini = new Date(Date.UTC(hoje.getUTCFullYear() - s.anos, hoje.getUTCMonth(), hoje.getUTCDate()));
    const url = `${SGS_BASE}.${s.codigo}/dados?formato=json&dataInicial=${fmtBR(ini)}&dataFinal=${fmtBR(hoje)}`;
    const r = await fetchText(url, `sgs_${s.codigo}.json`);
    const j = r.ok ? tentarJSON(r.body) : { json: null };
    if (!Array.isArray(j.json) || !j.json.length) {
      L(`  SGS ${s.codigo} (${s.apelido}) -> HTTP ${r.status} FALHA ${j.erro || ""}`);
      st.push(`${s.codigo}=FALHA`);
      continue;
    }
    const pts = j.json.map((x) => ({ date: parseBR(x.data), value: Number(String(x.valor).replace(",", ".")) }));
    const ult = pts[pts.length - 1];
    L(`  SGS ${s.codigo} (${s.apelido}) n=${pts.length} primeira=${fmtBR(pts[0].date)} última=${fmtBR(ult.date)} ` +
      `defasagem_aparente=${diasEntre(ult.date, hoje)}d últimos=${pts.slice(-3).map((p) => p.value).join(" | ")}`);
    st.push(`${s.codigo}=OK`);
    if (s.codigo === 432) serie432 = pts;
  }
  resumo.Q5 = st.join("; ");

  L(SEP);
  L("Q6 — SGS 432 x reuniões Copom (vigência da meta)");
  if (!serie432) { resumo.Q6 = "não testado (432 falhou)"; return; }
  const mud = detectChanges(serie432);
  L(`  mudanças da meta em 3 anos: ${mud.length}`);
  mud.slice(-8).forEach((m) => L(`    ${fmtBR(m.date)}: ${m.from} -> ${m.to}`));
  const datas = [];
  for (const r of reunioes) {
    for (const v of Object.values(r.datas)) {
      const d = parseISODate(v);
      if (d) datas.push(d);
    }
  }
  if (!datas.length) {
    L("  sem datas de reunião na lista de atas — offset não calculável (reportar campos de data)");
    resumo.Q6 = "PARCIAL (sem datas de reunião)";
    return;
  }
  L(`  datas candidatas vindas da API Copom: ${[...new Set(datas.map(fmtBR))].join(", ")}`);
  const offs = offsetsMudancaVsReuniao(mud, datas).filter((o) => o.reuniao);
  offs.slice(-8).forEach((o) => L(`    mudança ${fmtBR(o.mudanca)} <- data API ${fmtBR(o.reuniao)} (+${o.dias}d)`));
  resumo.Q6 = offs.length
    ? `OK (offsets: ${[...new Set(offs.map((o) => o.dias))].join(", ")} dias — conferir qual campo de data é a decisão)`
    : "PARCIAL (nenhuma mudança casou com datas da API)";
}

async function secaoFRED(resumo) {
  L(SEP);
  L("Q7 — FRED (CSV público, sem chave)");
  const st = [];
  for (const id of FRED_SERIES) {
    const r = await fetchText(`${FRED_CSV}${id}`, `fred_${id}.csv`);
    const pts = r.ok ? parseFredCSV(r.body) : [];
    const validos = pts.filter((p) => p.value !== null);
    if (!validos.length) { L(`  ${id} -> HTTP ${r.status} FALHA`); st.push(`${id}=FALHA`); continue; }
    const ult = validos[validos.length - 1];
    L(`  ${id} n=${validos.length} primeira=${validos[0].date.toISOString().slice(0, 10)} ` +
      `última=${ult.date.toISOString().slice(0, 10)} valor=${ult.value}`);
    if (id === "DFEDTARU") {
      const corte = new Date(Date.now() - 3 * 365 * 86400000);
      const mud = detectChanges(validos).filter((m) => m.date >= corte);
      L(`    mudanças do teto em 3 anos: ${mud.length}`);
      mud.forEach((m) => L(`      ${m.date.toISOString().slice(0, 10)}: ${m.from} -> ${m.to}`));
    }
    st.push(`${id}=OK`);
  }
  resumo.Q7 = st.join("; ");
}

async function runLive() {
  L(`# ${PROBE_VERSION}`);
  L(`# executado em ${new Date().toISOString()} | node ${process.version}`);
  const resumo = {};
  const { reunioes } = await secaoAtas(resumo);
  await secaoComunicados(resumo);
  await secaoOlinda(resumo);
  await secaoSGS(resumo, reunioes);
  await secaoFRED(resumo);
  L(SEP);
  L("RESUMO");
  for (const q of ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]) L(`  ${q}: ${resumo[q] ?? "não executado"}`);
  L(SEP);
  L("# fim do relatório");
  console.error(`[ok] relatório no stdout; brutos em ./${RAW_DIR}/ (não commitar)`);
}

// -----------------------------------------------------------------------------
// Self-test offline (NEXO_SELFTEST=1)
// -----------------------------------------------------------------------------

function selfTest() {
  const res = [];
  const t = (nome, cond) => res.push({ nome, ok: !!cond });

  t("fmtBR formata dd/mm/aaaa", fmtBR(new Date(Date.UTC(2026, 0, 5))) === "05/01/2026");
  t("parseBR ida e volta", fmtBR(parseBR("28/02/2026")) === "28/02/2026");
  t("parseISODate corta horário", parseISODate("2026-08-11T03:00:00Z").getUTCDate() === 11);
  t("diasEntre", diasEntre(parseBR("01/08/2026"), parseBR("11/08/2026")) === 10);
  t("extractArray raiz", extractArray([1, 2]).via === "raiz");
  t("extractArray conteudo", extractArray({ conteudo: [{ a: 1 }] }).via === "conteudo");
  t("extractArray OData value", extractArray({ "@odata.context": "x", value: [{ a: 1 }] }).via === "value");
  t("findNroReuniao", findNroReuniao({ nroReuniao: 271, titulo: "x" }) === 271);
  t("findNroReuniao ausente -> null", findNroReuniao({ titulo: "x" }) === null);
  t("findDateFields", findDateFields({ dataReferencia: "2026-07-30T03:00:00Z", t: "a" }).dataReferencia === "2026-07-30");
  t("findLongestString aninhado", findLongestString({ a: "x", b: { c: "texto longo" } }).key === "b.c");
  t("looksHTML verdadeiro", looksHTML("<p>O Copom decidiu</p>"));
  t("looksHTML falso", !looksHTML("O Copom decidiu, por unanimidade, manter"));
  t("stripHTML", stripHTML("<p>A&nbsp;<b>B</b></p>") === "A B");
  t("unanimidade sem acento/caixa", temUnanimidade("Decisão tomada por UNANIMIDADE."));
  t("unanimidade ausente", !temUnanimidade("votaram pela redução os membros"));
  const csv1 = "observation_date,DFEDTARU\n2024-09-17,5.5\n2024-09-18,5.0\n2024-09-19,.\n2024-09-20,5.0";
  const p1 = parseFredCSV(csv1);
  t("parseFredCSV header novo + '.' vira null", p1.length === 4 && p1[2].value === null);
  const csv2 = "DATE,DGS2\r\n2026-09-08,3.51\r\n2026-09-09,3.49";
  t("parseFredCSV header antigo + CRLF", parseFredCSV(csv2).length === 2);
  const mud = detectChanges(p1);
  t("detectChanges ignora null e acha 1 mudança", mud.length === 1 && mud[0].to === 5.0);
  const offs = offsetsMudancaVsReuniao(
    [{ date: parseBR("19/06/2025") }],
    [parseBR("18/06/2025"), parseBR("07/05/2025")]
  );
  t("offset mudança x reunião = +1d", offs[0].dias === 1);
  const u = buildOlindaUrl("ExpectativaMercadoMensais", { filtro: "Indicador eq 'IPCA'" });
  t("buildOlindaUrl codifica espaço e aspas", u.includes("%24") === false && u.includes("Indicador%20eq%20'IPCA'"));
  t("buildOlindaUrl sem orderby", !buildOlindaUrl("X", { orderby: null }).includes("orderby"));
  t("trunc", trunc("abcdef", 3) === "abc…");
  t("tentarJSON rejeita HTML", tentarJSON("<html>").json === null);

  const ok = res.filter((r) => r.ok).length;
  console.log(`# ${PROBE_VERSION} — SELF-TEST`);
  res.forEach((r) => console.log(`  ${r.ok ? "✔" : "✘"} ${r.nome}`));
  console.log(`=== SELF-TEST: ${ok} passou, ${res.length - ok} falhou ===`);
  process.exit(ok === res.length ? 0 : 1);
}

if (process.env.NEXO_SELFTEST === "1") selfTest();
else await runLive();
