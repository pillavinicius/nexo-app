#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import PDFDocument from "pdfkit";

import { reconcileDeepIntegrity } from "../../lib/nexo/analysis/reclassification_integrity.mjs";
import { applyBibliotecaAudit, buildBibliotecaPromptContext, deriveExpectedDeepGaps, findBibliotecaMetricConflicts, formatBibliotecaTables, loadBibliotecaContext, selectBibliotecaChunks, selectBibliotecaDocuments } from "../../lib/nexo/biblioteca/context.mjs";
import { buildDocumentChunks, extractHtmlText, extractTableRows, parseDocument, parsePendingDocuments, selectRelevantPdfContent } from "../../lib/nexo/biblioteca/document_parser.mjs";
import { createBibliotecaRepository } from "../../lib/nexo/biblioteca/repository.mjs";
import { ingestUserSource, isPrivateAddress, validatePublicHttpsUrl } from "../../lib/nexo/biblioteca/url_ingestion.mjs";

function makePdf(text) {
  return new Promise((resolve) => {
    const document = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.fontSize(14).text(text);
    document.end();
  });
}

assert.match(extractHtmlText(Buffer.from("<html><script>não usar</script><h1>Resultado trimestral</h1><p>Lucro recorrente maior.</p></html>")), /Resultado trimestral\nLucro recorrente maior/);
const pdf = await makePdf("Documento oficial NEXO B3");
const parsedPdf = await parseDocument({ content: pdf, formato: "pdf" });
assert.equal(parsedPdf.status, "ok");
assert.match(parsedPdf.texto, /Documento oficial NEXO B3/);
assert.equal(parsedPdf.pageCount, 1);
assert.ok(parsedPdf.chunkCount >= 1);
assert.ok(globalThis.pdfjsWorker?.WorkerMessageHandler, "worker do pdf.js deve ser registrado explicitamente para o bundle serverless");

const alignedTable = extractTableRows([
  { str: "Cost of Credit", transform: [1, 0, 0, 1, 20, 250.3] },
  { str: "65", transform: [1, 0, 0, 1, 220, 246.3] },
  { str: "70", transform: [1, 0, 0, 1, 260, 246.3] },
  { str: "R$ 37.3bn", transform: [1, 0, 0, 1, 390, 247.4] },
  { str: "Adjusted Net Income", transform: [1, 0, 0, 1, 20, 170.1] },
  { str: "18", transform: [1, 0, 0, 1, 220, 167.0] },
  { str: "22", transform: [1, 0, 0, 1, 260, 167.0] },
  { str: "R$ 7.3bn", transform: [1, 0, 0, 1, 390, 168.6] },
], 4);
assert.deepEqual(alignedTable[0].rows[0], ["Cost of Credit", "65", "70", "R$ 37.3bn"], "fragmentos com pequenas variações de baseline devem permanecer na mesma linha da tabela");
assert.deepEqual(alignedTable[0].rows[1], ["Adjusted Net Income", "18", "22", "R$ 7.3bn"]);

const longPages = Array.from({ length: 80 }, (_, index) => ({
  number: index + 1,
  text: index === 65 ? "Inadimplência por carteira. New NPL pessoa física 5,2% e pessoa jurídica 3,1%." : `Conteúdo genérico ${index} `.repeat(400),
}));
const relevantLongPdf = selectRelevantPdfContent(longPages, [{ page: 66, rows: [["New NPL", "PF", "5,2%"]] }], ["inadimplência por carteira NPL"]);
assert.match(relevantLongPdf.texto, /New NPL pessoa física 5,2%/);
assert.deepEqual(relevantLongPdf.relevantPageNumbers, [66]);
assert.equal(relevantLongPdf.tabelas[0].page, 66);

const rankedDocuments = selectBibliotecaDocuments([
  ...Array.from({ length: 7 }, (_, index) => ({ dedup_key: `cvm_ipe:${index}`, fonte: "cvm_ipe", titulo: `Documento ${index}`, texto_corrido: "Conteúdo societário genérico." })),
  { dedup_key: "ri:npl", fonte: "ri", titulo: "Análise do Desempenho 2T26", texto_corrido: "New NPL por carteira: PF, PJ e Agro; inadimplência detalhada." },
], ["inadimplência por carteira NPL"]);
assert.equal(rankedDocuments[0].document.dedup_key, "ri:npl", "fonte RI pertinente deve superar o corte dos seis documentos");
assert.deepEqual(rankedDocuments[0].matches.map((match) => match.gap), ["inadimplência por carteira NPL"]);

const fullChunks = buildDocumentChunks([{ number: 58, text: `${"Contexto financeiro geral. ".repeat(100)} New NPL por carteira: PF 5,2%, PJ 3,1% e Agro 2,4%.` }]);
assert.ok(fullChunks.length > 1, "página extensa deve ser dividida em chunks rastreáveis");
const selectedChunks = selectBibliotecaChunks([
  { chunk_id: "ri:cost#00000", dedup_key: "ri:cost", fonte: "ri", titulo: "Análise 2T26", pagina_inicio: 52, pagina_fim: 52, texto: "Despesa com perda esperada e custo do crédito por segmento: agronegócio e pessoa física." },
  { chunk_id: "ri:npl#00000", dedup_key: "ri:npl", fonte: "ri", titulo: "Análise 2T26", pagina_inicio: 58, pagina_fim: 58, texto: "New NPL por carteira PF, PJ e Agro; inadimplência detalhada." },
  { chunk_id: "cvm:generic#00000", dedup_key: "cvm:generic", fonte: "cvm_ipe", titulo: "Ata", pagina_inicio: 1, pagina_fim: 1, texto: "Pauta societária genérica." },
], ["inadimplência por carteira NPL"]);
assert.equal(selectedChunks[0].chunk.chunk_id, "ri:npl#00000");
assert.equal(selectedChunks[1].chunk.chunk_id, "ri:cost#00000", "conceito correlato pode complementar, mas não superar o trecho NPL exato");

const selectiveContext = await loadBibliotecaContext({
  ticker: "BBAS3",
  gaps: ["inadimplência por carteira NPL"],
  client: { async query(sql) {
    if (sql.includes("WITH asset_documents")) return [{
      dedup_key: "ri:npl", fonte: "ri", categoria: "Release", titulo: "Análise do Desempenho 2T26",
      data_documento: "2026-08-14", url_origem: "https://ri.exemplo/npl.pdf", parser_version: "BIB_B3_2_PARSER_v2.1",
      chunk_id: "ri:npl#00042", ordem: 42, pagina_inicio: 58, pagina_fim: 58,
      secao: "New NPL", texto: "New NPL por carteira PF, PJ e Agro; inadimplência detalhada.", tamanho_caracteres: 64,
      tabelas_json: [{ page: 58, rows: [["New NPL", "PF", "5,2%"]] }], search_rank: 0.91,
    }];
    if (sql.includes("count(DISTINCT d.dedup_key)")) return [{ total: 9, indexed: 8 }];
    throw new Error(`SQL inesperado: ${sql.slice(0, 50)}`);
  } },
});
assert.equal(selectiveContext.retrievalMode, "selective_chunks");
assert.deepEqual(selectiveContext.inventory, { total: 9, indexed: 8 });
assert.deepEqual(selectiveContext.chunkIds, ["ri:npl#00042"]);
assert.match(selectiveContext.documents[0].text, /Páginas 58/);

const updates = [];
const pendingIndexes = [];
const pendingResult = await parsePendingDocuments({ repository: {
  async listPendingDocuments() { return [{ dedup_key: "cvm_ipe:1", formato: "html", conteudo_binario: Buffer.from("<p>Evidência oficial</p>"), hash_conteudo: "a".repeat(64) }]; },
  async updateParseState(value) { updates.push(value); },
  async replaceDocumentIndex(value) { pendingIndexes.push(value); return { pages: value.pages.length, chunks: value.chunks.length }; },
} });
assert.deepEqual(pendingResult, { discovered: 1, parsed: 1, unsupported: 0, failed: 0 });
assert.equal(updates[0].status, "ok");
assert.equal(pendingIndexes[0].pages.length, 1, "parse pendente deve criar índice integral");

const context = {
  available: true,
  status: "ready",
  documentIds: ["cvm_ipe:doc-1"],
  chunkIds: ["cvm_ipe:doc-1#00000"],
  inventory: { total: 9, indexed: 8 },
  retrievalMode: "selective_chunks",
  documents: [{ id: "cvm_ipe:doc-1", date: "2026-08-19", title: "Fato Relevante", text: "A companhia confirmou a evidência nova.", chunks: [{ id: "cvm_ipe:doc-1#00000" }] }],
};
assert.match(buildBibliotecaPromptContext(context), /cvm_ipe:doc-1/);
assert.match(buildBibliotecaPromptContext(context), /9 documento\(s\) no acervo; 1 fonte\(s\) e 1 trecho\(s\)/);
const tablePrompt = formatBibliotecaTables([{ page: 4, rows: [
  ["Adjusted Net Income", "18", "and", "22", "R$", "7.3", "bn"],
  ["R$", "37.3", "bn"],
] }]);
assert.match(tablePrompt, /Adjusted Net Income/);
assert.doesNotMatch(tablePrompt, /37\.3/, "linha numérica órfã não deve entrar no contexto autoritativo");
const baseline = { scan: { score_total: 21, score_max: 30, score_dimensoes: [{ nome: "Qualidade de earnings", nota: 3 }] } };
const candidate = {
  ticker: "BBAS3", veredito_final: "COMPRAR", zona: "R$ 20 a R$ 22", besst: "R$ 15 a R$ 18",
  ajustes_score: [{ dimensao: "Qualidade de earnings", antes: 3, depois: 4, motivo: "Evidência documental nova", fonte_nova: "cvm_ipe:doc-1" }],
  lacunas: [{ q: "Qualidade do resultado", r: "Confirmada" }],
  lacunas_documentais: [{ lacuna: "Qualidade do resultado", status: "resolvida", evidencia_documental: ["cvm_ipe:doc-1"] }],
};
const candidateWithoutLibrary = { ...candidate, veredito_final: "MONITORAR", ajustes_score: [], lacunas_documentais: [{ lacuna: "Qualidade do resultado", status: "aberta", evidencia_documental: [] }] };
const withoutLibrary = applyBibliotecaAudit(reconcileDeepIntegrity(candidateWithoutLibrary, baseline, { documentIds: [] }), { available: false, status: "no_documents", documentIds: [], documents: [] });
const withLibrary = applyBibliotecaAudit(reconcileDeepIntegrity(candidate, baseline, { documentIds: context.documentIds }), context);
assert.equal(withoutLibrary.score_revisado, 21, "fonte documental inexistente não pode mover o score");
assert.equal(withoutLibrary.veredito_final, "MONITORAR");
assert.equal(withoutLibrary.nexoModules.BIBLIOTECA.requires_user_source, true);
assert.equal(withLibrary.score_revisado, 22, "documento válido pode lastrear ajuste explícito");
assert.equal(withLibrary.veredito_final, "COMPRAR");
assert.equal(withLibrary.nexoModules.BIBLIOTECA.requires_user_source, false);
assert.deepEqual(withLibrary.nexoModules.BIBLIOTECA.documents_consulted, ["cvm_ipe:doc-1"]);
assert.equal(withLibrary.nexoModules.BIBLIOTECA.documents_available, 9, "contagem deve refletir o acervo, não só o contexto enviado");
assert.equal(withLibrary.nexoModules.BIBLIOTECA.documents_indexed, 8);
assert.deepEqual(withLibrary.nexoModules.BIBLIOTECA.chunks_consulted, ["cvm_ipe:doc-1#00000"]);

const governedScanGaps = [
  "Inadimplência por segmento (rural vs. varejo vs. grandes empresas)",
  "Metodologia de cálculo do ROIC e reconciliação com dados do balanço",
];
const inconsistentDeep = {
  lacunas: [
    { q: "O ROIC é real ou artefato metodológico?", r: "A métrica não é adequada para bancos." },
    { q: "A política de dividendos foi cumprida?", r: "Sim." },
  ],
  lacunas_documentais: [
    { lacuna: governedScanGaps[0], status: "aberta", evidencia_documental: [] },
    { lacuna: governedScanGaps[1], status: "aberta", evidencia_documental: [] },
    { lacuna: "Política de dividendos", status: "resolvida", evidencia_documental: ["cvm_ipe:doc-1"] },
  ],
};
const expectedGaps = deriveExpectedDeepGaps({ scan: { lacunas_deep: governedScanGaps } });
const governedDeep = applyBibliotecaAudit(inconsistentDeep, context, { expectedGaps });
assert.deepEqual(governedDeep.lacunas_documentais.map((gap) => gap.lacuna), governedScanGaps);
assert.equal(governedDeep.lacunas_documentais.length, 2, "Deep não pode inventar uma terceira lacuna");
assert.equal(governedDeep.lacunas.length, 2, "respostas devem obedecer ao escopo do Scan");
assert.match(governedDeep.lacunas[1].r, /métrica não é adequada/, "resposta válida do ROIC deve ser preservada");
assert.deepEqual(governedDeep.nexoModules.BIBLIOTECA.discarded_new_gaps, ["Política de dividendos"]);
assert.deepEqual(deriveExpectedDeepGaps({ scan: { lacunas_deep: governedScanGaps }, deep: governedDeep }, "Confirmar New NPL"), [...governedScanGaps, "Confirmar New NPL"]);

const partiallyAnswered = applyBibliotecaAudit({
  lacunas: [{ q: "Política de dividendos e payout 2026–2027", r: "Parcialmente resolvida: o JCP foi confirmado, mas o payout explícito não foi declarado nos documentos disponíveis." }],
  lacunas_documentais: [{ lacuna: "Política de dividendos e payout 2026–2027", status: "resolvida", evidencia_documental: ["cvm_ipe:doc-1"] }],
}, context, { expectedGaps: ["Política de dividendos e payout 2026–2027"] });
assert.equal(partiallyAnswered.lacunas_documentais[0].status, "parcial", "evidência parcial deve ser distinguida de lacuna sem resposta");
assert.deepEqual(partiallyAnswered.nexoModules.BIBLIOTECA.lacunas_parciais, ["Política de dividendos e payout 2026–2027"]);
assert.deepEqual(partiallyAnswered.nexoModules.BIBLIOTECA.lacunas_abertas, ["Política de dividendos e payout 2026–2027"], "lacuna parcial continua no escopo do próximo aprofundamento");
assert.equal(partiallyAnswered.nexoModules.BIBLIOTECA.requires_user_source, true);
assert.match(partiallyAnswered.lacunas[0].r, /^Parcialmente resolvida\./, "texto exibido deve reproduzir o status governado");

const numericPartial = applyBibliotecaAudit({
  lacunas: [{
    q: "Guidance de lucro e payout para 2026–2027",
    r: "Parcialmente resolvida para 2026. Lucro ajustado de R$ 7,3 bi no semestre, guidance de R$ 18–22 bi e payout de 30%; faltam metas explícitas para 2027.",
  }],
  lacunas_documentais: [{ lacuna: "Guidance de lucro e payout para 2026–2027", status: "parcial", evidencia_documental: [] }],
}, {
  ...context,
  documents: [{
    id: "ri:bbas3-guidance", trust: "user_supplied", matchedGaps: ["Guidance de lucro e payout para 2026–2027"],
    text: "Adjusted Net Income R$ 7.3bn in 1H26. Guidance 2026 R$18 to R$22bn. Payout 30%.",
    tables: [], chunks: [{ id: "ri:bbas3-guidance#00001" }],
  }],
  documentIds: ["ri:bbas3-guidance"],
}, { expectedGaps: ["Guidance de lucro e payout para 2026–2027"] });
assert.equal(numericPartial.lacunas_documentais[0].status, "parcial", "valores monetários e ranges devem reconciliar evidência parcial, não apenas percentuais");
assert.match(numericPartial.lacunas[0].r, /^Parcialmente resolvida\. Lucro ajustado/, "prefixo antigo não pode contradizer o status final");

const reportSevenGaps = [
  "Composição detalhada da inadimplência por carteira e evolução trimestral das provisões",
  "Estrutura de reprecificação do passivo e sensibilidade do NII",
];
const reportSevenCandidate = {
  ticker: "BBAS3",
  veredito_final: "MONITORAR",
  preco: [
    { c: "C1", vj: "R$ 24,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 24, multiplo: 1 } },
    { c: "C2", vj: "R$ 27,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 27, multiplo: 1 } },
  ],
  zona: "R$ 24,00 – R$ 27,00",
  zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "" },
  besst: "R$ 19,50",
  desconto: "Preço atual R$ 22,45 está dentro da zona; BESST tem desconto de 20,4%.",
  ajustes_score: [],
  lacunas: [
    {
      q: reportSevenGaps[0],
      r: "Resolvida. Dados de provisões consolidadas por trimestre não estão explicitamente recuperados nos trechos disponíveis.",
    },
    {
      q: reportSevenGaps[1],
      r: "Resolvida. Entretanto, valores numéricos de sensibilidade do NII e a composição quantitativa dos passivos não foram recuperados nos trechos disponíveis; os dados específicos não constam nos excertos injetados.",
    },
  ],
  lacunas_documentais: reportSevenGaps.map((lacuna) => ({
    lacuna,
    status: "resolvida",
    evidencia_documental: ["ri:bbas3-2t26"],
  })),
};
const reportSevenGoverned = reconcileDeepIntegrity(reportSevenCandidate, {
  scan: { score_total: 17, score_max: 30 },
}, { documentIds: ["ri:bbas3-2t26"], referencePrice: 22.45 });
const reportSevenAudit = applyBibliotecaAudit(reportSevenGoverned, {
  ...context,
  documents: [{ id: "ri:bbas3-2t26", trust: "user_supplied", text: "Relatório 2T26", matchedGaps: reportSevenGaps }],
  documentIds: ["ri:bbas3-2t26"],
}, { expectedGaps: reportSevenGaps });
assert.deepEqual(reportSevenAudit.lacunas_documentais.map((gap) => gap.status), ["parcial", "parcial"], "as duas respostas do relatório 7 admitem componentes ausentes e não podem ser resolvidas");
assert.deepEqual(reportSevenAudit.nexoModules.BIBLIOTECA.lacunas_resolvidas, []);
assert.deepEqual(reportSevenAudit.nexoModules.BIBLIOTECA.lacunas_parciais, reportSevenGaps);
assert.ok(reportSevenAudit.lacunas.every((answer) => answer.r.startsWith("Parcialmente resolvida.")));
assert.equal(reportSevenAudit.score_revisado, 17);
assert.match(reportSevenAudit.desconto, /6,46% abaixo do piso/);
assert.match(reportSevenAudit.desconto, /15,00% e 25,00% abaixo do piso/);
assert.match(reportSevenAudit.desconto, /acima do BESST e abaixo da zona de convergência/);
assert.doesNotMatch(reportSevenAudit.desconto, /20,4%|está dentro da zona/);

const metricContext = {
  available: true,
  documents: [{ id: "ri:bbas3-2t26", tables: [{ page: 4, rows: [
    ["Cost of Credit", "65", "and", "70", "R$", "37.3", "bn"],
    ["Adjusted Net Income", "18", "and", "22", "R$", "7.3", "bn"],
    ["INAD +90d Agro", "6,27%"],
    ["Cobertura +90d Agro", "165,2%"],
    ["New NPL Agro (t) / Cart. Agro (t-1)", "1,37%"],
    ["Cobertura New NPL", "145,9%"],
  ] }] }],
};
assert.equal(findBibliotecaMetricConflicts({
  lacunas: [{ r: "O lucro líquido ajustado foi de R$ 37,3 bi, dentro da banda de 65% a 70%." }],
}, metricContext).length, 1, "valores da linha de custo do crédito não podem ser atribuídos ao lucro ajustado");
assert.deepEqual(findBibliotecaMetricConflicts({
  lacunas: [{ r: "O lucro líquido ajustado foi de R$ 7,3 bi, com guidance entre R$ 18 bi e R$ 22 bi." }],
}, metricContext), [], "associação correta da linha deve passar pelo guardrail");
const semanticNplConflicts = findBibliotecaMetricConflicts({
  lacunas: [{ r: "Agro: INAD = 1,37%, cobertura New NPL = 145,9%." }],
}, metricContext);
assert.ok(semanticNplConflicts.some((item) => item.target_metric === "inadimplência sem janela definida"), "INAD sem janela não pode absorver o índice de formação de New NPL");
const capitalMinimumConflicts = findBibliotecaMetricConflicts({
  lacunas: [{ r: "CET1 de 11,27% está acima do mínimo regulatório de 8%." }],
}, metricContext);
assert.ok(capitalMinimumConflicts.some((item) => item.target_metric === "requerimento de capital sem decomposição"), "mínimos de capital não podem omitir buffers e adicionais");
assert.deepEqual(findBibliotecaMetricConflicts({
  lacunas: [{ r: "CET1 de 11,27% supera o mínimo-base aplicável; buffers e adicionais institucionais devem ser verificados separadamente." }],
}, metricContext), [], "afirmação prudencial decomposta deve permanecer válida");

const retrievalReconciled = applyBibliotecaAudit({
  lacunas: [{ q: "NPL por carteira", r: "INAD+90d Agro 6,27%, PF 8,41% e PJ 3,18%; New NPL Agro 1,37%, com cobertura New NPL de 145,9%." }],
  lacunas_documentais: [{ lacuna: "NPL por carteira", status: "aberta", evidencia_documental: [] }],
}, {
  ...context,
  documents: [{
    id: "ri:npl-full", trust: "user_supplied", matchedGaps: ["NPL por carteira"],
    text: "INAD+90d Agro 6,27%. INAD+90d PF 8,41%. INAD+90d PJ 3,18%. New NPL Agro 1,37%. Cobertura New NPL agro 145,9%.",
    chunks: [{ id: "ri:npl-full#00001" }],
  }],
  documentIds: ["ri:npl-full"],
  chunkIds: ["ri:npl-full#00001"],
}, { expectedGaps: ["NPL por carteira"] });
assert.equal(retrievalReconciled.lacunas_documentais[0].status, "resolvida", "servidor deve reconciliar evidência numérica presente nos chunks mesmo sem ID repetido pela IA");
assert.deepEqual(retrievalReconciled.nexoModules.BIBLIOTECA.documents_used, ["ri:npl-full"]);

const answerCitationReconciled = applyBibliotecaAudit({
  lacunas: [{
    q: "O dividend yield atual destoa do histórico: apurar se houve corte de payout, retenção regulatória ou queda do lucro.",
    r: "Com lucro projetado menor (ri:bbas3-2t26), a base de distribuição encolheu. A fonte não evidencia corte deliberado do payout; a queda decorre do lucro menor.",
  }],
  lacunas_documentais: [{
    lacuna: "O dividend yield atual destoa do histórico: apurar se houve corte de payout, retenção regulatória ou queda do lucro.",
    status: "aberta",
    evidencia_documental: [],
  }],
}, {
  ...context,
  documents: [{ id: "ri:bbas3-2t26", trust: "user_supplied", matchedGaps: [], text: "Lucro líquido ajustado e dividendos." }],
  documentIds: ["ri:bbas3-2t26"],
  chunkIds: ["ri:bbas3-2t26#00001"],
}, { expectedGaps: ["O dividend yield atual destoa do histórico: apurar se houve corte de payout, retenção regulatória ou queda do lucro."] });
assert.equal(answerCitationReconciled.lacunas_documentais[0].status, "resolvida", "ID permitido citado na resposta deve reconciliar a evidência mesmo se a IA omitir o campo técnico");
assert.deepEqual(answerCitationReconciled.nexoModules.BIBLIOTECA.documents_used, ["ri:bbas3-2t26"]);
console.log("SIMULAÇÃO B3 · sem Biblioteca: MONITORAR 21/30 · com Biblioteca: COMPRAR 22/30");

for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.2", "::1", "fd00::1"]) assert.equal(isPrivateAddress(address), true);
await assert.rejects(() => validatePublicHttpsUrl("http://ri.exemplo.com/doc.pdf", { lookupImpl: async () => [{ address: "203.0.113.5" }] }), /https_required/);
await assert.rejects(() => validatePublicHttpsUrl("https://localhost/doc.pdf", { lookupImpl: async () => [{ address: "127.0.0.1" }] }), /private_forbidden/);

const stored = [];
const raw = [];
const indexes = [];
const ingested = await ingestUserSource({
  ticker: "BBAS3",
  sourceUrl: "https://ri.exemplo.com/documento",
  lookupImpl: async () => [{ address: "203.0.113.5" }],
  fetchImpl: async () => new Response("<html><h1>Release oficial</h1><p>Guidance confirmado.</p></html>", { status: 200, headers: { "content-type": "text/html" } }),
  repository: {
    async findAssetByTicker() { return { ticker: "BBAS3", issuer_id: "cvm:1023" }; },
    async findByDedupKey() { return null; },
    async upsertRawDocument(value) { raw.push(value); return { inserted: true }; },
    async upsertParsedDocument(value) { stored.push(value); return { inserted: true }; },
    async replaceDocumentIndex(value) { indexes.push(value); return { pages: value.pages.length, chunks: value.chunks.length }; },
  },
  now: () => new Date("2026-09-06T12:00:00Z"),
});
assert.equal(ingested.inserted, true);
assert.equal(stored[0].fonte, "ri");
assert.match(stored[0].texto, /Guidance confirmado/);
assert.equal(stored[0].metadata.raw_binary_persisted, true);
assert.equal(raw[0].conteudo.toString("utf8").includes("Guidance confirmado"), true, "binário integral deve ser preservado");
assert.equal(indexes[0].pages.length, 1);
assert.ok(indexes[0].chunks.length >= 1);
assert.equal(ingested.rawBinaryPersisted, true);

const binaryParts = [];
const partitionRepository = createBibliotecaRepository({ async query(sql, params = []) {
  if (sql.includes("INSERT INTO biblioteca.documentos")) return [{ inserted: true, dedup_key: params[0] }];
  if (sql.includes("DELETE FROM biblioteca.documento_binario_partes")) return [];
  if (sql.includes("INSERT INTO biblioteca.documento_binario_partes")) {
    binaryParts.push({ order: params[1], bytes: Buffer.from(params[2], "base64"), size: params[3], hash: params[4] });
    return [];
  }
  throw new Error(`SQL binário inesperado: ${sql.slice(0, 60)}`);
} });
const largeBinary = Buffer.alloc(1_200_000, 7);
const partitioned = await partitionRepository.upsertRawDocument({
  dedupKey: "ri:partition-test", issuerId: "cvm:1023", fonte: "ri", sourceDocumentId: "partition-test",
  formato: "pdf", urlOrigem: "https://ri.exemplo/large.pdf", conteudo: largeBinary,
  hashConteudo: "b".repeat(64), metadata: { raw_binary_persisted: true },
});
assert.equal(partitioned.document.binary_parts, 3, "binário grande deve ser particionado abaixo do limite HTTP");
assert.deepEqual(Buffer.concat(binaryParts.sort((a, b) => a.order - b.order).map((part) => part.bytes)), largeBinary);

const repositorySource = await readFile(join(process.cwd(), "lib", "nexo", "biblioteca", "repository.mjs"), "utf8");
assert.ok(repositorySource.includes("metadata_json->>'requested_ticker'"), "fonte RI deve sobreviver a migração de emissor provisório");
assert.ok(repositorySource.includes("ORDER BY (d.fonte = 'ri') DESC"), "fonte RI deve ser priorizada entre candidatos");

const page = await readFile(join(process.cwd(), "app", "page.jsx"), "utf8");
assert.ok(!page.includes("Link RI / Dados Oficiais"), "campo RI inicial precisa ser removido");
assert.ok(page.includes("Fonte oficial para fechar as lacunas · obrigatório"));
assert.ok(page.includes('fetch("/api/biblioteca/ingest-url"'));
assert.ok(page.includes("gaps: asArray(bibliotecaAudit?.lacunas_abertas)"));
assert.ok(page.includes('role="alert">Erro na fonte:'));
const parserSource = await readFile(join(process.cwd(), "lib", "nexo", "biblioteca", "document_parser.mjs"), "utf8");
assert.ok(parserSource.includes('import("pdfjs-dist/legacy/build/pdf.worker.mjs")'), "bundle precisa rastrear o worker do PDF explicitamente");
const migration = await readFile(join(process.cwd(), "db", "migrations", "003_biblioteca_b3.sql"), "utf8");
for (const token of ["parser_version", "data_parse", "003_biblioteca_b3"]) assert.ok(migration.includes(token));
const selectiveMigration = await readFile(join(process.cwd(), "db", "migrations", "005_biblioteca_b3_2.sql"), "utf8");
for (const token of ["biblioteca.documento_binario_partes", "biblioteca.documento_paginas", "biblioteca.documento_chunks", "search_vector", "005_biblioteca_b3_2"]) assert.ok(selectiveMigration.includes(token));

console.log("Biblioteca B3 parser/context/link fallback: OK");
