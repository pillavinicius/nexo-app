import PDFDocument from "pdfkit";
import { splitPriceModels } from "../ui/valuation_adapter.mjs";

const COLORS = Object.freeze({
  ink: "#1C1A16",
  muted: "#6B6253",
  line: "#D9D1C2",
  paper: "#FFFCF6",
  gold: "#9B7725",
  goldSoft: "#F3EAD4",
  dark: "#17130B",
  white: "#FFFFFF",
});

function asText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function datePt(value) {
  const parsed = new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) return asText(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(parsed);
}

function money(value, currency = "BRL") {
  const number = Number(value);
  if (!Number.isFinite(number)) return asText(value);
  const code = String(currency || "BRL").toUpperCase();
  const locale = code === "USD" ? "en-US" : "pt-BR";
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
  return code === "BRL" ? `R$ ${amount}` : `${code} ${amount}`;
}

function createWriter(doc) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  function ensure(height = 70) {
    const bottom = doc.page.height - doc.page.margins.bottom - 24;
    if (doc.y + height > bottom) doc.addPage();
  }

  function rule(color = COLORS.line) {
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.7).strokeColor(color).stroke();
  }

  function section(number, title) {
    ensure(62);
    doc.moveDown(0.75);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.gold).text(`ETAPA ${number}`, left, doc.y, {
      characterSpacing: 1.6,
    });
    doc.moveDown(0.25);
    doc.font("Helvetica-Bold").fontSize(18).fillColor(COLORS.ink).text(title, left, doc.y, { width });
    doc.moveDown(0.35);
    rule();
    doc.moveDown(0.65);
  }

  function subheading(title) {
    ensure(38);
    doc.moveDown(0.35);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.gold).text(asText(title).toUpperCase(), left, doc.y, {
      width,
      characterSpacing: 0.7,
    });
    doc.moveDown(0.35);
  }

  function paragraph(value, options = {}) {
    const content = asText(value, "");
    if (!content) return;
    ensure(34);
    doc.font(options.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(options.size || 9.5)
      .fillColor(options.color || COLORS.ink)
      .text(content, left, doc.y, { width, lineGap: 2.8 });
    doc.moveDown(0.45);
  }

  function pair(label, value) {
    ensure(30);
    const labelWidth = 154;
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.muted).text(asText(label), left, y, {
      width: labelWidth,
    });
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink).text(asText(value), left + labelWidth, y, {
      width: width - labelWidth,
      lineGap: 2,
    });
    doc.y = Math.max(doc.y, y + 16);
    rule("#E8E2D7");
    doc.moveDown(0.32);
  }

  function card(title, value, note = "") {
    const titleText = asText(title);
    const valueText = asText(value, "");
    const noteText = asText(note, "");
    const innerWidth = width - 22;
    doc.font("Helvetica-Bold").fontSize(10.5);
    const titleHeight = doc.heightOfString(titleText, { width: innerWidth });
    doc.font("Helvetica").fontSize(9.2);
    const valueHeight = valueText ? doc.heightOfString(valueText, { width: innerWidth, lineGap: 2 }) : 0;
    doc.font("Helvetica").fontSize(8.3);
    const noteHeight = noteText ? doc.heightOfString(noteText, { width: innerWidth, lineGap: 1.5 }) : 0;
    const height = 22 + titleHeight + valueHeight + noteHeight + (valueText ? 6 : 0) + (noteText ? 5 : 0);
    if (height > 500) {
      ensure(80);
      subheading(titleText);
      paragraph(valueText);
      paragraph(noteText, { size: 8.3, color: COLORS.gold });
      return;
    }
    ensure(Math.min(height, 120));
    const y = doc.y;
    doc.roundedRect(left, y, width, height, 3).fillAndStroke(COLORS.paper, COLORS.line);
    let cursor = y + 10;
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(COLORS.ink).text(titleText, left + 11, cursor, {
      width: innerWidth,
    });
    cursor += titleHeight + 5;
    if (valueText) {
      doc.font("Helvetica").fontSize(9.2).fillColor(COLORS.muted).text(valueText, left + 11, cursor, {
        width: innerWidth,
        lineGap: 2,
      });
      cursor += valueHeight + 4;
    }
    if (noteText) {
      doc.font("Helvetica").fontSize(8.3).fillColor(COLORS.gold).text(noteText, left + 11, cursor, {
        width: innerWidth,
        lineGap: 1.5,
      });
    }
    doc.y = y + height + 7;
  }

  function bullet(value) {
    const content = asText(value, "");
    if (!content) return;
    ensure(26);
    doc.circle(left + 3, doc.y + 5, 1.5).fill(COLORS.gold);
    doc.font("Helvetica").fontSize(9.2).fillColor(COLORS.ink).text(content, left + 12, doc.y, {
      width: width - 12,
      lineGap: 2,
    });
    doc.moveDown(0.35);
  }

  return { left, width, ensure, rule, section, subheading, paragraph, pair, card, bullet };
}

function writeEdg(writer, result) {
  const edg = result?.nexoModules?.EDG;
  if (!edg) return;
  const comparison = result?.edg_governance?.comparison;
  writer.subheading("Governança de Edge");
  writer.pair("Tipo", edg.edge_type);
  writer.pair("Status", edg.edge_status);
  writer.pair("Teto permitido", edg.max_allowed_classification);
  writer.pair("Sinal de saída", edg.exit_signal);
  if (comparison) {
    writer.pair("Veredito sem governança EDG", comparison.without_edg);
    writer.pair("Veredito com governança EDG", comparison.with_edg);
  }
}

function writeScan(writer, scan) {
  if (!scan) {
    writer.paragraph("Resultado de Scan não disponível.", { color: COLORS.muted });
    return;
  }
  writer.pair("Veredito", scan.veredito);
  writer.pair("Score", `${asText(scan.score_total)} / ${asText(scan.score_max || 30)}`);
  if (scan.score_resumo) writer.paragraph(scan.score_resumo);
  if (scan.tese) {
    writer.subheading("Tese do Scan");
    writer.paragraph(scan.tese);
  }
  const groups = [
    ["Filtros eliminatórios", scan.filtros, (x) => `${asText(x?.nome)} — ${asText(x?.status)}. ${asText(x?.valor || x?.nota, "")}`],
    ["Governança 0B", scan.governanca, (x) => `${asText(x?.dimensao)} — nota ${asText(x?.nota)}. ${asText(x?.obs, "")}`],
    ["KPIs", scan.kpis, (x) => `${asText(x?.nome)}: ${asText(x?.valor)}${x?.benchmark ? ` · referência ${asText(x.benchmark)}` : ""}`],
    ["Score por dimensão", scan.score_dimensoes, (x) => `${asText(x?.nome)} — ${asText(x?.nota)}. ${asText(x?.obs, "")}`],
    ["Catalisadores", scan.catalisadores, (x) => `${asText(x?.descricao)} · ${asText(x?.impacto)} · ${asText(x?.prazo)}`],
    ["Riscos", scan.riscos, (x) => `${asText(x?.descricao)} · severidade ${asText(x?.severidade)} · probabilidade ${asText(x?.probabilidade)}`],
    ["Lacunas para o Deep", scan.lacunas_deep, (x) => asText(x)],
  ];
  for (const [title, values, format] of groups) {
    if (!list(values).length) continue;
    writer.subheading(title);
    list(values).forEach((item) => writer.bullet(format(item)));
  }
  writeEdg(writer, scan);
}

function writeValuations(writer, deep, includeClassic) {
  const { layers, classics } = splitPriceModels(deep, { includeClassic });
  if (layers.length) {
    writer.subheading("Modelo de preço — C1, C2 e C3");
    layers.forEach((item) => writer.card(
      `${item.label}${item.value ? ` · ${item.value}` : ""}`,
      item.methodology,
      item.premises
    ));
  }
  if (classics.length) {
    writer.subheading("Valuations clássicos auxiliares");
    classics.forEach((item) => writer.card(
      `${item.label}${item.value ? ` · ${item.value}` : ""}`,
      item.methodology,
      item.premises
    ));
  }
}

function writeDeep(writer, deep, includeClassic) {
  if (!deep) {
    writer.paragraph("Resultado de Deep não disponível.", { color: COLORS.muted });
    return;
  }
  writer.pair("Veredito final", deep.veredito_final);
  if (Number.isFinite(Number(deep.score_revisado))) {
    writer.subheading("Evolução auditável do score");
    writer.pair("Score de entrada", `${asText(deep.score_original)} / ${asText(deep.score_max || 30)}`);
    writer.pair("Score após o Deep", `${asText(deep.score_revisado)} / ${asText(deep.score_max || 30)}`);
    writer.pair("Variação calculada pelo servidor", deep.mudanca_score || "0");
    list(deep.ajustes_score).forEach((item) => writer.card(
      `${asText(item?.dimensao)} · ${asText(item?.antes)} para ${asText(item?.depois)}`,
      item?.motivo,
      `Fonte: ${asText(item?.fonte_nova || "DEEP")}`
    ));
  }
  const lacunas = list(deep.lacunas || deep.lacunas_respondidas);
  if (lacunas.length) {
    writer.subheading("Respostas às lacunas");
    lacunas.forEach((item, index) => writer.card(
      item?.q || item?.lacuna || `Lacuna ${index + 1}`,
      item?.r || item?.resposta || item
    ));
  }
  writeValuations(writer, deep, includeClassic);
  if (deep.zona || deep.zona_convergida) {
    writer.subheading("Zona convergida · BESST");
    writer.card(
      deep.zona || deep.zona_convergida,
      deep.besst || deep.zona_besst ? `Entrada BESST: ${asText(deep.besst || deep.zona_besst)}` : "",
      deep.desconto || deep.desconto_atual ? `Desconto atual: ${asText(deep.desconto || deep.desconto_atual)}` : ""
    );
    if (deep.integridade_analise?.besst_corrected) {
      writer.card(
        "BESST corrigido automaticamente",
        `Valor retornado pelo motor: ${asText(deep.integridade_analise.besst_previous_value)}`,
        "A faixa foi recalculada para permanecer entre 15% e 25% abaixo da zona de convergência."
      );
    }
  }
  const groups = [
    ["Sensibilidade macro", deep.macro || deep.sensibilidade, (x) => `${asText(x?.s || x?.cenario)} — ${asText(x?.i || x?.impacto)}${x?.detalhe ? ` · ${asText(x.detalhe)}` : ""}`],
    ["Catalisadores", deep.catalisadores, (x) => `${asText(x?.d || x?.descricao)} · ${asText(x?.impacto)} · ${asText(x?.p || x?.prazo)}`],
    ["Riscos", deep.riscos, (x) => `${asText(x?.d || x?.descricao)} · severidade ${asText(x?.sev || x?.severidade || "MÉDIO")}${x?.g || x?.gatilho ? ` · gatilho ${asText(x?.g || x?.gatilho)}` : ""}`],
    ["Próximos passos", deep.passos || deep.proximos_passos, (x) => asText(x)],
  ];
  for (const [title, values, format] of groups) {
    if (!list(values).length) continue;
    writer.subheading(title);
    list(values).forEach((item) => writer.bullet(format(item)));
  }
  writeEdg(writer, deep);
}

function writeFinal(writer, final) {
  if (!final) {
    writer.paragraph("Reclassificação final não disponível.", { color: COLORS.muted });
    return;
  }
  writer.pair("Classificação final", final.classificacao_final);
  writer.pair("Score original", `${asText(final.score_original)} / ${asText(final.score_max || 30)}`);
  writer.pair("Score revisado", `${asText(final.score_revisado)} / ${asText(final.score_max || 30)}`);
  writer.pair("Mudança de veredito", `${asText(final.veredito_anterior)} para ${asText(final.veredito_reclassificado)}`);
  writer.pair("Indicador do veredito", final.mudanca_veredito === "MANTEVE" ? "NEUTRO" : final.mudanca_veredito);
  if (final.mudanca_score) writer.pair("Mudança de score", final.mudanca_score);
  if (final.integridade_reclassificacao) {
    writer.pair("Modo de finalização", "Consolidação determinística");
    writer.pair("Base preservada", final.integridade_reclassificacao.baseline_phase);
  }
  const riscos = list(final.riscos_incorporados);
  if (riscos.length) {
    writer.subheading("Riscos incorporados");
    riscos.forEach((item) => writer.bullet(`${asText(item?.descricao)} · impacto ${asText(item?.impacto_score)} · severidade ${asText(item?.severidade)}`));
  }
  const ajustes = list(final.ajustes_score);
  if (ajustes.length) {
    writer.subheading("Ajustes de score");
    ajustes.forEach((item) => writer.card(
      `${asText(item?.dimensao)} · ${asText(item?.antes)} para ${asText(item?.depois)}`,
      item?.motivo
    ));
  }
  if (final.tese_final) {
    writer.subheading("Tese final");
    writer.paragraph(final.tese_final);
  }
  const price = final.preco_final || {};
  if (price.zona_convergencia || price.besst || price.margem_seguranca || price.observacao) {
    writer.subheading("Preço final");
    writer.pair("Zona de convergência", price.zona_convergencia);
    writer.pair("BESST", price.besst);
    writer.pair("Margem de segurança", price.margem_seguranca);
    writer.pair("Observação", price.observacao);
  }
  if (final.conclusao) {
    writer.subheading("Conclusão NEXO");
    writer.paragraph(final.conclusao, { bold: true });
  }
  const steps = list(final.proximos_passos);
  if (steps.length) {
    writer.subheading("Próximos passos");
    steps.forEach((item) => writer.bullet(item));
  }
  writeEdg(writer, final);
}

function writeCover(doc, writer, payload) {
  const asset = payload.asset || {};
  const currency = asset.currency || payload.currency || "BRL";
  doc.rect(0, 0, doc.page.width, 178).fill(COLORS.dark);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#D4B25C").text("N  E  X  O", writer.left, 48, {
    characterSpacing: 3,
  });
  doc.font("Helvetica-Bold").fontSize(27).fillColor(COLORS.white).text("Relatório consolidado", writer.left, 78, {
    width: writer.width,
  });
  doc.font("Helvetica").fontSize(10).fillColor("#C9C1B0").text(
    "Sequência completa da análise: contexto, Scan, Deep e reclassificação final.",
    writer.left,
    119,
    { width: writer.width }
  );
  doc.y = 207;
  writer.pair("Ativo", `${asText(payload.ticker)}${asset.name ? ` · ${asText(asset.name)}` : ""}`);
  writer.pair("Tipo", asset.assetType || payload.assetType);
  writer.pair("Cotação de referência", money(asset.price, currency));
  writer.pair("Moeda", currency);
  writer.pair("Gerado em", datePt(payload.generatedAt));
  doc.moveDown(1);
  writer.card(
    "Escopo do documento",
    "Relatório gerado diretamente a partir dos resultados estruturados do NEXO. A organização foi preparada para leitura e arquivo; não é uma impressão da interface.",
    "Os dados refletem o estado da análise no momento da exportação."
  );
}

function addPageFurniture(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const pageWidth = doc.page.width;
    const left = doc.page.margins.left;
    const right = pageWidth - doc.page.margins.right;
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    if (index > 0) {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(COLORS.gold).text("NEXO · RELATÓRIO CONSOLIDADO", left, 22, {
        width: right - left,
        characterSpacing: 0.8,
      });
      doc.moveTo(left, 36).lineTo(right, 36).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    }
    const footerY = doc.page.height - 28;
    doc.moveTo(left, footerY - 8).lineTo(right, footerY - 8).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(COLORS.muted).text(
      `NEXO · documento analítico · página ${index + 1} de ${range.count}`,
      left,
      footerY,
      { width: right - left, align: "center", lineBreak: false }
    );
    doc.page.margins.bottom = originalBottomMargin;
  }
}

export function renderNexoReportPdf(payload = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, right: 44, bottom: 48, left: 44 },
      bufferPages: true,
      compress: true,
      info: {
        Title: `NEXO · ${asText(payload.ticker, "Relatório")}`,
        Author: "NEXO Portfolio Framework",
        Subject: "Relatório consolidado de análise",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const writer = createWriter(doc);
    const includeClassic = payload?.options?.classicValuations === "SIM";
    writeCover(doc, writer, payload);

    doc.addPage();
    writer.section("1", "Contexto de entrada");
    const asset = payload.asset || {};
    writer.pair("Ticker", payload.ticker);
    writer.pair("Fonte de mercado", asset.provider);
    writer.pair("Atualização do ativo", asset.updatedAt);
    if (asset.history) {
      writer.pair("Janela histórica", `${asText(asset.history.firstDate)} a ${asText(asset.history.lastDate)}`);
      writer.pair("Mínimo / máximo", `${money(asset.history.minPrice, asset.currency)} / ${money(asset.history.maxPrice, asset.currency)}`);
    }
    const macro = payload.macro || {};
    const nmi = macro.nmi || macro;
    writer.subheading("Contexto macro NMI");
    writer.pair("Regime", nmi.regimeLabel || nmi.regime || macro.nexoMacroRegime);
    const confidence = Number(nmi.overallConfidence ?? nmi.confidence ?? nmi.confiabilidade);
    writer.pair(
      "Confiabilidade",
      Number.isFinite(confidence) ? `${confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence)}%` : "—"
    );
    if (payload.edge) {
      writer.subheading("Declaração de Edge");
      writer.pair("Tipo", payload.edge.edge_type);
      writer.pair("Status", payload.edge.edge_status);
      writer.pair("Evidência verificável", payload.edge.edge_evidence || payload.edge.verifiable_evidence);
      writer.pair("Condição de expiração", payload.edge.edge_expiry_condition || payload.edge.observable_expiry_condition);
    }

    writer.section("2", "Scan NEXO");
    writeScan(writer, payload.scan);

    writer.section("3", "Deep NEXO");
    writeDeep(writer, payload.deep, includeClassic);
    list(payload.deepAdds).forEach((deep, index) => {
      writer.section(`3.${index + 1}`, `Aprofundamento ${index + 1}`);
      writeDeep(writer, deep, includeClassic);
    });

    writer.section("4", "Reclassificação final");
    writeFinal(writer, payload.final);
    addPageFurniture(doc);
    doc.end();
  });
}
