"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  assetPrefill,
  compactAssetContext,
  displayMoney,
  displayNumber,
} from "../lib/ui/asset_market_adapter.mjs";
import {
  buildComplementaryMacroContext,
  mergeMacroData,
  nmiContextToMacroData,
} from "../lib/ui/nmi_macro_adapter.mjs";
import {
  EDGE_INSUMOS,
} from "../lib/nexo/edg/edg_engine.mjs";
import {
  buildGuidedEdgeEvidence,
  buildGuidedExpiryCondition,
  EDGE_DEADLINE_OBJECTS,
  EDGE_EVIDENCE_BASES,
  EDGE_EVIDENCE_WINDOWS,
  EDGE_EXPIRY_EVENTS,
  EDGE_EXPIRY_METRICS,
  EDGE_EXPIRY_PERIODS,
  EDGE_EXPIRY_TEMPLATES,
  EDGE_EXPIRY_UNITS,
  EDGE_INSUMO_METADATA,
  EDGE_TYPE_DESCRIPTIONS,
  evidenceOptionsForType,
} from "../lib/ui/edg_form_adapter.mjs";
import {
  ASSET_LOOKUP_STATUS,
  resolveAssetLookupState,
} from "../lib/nexo/data/asset_lookup_contract.mjs";
import {
  PRICE_LAYER_GUIDE,
  PRICE_LAYER_SUMMARY,
  splitPriceModels,
} from "../lib/ui/valuation_adapter.mjs";
import { readApiJsonResponse } from "../lib/ui/api_response_adapter.mjs";
import { resolveEdgeScanGate } from "../lib/ui/edge_scan_gate.mjs";
import {
  canSharePdfFile,
  choosePdfSaveHandle,
  isMobilePdfEnvironment,
  isPdfDeliveryCancellation,
  triggerPdfDownload,
  writePdfToHandle,
} from "../lib/ui/pdf_delivery.mjs";
import {
  ANALYSIS_VIEW,
  analysisViewLabel,
  buildAnalysisTabs,
  latestDeepViewId,
} from "../lib/ui/analysis_navigation.mjs";

const EDGE_TYPE_LABELS = Object.freeze({
  nenhum: "Nenhum edge declarado",
  informacional: "Informacional",
  analitico: "Analítico",
  estrutural: "Estrutural",
  temporal: "Temporal",
});

const EDGE_STATUS_LABELS = Object.freeze({
  ativo: "Ativo",
  expirado: "Expirado",
  nao_declarado: "Não declarado",
});

const EDG_ERROR_LABELS = Object.freeze({
  edge_type_required: "Selecione o tipo de edge.",
  edge_type_invalid: "O tipo de edge não pertence ao contrato EDG.",
  edge_status_must_be_nao_declarado: "Sem edge, o status precisa ser não declarado.",
  edge_evidence_not_verifiable: "Descreva uma evidência verificável com pelo menos 12 caracteres.",
  edge_insumo_required: "Selecione o insumo NEXO que sustenta a evidência.",
  edge_insumo_unknown: "O insumo selecionado não pertence ao catálogo NEXO.",
  edge_expiry_condition_required: "Defina a condição observável de expiração.",
  edge_expiry_condition_not_observable: "A condição de expiração está vaga: use métrica, limite e janela, ou um evento objetivo.",
  edge_declared_at_invalid: "Informe uma data de declaração válida.",
  edge_status_required: "Informe se o edge está ativo ou expirado.",
  edge_status_invalid: "O status informado não é válido para um edge declarado.",
});

const HDL_MIN_HORIZON_YEARS = 1;
const HDL_MAX_HORIZON_YEARS = 33;

function localIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function detectType(t) {
  const tk = (t || "").toUpperCase().trim();
  if (!tk) return "fii";
  if (/^[A-Z]{4}11$/.test(tk)) return "fii";
  if (/^[A-Z]{4}[3-9]B?$/.test(tk) || /^[A-Z]{3,4}[0-9]{1,2}$/.test(tk)) return "acao-br";
  if (["VWCE", "CSPX", "EQQQ", "WSML", "IWDA", "SWDA", "VUSA", "XWLD", "MEUD"].includes(tk)) return "etf-ext";
  if (/^[A-Z]{1,5}$/.test(tk) && tk.length <= 5) return "stock-ext";
  return "acao-br";
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function asText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function localizedNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function isValidHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function macroValue(item) {
  if (!item || item.value === null || item.value === undefined) return "";
  return String(item.value);
}

function macroStatusText(item) {
  if (!item) return "Dado manual opcional";
  if (item.ok) return `Automático · ${item.source}${item.date ? " · " + item.date : ""}`;
  return "Dado automático indisponível · preencher manualmente";
}

function formattedMacroValue(label, item) {
  if (!item?.ok) return "—";
  const value = item.value;
  if (label === "USD PTAX") return `${displayMoney(value, "BRL")} / USD`;
  if (label === "Selic Meta" || label === "Fed Funds") {
    return `${displayNumber(value)}% a.a.`;
  }
  if (label === "CDI diário" || label === "Selic diária") {
    return `${displayNumber(value)}% a.d.`;
  }
  if (label === "IPCA mensal") return `${displayNumber(value)}% a.m.`;
  if (label === "IPCA 12m") return `${displayNumber(value)}% em 12 meses`;
  if (label === "Crédito/PIB") return `${displayNumber(value)}% do PIB`;
  if (label === "Ibovespa" || label === "IFIX") {
    return `${displayNumber(value, 2, "pt-BR", true)} pts`;
  }
  return displayNumber(value);
}

function readableRegime(value) {
  if (!value) return "—";
  const text = String(value).replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Badge({ text }) {
  const value = asText(text || "N/D").toUpperCase();
  const displayValue = value === "MANTEVE" ? "NEUTRO" : value;

  const colors = {
    APROVADO: ["#C9A84C", "rgba(201,168,76,.15)"],
    WATCHLIST: ["#A8A8B8", "rgba(168,168,184,.15)"],
    VETADO: ["#C87070", "rgba(200,112,112,.15)"],
    PASS: ["#6DB46D", "rgba(100,180,100,.12)"],
    FAIL: ["#C87070", "rgba(200,112,112,.12)"],
    ALERTA: ["#D2A03C", "rgba(210,160,60,.12)"],
    ALTO: ["#C87070", "rgba(200,112,112,.12)"],
    MEDIO: ["#D2A03C", "rgba(210,160,60,.12)"],
    BAIXO: ["#6DB46D", "rgba(100,180,100,.12)"],
    COMPRAR: ["#C9A84C", "rgba(201,168,76,.15)"],
    MONITORAR: ["#A8A8B8", "rgba(168,168,184,.15)"],
    AGUARDAR: ["#A8A8B8", "rgba(168,168,184,.1)"],
    EVITAR: ["#C87070", "rgba(200,112,112,.15)"],
    MANTEVE: ["#A8A8B8", "rgba(168,168,184,.12)"],
    MELHOROU: ["#6DB46D", "rgba(100,180,100,.12)"],
    PIOROU: ["#C87070", "rgba(200,112,112,.12)"],
    AUTOMATIC: ["#6DB46D", "rgba(100,180,100,.12)"],
    MANUAL_FALLBACK: ["#D2A03C", "rgba(210,160,60,.12)"],
    SUPERA: ["#6DB46D", "rgba(100,180,100,.12)"],
    "NÃO SUPERA": ["#C87070", "rgba(200,112,112,.12)"],
    INCOMPLETO: ["#D2A03C", "rgba(210,160,60,.12)"],
    "NÃO APLICÁVEL": ["#A8A8B8", "rgba(168,168,184,.12)"],
  };

  const c = colors[value] || ["#6A5C3A", "rgba(168,168,184,.1)"];

  return (
    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "2px 8px", border: "1px solid " + c[0], color: c[0], background: c[1], display: "inline-block", whiteSpace: "nowrap" }}>
      {displayValue}
    </span>
  );
}

function ScoreBar({ score, max = 5 }) {
  const s = Number(score || 0);
  const m = Number(max || 5);
  const pct = Math.max(0, Math.min((s / m) * 100, 100));
  const c = s >= m * 0.7 ? "#C9A84C" : s >= m * 0.4 ? "#A8A8B8" : "#8B3A3A";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 90 }}>
      <div style={{ flex: 1, height: 4, background: "#2A2318", borderRadius: 2 }}>
        <div style={{ width: pct + "%", height: "100%", background: c, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: c, minWidth: 42 }}>{s}/{m}</span>
    </div>
  );
}

function Sec({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9, color: "#C9A84C", letterSpacing: 3, textTransform: "uppercase", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #2A2318" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MetricCard({ title, value, note }) {
  return (
    <div className="macro-card">
      <div className="macro-title">{title}</div>
      <div className="macro-value">{value || "—"}</div>
      {note && <div className="macro-note">{note}</div>}
    </div>
  );
}

function Row({ label, right, children }) {
  return (
    <div style={{ padding: "7px 0", borderBottom: "1px solid #1E1A0E" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 12, color: "#D4C9A8", flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{asText(label)}</span>
        <span style={{ flexShrink: 0, maxWidth: "55%", textAlign: "right", overflowWrap: "anywhere", fontSize: 12, color: "#C9A84C" }}>{right}</span>
      </div>
      {children}
    </div>
  );
}

function DetailBlock({ title, value, note }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid #1E1A0E", overflowWrap: "anywhere" }}>
      <div style={{ fontSize: 13, color: "#E8D5A3", marginBottom: 4 }}>{asText(title)}</div>
      {value && <div style={{ fontSize: 12, color: "#A89060", lineHeight: 1.6 }}>{asText(value)}</div>}
      {note && <div style={{ fontSize: 11, color: "#6A5C3A", lineHeight: 1.5, marginTop: 3 }}>{asText(note)}</div>}
    </div>
  );
}

function Note({ children, col }) {
  return <div style={{ fontSize: 11, color: col || "#8A7A58", marginTop: 3, lineHeight: 1.5 }}>{children}</div>;
}

function EdgAudit({ result }) {
  const edg = result?.nexoModules?.EDG;
  const governance = result?.edg_governance;

  if (!edg) return null;

  const changes = asArray(governance?.changes);
  const comparison = governance?.comparison;
  const signal = edg.exit_signal === "edge_expired" ? "Edge expirado" : "Nenhum";
  const ceiling = edg.max_allowed_classification === "posicao" ? "Posição" : "Watchlist";

  return (
    <Sec title="EDG · Governança de Edge">
      <div className="grid3">
        <MetricCard title="Tipo" value={EDGE_TYPE_LABELS[edg.edge_type] || edg.edge_type} note={EDGE_STATUS_LABELS[edg.edge_status] || edg.edge_status} />
        <MetricCard title="Teto permitido" value={ceiling} note={edg.has_declared_edge ? "Edge válido no contrato" : "Regra D2 ativa"} />
        <MetricCard title="Sinal de saída" value={signal} note={edg.exit_signal === "edge_expired" ? "Regra D3 ativa" : "Sem gatilho D3"} />
      </div>

      {comparison && (
        <div className="grid2" style={{ marginTop: 8 }}>
          <MetricCard title="Veredito sem governança EDG" value={comparison.without_edg || "—"} note="Saída analítica bruta do motor" />
          <MetricCard title="Veredito com governança EDG" value={comparison.with_edg || "—"} note="Resultado após aplicação determinística de D2/D3" />
        </div>
      )}

      {governance?.applied && (
        <div className="edg-rule-box">
          <strong>REGRA {governance.rule} APLICADA</strong>
          {changes.map((change, index) => (
            <div key={`${change?.field || "campo"}-${index}`}>
              {asText(change?.field)}: {asText(change?.before)} → {asText(change?.after)}
            </div>
          ))}
        </div>
      )}

      {!governance?.applied && (
        <div className="edg-audit-note">EDG auditado · nenhuma classificação precisou ser alterada nesta etapa.</div>
      )}
    </Sec>
  );
}

function HdlAudit({ result, showUnavailable = false }) {
  const hdl = result?.nexoModules?.HDL;
  if (!hdl) return null;

  if (hdl.status === "not_applicable") {
    return showUnavailable ? (
      <Sec title="HDL · Hurdle do Leviatã">
        <DetailBlock
          title="Não aplicável nesta fase"
          value={hdl.note || "A curva real soberana brasileira não deve ser comparada diretamente com retorno em moeda estrangeira."}
        />
      </Sec>
    ) : null;
  }

  if (hdl.status !== "ok") {
    return showUnavailable ? (
      <Sec title="HDL · Hurdle do Leviatã">
        <DetailBlock title="Cálculo incompleto" value="TIR real e horizonte válidos são obrigatórios para o Deep brasileiro." />
      </Sec>
    ) : null;
  }

  const alpha = Number(hdl.alfa_vs_classe_pp);
  const alphaText = Number.isFinite(alpha)
    ? `${alpha > 0 ? "+" : ""}${displayNumber(alpha)} p.p.`
    : "—";
  const selection = hdl.selection_method === "linear_interpolation"
    ? `Interpolação linear entre ${asArray(hdl.vertices_base_anos).join(" e ")} anos`
    : hdl.selection_method === "shortest_vertex_floor"
    ? `Vértice mínimo oficial de ${asArray(hdl.vertices_base_anos)[0]} ano(s)`
    : "Vértice oficial exato";
  const sourceLabel = hdl.source === "anbima_ettj" ? "ANBIMA ETTJ" : asText(hdl.source);

  return (
    <Sec title="HDL · Hurdle do Leviatã">
      <div className="grid3">
        <MetricCard title="TIR real esperada" value={`${displayNumber(hdl.tir_esperada_pct)}% a.a.`} note={`Horizonte: ${displayNumber(hdl.horizonte_anos)} anos`} />
        <MetricCard title="Hurdle soberano real" value={`${displayNumber(hdl.hurdle_real_pct)}% a.a.`} note={`Curva ANBIMA · ${asText(hdl.curva_as_of)}`} />
        <MetricCard title="Alfa vs. soberano" value={alphaText} note={hdl.supera_hurdle ? "Retorno esperado acima do hurdle" : "Retorno esperado não supera o hurdle"} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Row label="Resultado da comparação" right={<Badge text={hdl.supera_hurdle ? "SUPERA" : "NÃO SUPERA"} />}>
          <Note>{selection}</Note>
        </Row>
        {result?.hdl_conclusao && <DetailBlock title="Conclusão HDL no Deep" value={result.hdl_conclusao} />}
      </div>
      {result?.hdl_integrity?.complete === false && (
        <div className="warn-box">
          HDL INCOMPLETO · a conclusão não trouxe a interpretação obrigatória ou, com alfa não positivo, uma justificativa explícita.
        </div>
      )}
      <div className="edg-audit-note">{asText(hdl.version)} · fonte {sourceLabel} · status {asText(hdl.source_status)} · o módulo não altera score nem veredito.</div>
    </Sec>
  );
}

function NfiAudit({ result, showUnavailable = false }) {
  const nfi = result?.nexoModules?.NFI;
  if (!nfi) return null;
  if (nfi.status === "not_applicable") {
    return showUnavailable ? <Sec title="NFI · NEXO Flow Intelligence"><DetailBlock title="Não aplicável nesta fase" value={nfi.note} /></Sec> : null;
  }
  if (["unavailable", "pending"].includes(nfi.status)) {
    return showUnavailable ? <Sec title="NFI · NEXO Flow Intelligence"><DetailBlock title="Fluxo oficial indisponível" value={nfi.note || "A publicação D+2 ainda não está disponível; nenhum valor foi estimado."} /></Sec> : null;
  }
  const flow = Number(nfi.fluxo_liquido_janela_brl);
  const percentile = nfi.fluxo_percentil_24m ?? nfi.fluxo_percentil_disponivel;
  const flowText = Number.isFinite(flow) ? flow.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "—";
  const percentileText = Number.isFinite(Number(percentile)) ? `${displayNumber(Number(percentile) * 100)}%` : "—";
  return (
    <Sec title="NFI · NEXO Flow Intelligence">
      <div className="grid3">
        <MetricCard title={`Fluxo líquido · ${asText(nfi.janela_dias)} dias`} value={flowText} note={`Mês fechado · ${asText(nfi.window_reference_date || nfi.source_as_of)}`} />
        <MetricCard title={nfi.history_complete ? "Percentil 24 meses" : "Percentil provisório"} value={percentileText} note={`${asText(nfi.history_months)} observações mensais`} />
        <MetricCard title="Pressão observada" value={asText(nfi.pressao).toUpperCase()} note={nfi.explica_deslocamento ? "Fluxo extremo: explicação causal autorizada" : "Sem extremo canônico confirmado"} />
      </div>
      {Number.isFinite(Number(nfi.fluxo_parcial_mes_brl)) && <DetailBlock title={`Mês corrente parcial · até ${asText(nfi.partial_as_of)}`} value={Number(nfi.fluxo_parcial_mes_brl).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} note="Exibido separadamente; não entra no percentil contra meses fechados." />}
      {!nfi.history_complete && <div className="warn-box">HISTÓRICO EM FORMAÇÃO · o percentil é informativo; a regra de extremo só será ativada com 24 meses oficiais completos.</div>}
      <div className="edg-audit-note">{asText(nfi.version)} · fonte B3 D+2 · efeito em valuation: nenhum · não altera score nem veredito.</div>
    </Sec>
  );
}

function BibliotecaAudit({ result }) {
  const library = result?.nexoModules?.BIBLIOTECA;
  if (!library || library.status === "not_applicable") return null;
  const open = asArray(library.lacunas_abertas);
  const resolved = asArray(library.lacunas_resolvidas);
  return (
    <Sec title="Biblioteca Viva · Evidências do Deep">
      <div className="grid3">
        <MetricCard title="Documentos disponíveis" value={asText(library.documents_available || 0)} note={asText(library.version)} />
        <MetricCard title="Lacunas resolvidas" value={asText(resolved.length)} note="Com documento oficial identificado" />
        <MetricCard title="Lacunas abertas" value={asText(open.length)} note={open.length ? "Exigem fonte complementar" : "Nenhuma fonte adicional exigida"} />
      </div>
      {asArray(library.documents_used).map((id, index) => <DetailBlock key={`bib-doc-${index}`} title={`Evidência ${index + 1}`} value={id} />)}
      {open.map((gap, index) => <DetailBlock key={`bib-gap-${index}`} title={`Lacuna aberta ${index + 1}`} value={gap} />)}
      <div className="edg-audit-note">A Biblioteca fornece evidências; score e veredito só mudam por ajuste novo, explícito e reconciliado pelo servidor.</div>
    </Sec>
  );
}

function ScanReport({ r }) {
  const filtros = asArray(r?.filtros);
  const governanca = asArray(r?.governanca);
  const kpis = asArray(r?.kpis);
  const scoreDimensoes = asArray(r?.score_dimensoes);
  const catalisadores = asArray(r?.catalisadores);
  const riscos = asArray(r?.riscos);
  const lacunas = asArray(r?.lacunas_deep);

  return (
    <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.7, color: "#D4C9A8", overflowX: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 16, fontWeight: 700, color: "#E8D5A3", overflowWrap: "anywhere" }}>
            {asText(r?.ticker)} <span style={{ fontSize: 12, color: "#8A7A58", fontWeight: 400 }}>· {asText(r?.nome)}</span>
          </div>
          {r?.segmento && <div style={{ fontSize: 11, color: "#6A5C3A" }}>{asText(r.segmento)}</div>}
        </div>
        <Badge text={r?.veredito} />
      </div>

      <Sec title="Score Geral">
        <ScoreBar score={r?.score_total} max={r?.score_max || 30} />
        {r?.score_resumo && <Note>{asText(r.score_resumo)}</Note>}
      </Sec>

      {filtros.length > 0 && <Sec title="Filtros Eliminatórios">{filtros.map((f, i) => <Row key={i} label={f?.nome} right={<Badge text={f?.status} />}><Note>{asText(f?.valor || f?.nota)}</Note></Row>)}</Sec>}
      {governanca.length > 0 && <Sec title="Governança 0B">{governanca.map((g, i) => <Row key={i} label={g?.dimensao} right={<ScoreBar score={g?.nota} />}><Note>{asText(g?.obs)}</Note></Row>)}</Sec>}
      {kpis.length > 0 && <Sec title="KPIs">{kpis.map((k, i) => <Row key={i} label={k?.nome} right={<Badge text={k?.status} />}><Note col="#A89060">{asText(k?.valor)} {k?.benchmark ? " · ref: " + asText(k.benchmark) : ""}</Note></Row>)}</Sec>}
      {scoreDimensoes.length > 0 && <Sec title="Score por Dimensão">{scoreDimensoes.map((d, i) => <Row key={i} label={d?.nome} right={<ScoreBar score={d?.nota} />}><Note>{asText(d?.obs)}</Note></Row>)}</Sec>}
      {r?.tese && <Sec title="Tese"><Note col="#A89060">{asText(r.tese)}</Note></Sec>}
      {catalisadores.length > 0 && <Sec title="Catalisadores">{catalisadores.map((c, i) => <DetailBlock key={i} title={c?.descricao} value={c?.impacto} note={c?.prazo} />)}</Sec>}
      {riscos.length > 0 && <Sec title="Riscos">{riscos.map((risco, i) => <Row key={i} label={risco?.descricao} right={<Badge text={risco?.severidade} />}><Note>{asText(risco?.probabilidade)}</Note></Row>)}</Sec>}
      {lacunas.length > 0 && <Sec title="Lacunas para o Deep">{lacunas.map((l, i) => <DetailBlock key={i} title={"Lacuna " + (i + 1)} value={l} />)}</Sec>}
      <HdlAudit result={r} />
      <NfiAudit result={r} />
      <EdgAudit result={r} />
    </div>
  );
}

function DeepReport({ r, showClassicValuations = false }) {
  const lacs = asArray(r?.lacunas || r?.lacunas_respondidas);
  const { layers: precs, classics } = splitPriceModels(r, {
    includeClassic: showClassicValuations,
  });
  const macs = asArray(r?.macro || r?.sensibilidade);
  const cats = asArray(r?.catalisadores);
  const risks = asArray(r?.riscos);
  const steps = asArray(r?.passos || r?.proximos_passos);
  const scoreAdjustments = asArray(r?.ajustes_score);

  return (
    <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.7, color: "#D4C9A8", overflowX: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700, color: "#E8D5A3", minWidth: 0 }}>
          {asText(r?.ticker)} · Deep NEXO
        </div>
        {r?.veredito_final && <Badge text={r.veredito_final} />}
      </div>

      {Number.isFinite(Number(r?.score_revisado)) && (
        <Sec title="Evolução auditável do score">
          <Row label="Score de entrada" right={<ScoreBar score={r?.score_original} max={r?.score_max || 30} />} />
          <Row label="Score após o Deep" right={<ScoreBar score={r?.score_revisado} max={r?.score_max || 30} />} />
          <DetailBlock title="Variação calculada pelo servidor" value={r?.mudanca_score || "0"} note="Somente evidências novas do Deep podem alterar o score." />
          {scoreAdjustments.map((adjustment, index) => (
            <DetailBlock
              key={`deep-score-${index}`}
              title={`${adjustment?.dimensao || "Dimensão"} · ${asText(adjustment?.antes)} → ${asText(adjustment?.depois)}`}
              value={adjustment?.motivo}
              note={`Fonte: ${asText(adjustment?.fonte_nova || "DEEP")}`}
            />
          ))}
        </Sec>
      )}

      {lacs.length > 0 && <Sec title="Respostas às Lacunas">{lacs.map((l, i) => <DetailBlock key={i} title={l?.q || l?.lacuna || "Lacuna"} value={l?.r || l?.resposta || l} />)}</Sec>}
      {(precs.length > 0 || classics.length > 0) && (
        <Sec title="Modelo de Preço - 3 Camadas">
          <div style={{ borderLeft: "2px solid #6A5C3A", background: "rgba(201,168,76,.035)", padding: "9px 11px", marginBottom: 10 }}>
            {PRICE_LAYER_GUIDE.map((layer) => (
              <div key={layer.code} style={{ fontSize: 11, color: "#A89060", lineHeight: 1.55, marginBottom: 5 }}>
                <strong style={{ color: "#E8D5A3" }}>{layer.code} · {layer.title}:</strong>{" "}{layer.description}
              </div>
            ))}
            <div style={{ fontSize: 10, color: "#6A5C3A", lineHeight: 1.55, marginTop: 7 }}>
              {PRICE_LAYER_SUMMARY}
            </div>
          </div>
          {precs.map((item, i) => (
            <DetailBlock
              key={`layer-${i}`}
              title={item.label + (item.value ? " · " + item.value : "")}
              value={item.methodology}
              note={item.premises}
            />
          ))}
          {classics.length > 0 && <div className="valuation-subtitle">Valuations clássicos auxiliares</div>}
          {classics.map((item, i) => (
            <DetailBlock
              key={`classic-${i}`}
              title={item.label + (item.value ? " · " + item.value : "")}
              value={item.methodology}
              note={item.premises}
            />
          ))}
        </Sec>
      )}
      {(r?.zona || r?.zona_convergida) && (
        <Sec title="Zona Convergida · BESST">
          <DetailBlock
            title={r?.zona || r?.zona_convergida}
            value={r?.besst || r?.zona_besst ? "Entrada BESST: " + asText(r?.besst || r?.zona_besst) : ""}
            note={r?.desconto || r?.desconto_atual ? "Desconto atual: " + asText(r?.desconto || r?.desconto_atual) : ""}
          />
          {r?.integridade_analise?.besst_corrected && (
            <DetailBlock
              title="BESST corrigido automaticamente"
              value={`Valor retornado pelo motor: ${asText(r.integridade_analise.besst_previous_value)}`}
              note="A faixa foi recalculada para permanecer entre 15% e 25% abaixo da zona de convergência."
            />
          )}
        </Sec>
      )}
      {macs.length > 0 && <Sec title="Sensibilidade Macro">{macs.map((s, i) => <DetailBlock key={i} title={s?.s || s?.cenario} value={s?.i || s?.impacto} note={s?.detalhe} />)}</Sec>}
      {cats.length > 0 && <Sec title="Catalisadores">{cats.map((c, i) => <DetailBlock key={i} title={c?.d || c?.descricao} value={c?.impacto} note={c?.p || c?.prazo} />)}</Sec>}
      {risks.length > 0 && <Sec title="Riscos">{risks.map((risco, i) => <DetailBlock key={i} title={risco?.d || risco?.descricao} value={"Severidade: " + asText(risco?.sev || risco?.severidade || "MEDIO")} note={risco?.g || risco?.gatilho ? "Gatilho: " + asText(risco?.g || risco?.gatilho) : ""} />)}</Sec>}
      {steps.length > 0 && <Sec title="Próximos Passos">{steps.map((p, i) => <DetailBlock key={i} title={"Passo " + (i + 1)} value={p} />)}</Sec>}
      <HdlAudit result={r} showUnavailable />
      <NfiAudit result={r} showUnavailable />
      <BibliotecaAudit result={r} />
      <EdgAudit result={r} />
    </div>
  );
}

function FinalReport({ r }) {
  const riscos = asArray(r?.riscos_incorporados);
  const ajustes = asArray(r?.ajustes_score);
  const passos = asArray(r?.proximos_passos);
  const preco = r?.preco_final || {};

  return (
    <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.7, color: "#D4C9A8", overflowX: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700, color: "#E8D5A3", minWidth: 0 }}>
          {asText(r?.ticker)} · Reclassificação Final NEXO
        </div>
        <Badge text={r?.classificacao_final} />
      </div>

      <Sec title="Score Revisado">
        <Row label="Score original" right={<ScoreBar score={r?.score_original} max={r?.score_max || 30} />} />
        <Row label="Score revisado" right={<ScoreBar score={r?.score_revisado} max={r?.score_max || 30} />} />
        {r?.mudanca_score && <DetailBlock title="Mudança de score" value={r.mudanca_score} />}
        <Row label="Mudança de veredito" right={<Badge text={r?.mudanca_veredito} />}>
          <Note>{asText(r?.veredito_anterior)} → {asText(r?.veredito_reclassificado)}</Note>
        </Row>
      </Sec>

      {r?.integridade_reclassificacao && (
        <Sec title="Integridade da Reclassificação">
          <DetailBlock
            title="Consolidação determinística"
            value={`Base preservada: ${asText(r.integridade_reclassificacao.baseline_phase)}`}
            note="A finalização não executou uma segunda análise nem criou evidências novas."
          />
        </Sec>
      )}

      {riscos.length > 0 && <Sec title="Riscos Incorporados">{riscos.map((risco, i) => <DetailBlock key={i} title={risco?.descricao} value={"Impacto no score: " + asText(risco?.impacto_score)} note={"Severidade: " + asText(risco?.severidade)} />)}</Sec>}
      {ajustes.length > 0 && <Sec title="Ajustes de Score">{ajustes.map((a, i) => <DetailBlock key={i} title={a?.dimensao + " · " + asText(a?.antes) + " → " + asText(a?.depois)} value={a?.motivo} />)}</Sec>}
      {r?.tese_final && <Sec title="Tese Final"><DetailBlock title="Tese consolidada" value={r.tese_final} /></Sec>}

      {(preco?.zona_convergencia || preco?.besst || preco?.margem_seguranca || preco?.observacao) && (
        <Sec title="Preço Final">
          <DetailBlock title="Zona de convergência" value={preco?.zona_convergencia} />
          <DetailBlock title="BESST" value={preco?.besst} />
          <DetailBlock title="Margem de segurança" value={preco?.margem_seguranca} />
          <DetailBlock title="Observação" value={preco?.observacao} />
        </Sec>
      )}

      {r?.conclusao && <Sec title="Conclusão"><DetailBlock title="Conclusão NEXO" value={r.conclusao} /></Sec>}
      {passos.length > 0 && <Sec title="Próximos Passos">{passos.map((p, i) => <DetailBlock key={i} title={"Passo " + (i + 1)} value={p} />)}</Sec>}
      <HdlAudit result={r} showUnavailable />
      <NfiAudit result={r} showUnavailable />
      <EdgAudit result={r} />
    </div>
  );
}

export default function NEXOApp() {
  const [scanResult, setScanResult] = useState(null);
  const [deepResult, setDeepResult] = useState(null);
  const [deepAdds, setDeepAdds] = useState([]);
  const [finalResult, setFinalResult] = useState(null);

  const [ticker, setTicker] = useState("");
  const [extraCtx, setExtraCtx] = useState("");

  const [currency, setCurrency] = useState("BRL");
  const [currentPrice, setCurrentPrice] = useState("");
  const [histMin, setHistMin] = useState("");
  const [histMinDate, setHistMinDate] = useState("");
  const [histMax, setHistMax] = useState("");
  const [histMaxDate, setHistMaxDate] = useState("");

  const [plIbov, setPlIbov] = useState("");
  const [plSp500, setPlSp500] = useState("");
  const [classicValuations, setClassicValuations] = useState("NAO");
  const [hdlExpectedRealReturn, setHdlExpectedRealReturn] = useState("");
  const [hdlHorizonYears, setHdlHorizonYears] = useState("");
  const [edgeType, setEdgeType] = useState("nenhum");
  const [edgeInsumo, setEdgeInsumo] = useState("");
  const [edgeEvidenceTemplate, setEdgeEvidenceTemplate] = useState("");
  const [edgeEvidenceBasis, setEdgeEvidenceBasis] = useState("");
  const [edgeEvidenceWindow, setEdgeEvidenceWindow] = useState("");
  const [edgeEvidenceCustom, setEdgeEvidenceCustom] = useState("");
  const [edgeExpiryTemplate, setEdgeExpiryTemplate] = useState("");
  const [edgeExpiryMetric, setEdgeExpiryMetric] = useState("");
  const [edgeExpiryThreshold, setEdgeExpiryThreshold] = useState("");
  const [edgeExpiryUnit, setEdgeExpiryUnit] = useState("percent");
  const [edgeExpiryPersistence, setEdgeExpiryPersistence] = useState("2");
  const [edgeExpiryPeriod, setEdgeExpiryPeriod] = useState("quarter");
  const [edgeExpiryEvent, setEdgeExpiryEvent] = useState("");
  const [edgeDeadlineObject, setEdgeDeadlineObject] = useState("");
  const [edgeDeadlineDate, setEdgeDeadlineDate] = useState("");
  const [edgeExpiryCustom, setEdgeExpiryCustom] = useState("");
  const [edgeDeclaredAt, setEdgeDeclaredAt] = useState("");
  const [edgeStatus, setEdgeStatus] = useState("nao_declarado");

  const [assetData, setAssetData] = useState(null);
  const [assetError, setAssetError] = useState("");
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetLookupStatus, setAssetLookupStatus] = useState(ASSET_LOOKUP_STATUS.IDLE);

  const [macroData, setMacroData] = useState(null);
  const [macroError, setMacroError] = useState("");
  const [macroLoading, setMacroLoading] = useState(false);
  const [useComplementaryData, setUseComplementaryData] = useState("NAO");
  const [supplementalLoading, setSupplementalLoading] = useState(false);
  const [supplementalLoaded, setSupplementalLoaded] = useState(false);
  const [supplementalError, setSupplementalError] = useState("");
  const [ibovManual, setIbovManual] = useState("");
  const [sp500Manual, setSp500Manual] = useState("");
  const [ifixManual, setIfixManual] = useState("");
  const [jurosFuturoManual, setJurosFuturoManual] = useState("");

  const [phase, setPhase] = useState("initial");
  const [loading, setLoading] = useState(false);
  const [loadingKind, setLoadingKind] = useState("");
  const [error, setError] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const [followQ, setFollowQ] = useState("");
  const [followUrl, setFollowUrl] = useState("");
  const [ended, setEnded] = useState(false);
  const [activeView, setActiveView] = useState(ANALYSIS_VIEW.SETUP);
  const [hdlGuideActive, setHdlGuideActive] = useState(false);

  const abortRef = useRef(null);
  const assetAbortRef = useRef(null);
  const macroAbortRef = useRef(null);
  const supplementalAbortRef = useRef(null);
  const pageTopRef = useRef(null);
  const hdlSectionRef = useRef(null);
  const hdlReturnInputRef = useRef(null);
  const hdlHorizonInputRef = useRef(null);
  const deepActionRef = useRef(null);

  const hasScan = !!scanResult;
  const hasDeep = !!deepResult;
  const hasFinal = !!finalResult;
  const isVeto = scanResult?.veredito === "VETADO";
  const locked = loading || hasScan || hasDeep || hasFinal || ended;
  const currentAssetType = detectType(ticker);
  const isExternalAsset = currentAssetType === "stock-ext" || currentAssetType === "etf-ext";
  const hdlApplies = currentAssetType === "acao-br" || currentAssetType === "fii";
  const hdlReturnNumber = localizedNumber(hdlExpectedRealReturn);
  const hdlHorizonNumber = localizedNumber(hdlHorizonYears);
  const hdlReturnReady = hdlReturnNumber !== null && hdlReturnNumber > -100;
  const hdlHorizonReady =
    hdlHorizonNumber !== null &&
    hdlHorizonNumber >= HDL_MIN_HORIZON_YEARS &&
    hdlHorizonNumber <= HDL_MAX_HORIZON_YEARS;
  const hdlInputReady =
    !hdlApplies ||
    (hdlReturnReady && hdlHorizonReady);
  const hdlLocked =
    loading || hasDeep || hasFinal || ended || (hasScan && edgeInsumo === "HDL");
  const edgLocked = locked || isExternalAsset;

  const macro = macroData?.automatic || {};
  const priceUnit = currency === "USD" ? "USD" : "R$";
  const edgeEvidenceOptions = evidenceOptionsForType(edgeType);
  const selectedInsumo = EDGE_INSUMO_METADATA[edgeInsumo] || null;
  const selectedEvidenceTemplate = edgeEvidenceOptions.find(
    (option) => option.id === edgeEvidenceTemplate
  );
  const selectedExpiryEvent = EDGE_EXPIRY_EVENTS.find(
    (option) => option.id === edgeExpiryEvent
  );
  const edgeEvidence = buildGuidedEdgeEvidence({
    edgeType,
    edgeInsumo,
    templateId: edgeEvidenceTemplate,
    basisId: edgeEvidenceBasis,
    windowId: edgeEvidenceWindow,
    customText: edgeEvidenceCustom,
  });
  const edgeExpiryCondition = buildGuidedExpiryCondition({
    templateId: edgeExpiryTemplate,
    metricId: edgeExpiryMetric,
    threshold: edgeExpiryThreshold,
    unitId: edgeExpiryUnit,
    persistence: edgeExpiryPersistence,
    periodId: edgeExpiryPeriod,
    eventId: edgeExpiryEvent,
    deadlineObjectId: edgeDeadlineObject,
    deadlineDate: edgeDeadlineDate,
    customText: edgeExpiryCustom,
  });
  const edgeLedger = isExternalAsset
    ? { edge_type: "nenhum", edge_status: "nao_declarado" }
    : {
        edge_type: edgeType,
        edge_evidence: edgeEvidence,
        edge_insumo: edgeInsumo,
        edge_expiry_condition: edgeExpiryCondition,
        edge_declared_at: edgeDeclaredAt,
        edge_status: edgeStatus,
      };
  const nfiEdgeReady = macroData?.nmi?.flowIntelligence?.explica_deslocamento === true;
  const availableEdgeModules = EDGE_INSUMOS.filter(
    (insumo) => EDGE_INSUMO_METADATA[insumo]?.available !== false && (insumo !== "NFI" || nfiEdgeReady)
  );
  const edgeGate = resolveEdgeScanGate({
    record: edgeLedger,
    availableModules: availableEdgeModules,
    errorLabels: EDG_ERROR_LABELS,
  });
  const scannedEdg = scanResult?.nexoModules?.EDG || null;
  const requiredInputsReady =
    ticker.trim().length >= 3 &&
    currentPrice.trim().length > 0;
  const complementaryPending =
    useComplementaryData === "SIM" && supplementalLoading;
  const hdlRequiredForScan = hdlApplies && edgeInsumo === "HDL";

  const scanBlockReason = !ticker.trim()
    ? "Informe o ticker."
    : ticker.trim().length < 3
    ? "Ticker precisa ter pelo menos 3 caracteres."
    : assetLoading
    ? "Aguarde a busca automática da cotação e dos indicadores."
    : assetLookupStatus === ASSET_LOOKUP_STATUS.NOT_FOUND
    ? "Ticker inexistente."
    : assetLookupStatus === ASSET_LOOKUP_STATUS.UNAVAILABLE
    ? "Não foi possível validar o ticker no provedor automático."
    : !currentPrice.trim()
    ? assetLookupStatus === ASSET_LOOKUP_STATUS.MANUAL_FALLBACK
      ? "Ticker confirmado. Informe o valor atual manualmente."
      : "Aguarde a validação do ticker e da cotação."
    : !edgeGate.ready
    ? "EDG incompleto ou incoerente: " + edgeGate.reason
    : hdlRequiredForScan && !hdlInputReady
    ? `O edge usa HDL: informe a TIR real esperada e um horizonte entre ${HDL_MIN_HORIZON_YEARS} e ${HDL_MAX_HORIZON_YEARS} anos.`
    : complementaryPending
    ? "Aguarde o carregamento dos dados complementares selecionados."
    : "";

  const canScan = requiredInputsReady && edgeGate.ready && (!hdlRequiredForScan || hdlInputReady) && !assetLoading && !complementaryPending && !loading && !hasScan && !hasDeep && !hasFinal && !ended;
  const canDeep = hasScan && !hasDeep && !isVeto && hdlInputReady && !loading && !hasFinal && !ended;
  const deepBlockReason = !hdlApplies
    ? ""
    : hdlExpectedRealReturn.trim() === "" || hdlHorizonYears.trim() === ""
    ? "Informe a TIR real esperada e o horizonte do investimento."
    : !hdlInputReady
    ? `Use TIR real válida e horizonte entre ${HDL_MIN_HORIZON_YEARS} e ${HDL_MAX_HORIZON_YEARS} anos; extrapolação além da curva é proibida.`
    : "";
  const canFinalize = (hasScan || hasDeep) && !loading && !hasFinal && !ended;
  const latestDeep = deepAdds.at(-1) || deepResult;
  const bibliotecaAudit = latestDeep?.nexoModules?.BIBLIOTECA || null;
  const needsUserSource = !isExternalAsset && bibliotecaAudit?.requires_user_source === true;
  const canFollow = hasDeep && !loading && !hasFinal && !ended && (
    needsUserSource ? isValidHttpsUrl(followUrl) : Boolean(followQ.trim())
  );
  const analysisTabs = buildAnalysisTabs({
    hasScan,
    hasDeep,
    deepAddsCount: deepAdds.length,
    hasFinal,
    loadingKind,
  });
  const currentDeepView = latestDeepViewId(deepAdds.length);
  const activeDeepIndex = /^deep-(\d+)$/.test(activeView)
    ? Number(activeView.replace("deep-", ""))
    : null;
  const activeDeepResult = activeDeepIndex === 0
    ? deepResult
    : activeDeepIndex > 0
    ? deepAdds[activeDeepIndex - 1]
    : null;
  const latestAnalysis = finalResult || latestDeep || scanResult;
  const latestVerdict = finalResult?.classificacao_final || latestDeep?.veredito_final || scanResult?.veredito || "—";
  const latestScore = finalResult?.score_revisado ?? latestDeep?.score_revisado ?? scanResult?.score_total ?? null;

  function navigateAnalysis(view) {
    const tab = analysisTabs.find((item) => item.id === view);
    if (!tab?.enabled || loading) return;
    setActiveView(view);
    window.requestAnimationFrame(() => {
      pageTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function openHdlFromDeep() {
    setHdlGuideActive(true);
    setActiveView(ANALYSIS_VIEW.SETUP);
    window.requestAnimationFrame(() => {
      hdlSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => {
        const target = !hdlReturnReady ? hdlReturnInputRef.current : hdlHorizonInputRef.current;
        target?.focus();
      }, 350);
    });
  }

  function returnToDeepAction() {
    if (!hdlInputReady) return;
    setHdlGuideActive(false);
    setActiveView(ANALYSIS_VIEW.SCAN);
    window.requestAnimationFrame(() => {
      deepActionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => deepActionRef.current?.focus(), 350);
    });
  }

  useEffect(() => {
    void loadMacro();
    return () => {
      macroAbortRef.current?.abort();
      supplementalAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const normalizedTicker = ticker.trim().toUpperCase();
    assetAbortRef.current?.abort();
    setAssetData(null);
    setAssetError("");
    setAssetLookupStatus(ASSET_LOOKUP_STATUS.IDLE);
    setCurrentPrice("");
    setHistMin("");
    setHistMinDate("");
    setHistMax("");
    setHistMaxDate("");

    if (normalizedTicker.length < 3) {
      setAssetLoading(false);
      return undefined;
    }

    setAssetLoading(true);
    setAssetLookupStatus(ASSET_LOOKUP_STATUS.LOADING);
    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      assetAbortRef.current = controller;
      try {
        const response = await fetch(
          `/api/asset?ticker=${encodeURIComponent(normalizedTicker)}`,
          { signal: controller.signal, cache: "no-store" }
        );
        const data = await response.json();
        const prefill = data?.ok ? assetPrefill(data) : {};
        const lookupStatus = resolveAssetLookupState({
          responseOk: response.ok,
          data,
          hasAutomaticPrice: Boolean(prefill.currentPrice),
        });

        setAssetLookupStatus(lookupStatus);

        if (lookupStatus === ASSET_LOOKUP_STATUS.NOT_FOUND) {
          setAssetError("Ticker inexistente");
          return;
        }

        if (lookupStatus === ASSET_LOOKUP_STATUS.UNAVAILABLE) {
          setAssetError(data?.error || "Não foi possível validar o ticker no provedor automático");
          return;
        }

        setAssetData(data);
        if (prefill.currentPrice) setCurrentPrice(prefill.currentPrice);
        if (prefill.currency) setCurrency(prefill.currency);
        if (prefill.histMin) setHistMin(prefill.histMin);
        if (prefill.histMinDate) setHistMinDate(prefill.histMinDate);
        if (prefill.histMax) setHistMax(prefill.histMax);
        if (prefill.histMaxDate) setHistMaxDate(prefill.histMaxDate);

        if (lookupStatus === ASSET_LOOKUP_STATUS.MANUAL_FALLBACK) {
          setAssetError("Ticker confirmado, mas a cotação automática está indisponível");
        }
      } catch (fetchError) {
        if (fetchError?.name !== "AbortError") {
          setAssetLookupStatus(ASSET_LOOKUP_STATUS.UNAVAILABLE);
          setAssetError("Não foi possível validar o ticker no provedor automático");
        }
      } finally {
        if (assetAbortRef.current === controller) {
          setAssetLoading(false);
          assetAbortRef.current = null;
        }
      }
    }, 650);

    return () => {
      window.clearTimeout(timer);
      assetAbortRef.current?.abort();
    };
  }, [ticker]);

  function buildManualContext() {
    const automaticAssetContext = compactAssetContext(assetData);
    const complementaryContext = buildComplementaryMacroContext({
      enabled: useComplementaryData === "SIM",
      automatic: macro,
      manual: {
        ibov: ibovManual,
        sp500: sp500Manual,
        ifix: ifixManual,
        plIbov,
        plSp500,
        jurosFuturo: jurosFuturoManual,
      },
    });

    return (
      "Dados do ativo e parâmetros fornecidos para refinar a análise:\n" +
      "- Moeda selecionada: " + currency + "\n" +
      "- Valor atual/cota atual: " + (currentPrice || "não informado") + "\n" +
      "- Mínimo histórico: " + (histMin || "não informado") + "\n" +
      "- Data do mínimo histórico: " + (histMinDate || "não informada") + "\n" +
      "- Máximo histórico: " + (histMax || "não informado") + "\n" +
      "- Data do máximo histórico: " + (histMaxDate || "não informada") + "\n" +
      "- Calcular valuations clássicos como referência auxiliar na análise final? " + classicValuations + "\n" +
      "- HDL — TIR real esperada (% a.a.): " + (hdlExpectedRealReturn || "não informada") + "\n" +
      "- HDL — horizonte (anos): " + (hdlHorizonYears || "não informado") + "\n" +
      "- Macro fundamental: usar o Context Package NMI validado e injetado pelo servidor; não duplicar nem sobrescrever com dados do ativo.\n" +
      complementaryContext +
      "- Dados automáticos do ativo (HG Brasil/Twelve Data): " +
      (automaticAssetContext ? JSON.stringify(automaticAssetContext) : "indisponíveis; usar fallback manual") + "\n" +
      "Regra de prioridade: se houver valor manual informado pelo usuário, usar o manual. Se manual vazio, usar o automático. Se automático indisponível, marcar como não informado.\n" +
      "Observação: os valuations Buffett moderno, Peter Lynch, Graham e Bazin, quando solicitados, devem ser usados apenas como referência complementar, nunca como decisão principal.\n"
    );
  }

  function resetToInitial() {
    abortRef.current?.abort();
    assetAbortRef.current?.abort();
    supplementalAbortRef.current?.abort();
    setScanResult(null);
    setDeepResult(null);
    setDeepAdds([]);
    setFinalResult(null);
    setTicker("");
    setExtraCtx("");
    setCurrency("BRL");
    setCurrentPrice("");
    setHistMin("");
    setHistMinDate("");
    setHistMax("");
    setHistMaxDate("");
    setPlIbov("");
    setPlSp500("");
    setClassicValuations("NAO");
    setHdlExpectedRealReturn("");
    setHdlHorizonYears("");
    setEdgeType("nenhum");
    setEdgeInsumo("");
    setEdgeEvidenceTemplate("");
    setEdgeEvidenceBasis("");
    setEdgeEvidenceWindow("");
    setEdgeEvidenceCustom("");
    setEdgeExpiryTemplate("");
    setEdgeExpiryMetric("");
    setEdgeExpiryThreshold("");
    setEdgeExpiryUnit("percent");
    setEdgeExpiryPersistence("2");
    setEdgeExpiryPeriod("quarter");
    setEdgeExpiryEvent("");
    setEdgeDeadlineObject("");
    setEdgeDeadlineDate("");
    setEdgeExpiryCustom("");
    setEdgeDeclaredAt("");
    setEdgeStatus("nao_declarado");
    setAssetData(null);
    setAssetError("");
    setAssetLoading(false);
    setAssetLookupStatus(ASSET_LOOKUP_STATUS.IDLE);
    setUseComplementaryData("NAO");
    setSupplementalLoading(false);
    setSupplementalLoaded(false);
    setSupplementalError("");
    setIbovManual("");
    setSp500Manual("");
    setIfixManual("");
    setJurosFuturoManual("");
    setPhase("initial");
    setLoading(false);
    setLoadingKind("");
    setError("");
    setPdfError("");
    setPdfLoading(false);
    setFollowQ("");
    setFollowUrl("");
    setEnded(false);
    setActiveView(ANALYSIS_VIEW.SETUP);
    setHdlGuideActive(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function loadMacro() {
    setMacroLoading(true);
    setMacroError("");
    const controller = new AbortController();

    try {
      macroAbortRef.current?.abort();
      macroAbortRef.current = controller;

      const nmiResponse = await fetch("/api/nmi/context/latest", {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      const nmiText = await nmiResponse.text();
      let nmiPackage = null;

      try {
        nmiPackage = JSON.parse(nmiText);
      } catch {
        nmiPackage = null;
      }

      if (!nmiResponse.ok || !nmiPackage?.context_id) {
        throw new Error("Context Package NMI indisponível na interface");
      }

      const nmiData = nmiContextToMacroData(nmiPackage);
      setMacroData((current) => mergeMacroData(nmiData, current));
    } catch (e) {
      if (e?.name !== "AbortError") {
        setMacroError("A exibição do NMI está temporariamente indisponível. O servidor ainda valida o contexto antes de cada análise e o Scan permanece liberado.");
      }
    } finally {
      if (macroAbortRef.current === controller) {
        setMacroLoading(false);
        macroAbortRef.current = null;
      }
    }
  }

  async function loadSupplementalMacro() {
    if (supplementalLoading || supplementalLoaded) return;

    setSupplementalLoading(true);
    setSupplementalError("");
    const controller = new AbortController();

    try {
      supplementalAbortRef.current?.abort();
      supplementalAbortRef.current = controller;

      const response = await fetch("/api/macro", {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      let data = null;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Resposta complementar inválida");
      }

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Dados complementares indisponíveis");
      }

      setMacroData((current) => mergeMacroData(current, data));
      setSupplementalLoaded(true);
    } catch (e) {
      if (e?.name !== "AbortError") {
        setSupplementalError("Não foi possível carregar os complementos agora. Você ainda pode preencher somente os campos relevantes ou selecionar NÃO.");
      }
    } finally {
      if (supplementalAbortRef.current === controller) {
        setSupplementalLoading(false);
        supplementalAbortRef.current = null;
      }
    }
  }

  function handleComplementaryMode(value) {
    setUseComplementaryData(value);
    setSupplementalError("");
    if (value === "SIM") void loadSupplementalMacro();
  }

  function handleEdgeType(value) {
    setEdgeType(value);
    setEdgeEvidenceTemplate("");
    setEdgeEvidenceBasis("");
    setEdgeEvidenceWindow("");
    setEdgeEvidenceCustom("");

    if (value === "nenhum") {
      setEdgeInsumo("");
      setEdgeExpiryTemplate("");
      setEdgeExpiryMetric("");
      setEdgeExpiryThreshold("");
      setEdgeExpiryEvent("");
      setEdgeDeadlineObject("");
      setEdgeDeadlineDate("");
      setEdgeExpiryCustom("");
      setEdgeDeclaredAt("");
      setEdgeStatus("nao_declarado");
      return;
    }

    if (!edgeInsumo) setEdgeInsumo("IQD");
    if (!edgeDeclaredAt) setEdgeDeclaredAt(localIsoDate());
    setEdgeStatus("ativo");
  }

  function handleExpiryTemplate(value) {
    setEdgeExpiryTemplate(value);
    setEdgeExpiryMetric("");
    setEdgeExpiryThreshold("");
    setEdgeExpiryEvent("");
    setEdgeDeadlineObject("");
    setEdgeDeadlineDate("");
    setEdgeExpiryCustom("");
  }

  async function callAPI(ph, overrideCtx = "", analysisHistory = {}) {
    const controller = new AbortController();
    abortRef.current = controller;

    const t = ticker.trim().toUpperCase();
    const tp = detectType(t);

    let summary = "";

    if (ph === "deep" && scanResult) {
      summary =
        asText(scanResult.veredito) +
        "|" +
        asText(scanResult.segmento) +
        "|" +
        asArray(scanResult.lacunas_deep).slice(0, 2).map(asText).join("|");
    }

    const manualCtx = buildManualContext();
    const userCtx = overrideCtx || (extraCtx ? extraCtx.trim() : "");
    const mergedCtx = manualCtx + "\nContexto adicional do usuário:\n" + (userCtx || "não informado");

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        phase: ph,
        assetType: tp,
        ticker: t,
        scanSummary: summary,
        extraCtx: mergedCtx,
        edgeLedger,
        hdlInput: {
          tir_esperada_pct: hdlExpectedRealReturn,
          horizonte_anos: hdlHorizonYears,
        },
        analysisHistory,
      }),
    });

    const data = await readApiJsonResponse(res);

    if (data?.error) throw new Error(asText(data.error.message || data.error));
    return data;
  }

  async function handleScan() {
    if (!canScan) return;

    setLoading(true);
    setLoadingKind("scan");
    setError("");
    setScanResult(null);
    setDeepResult(null);
    setDeepAdds([]);
    setFinalResult(null);
    setEnded(false);
    setPhase("scan_running");
    setActiveView(ANALYSIS_VIEW.SCAN);

    try {
      const r = await callAPI("scan");

      if (r?.ticker_invalido) {
        setError("Ticker não encontrado: " + ticker.trim().toUpperCase());
        setPhase("scan_done");
        setActiveView(ANALYSIS_VIEW.SETUP);
      } else {
        setScanResult(r);
        setPhase("scan_done");
      }
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "Erro desconhecido");
      setPhase("scan_done");
      setActiveView(ANALYSIS_VIEW.SETUP);
    } finally {
      setLoading(false);
      setLoadingKind("");
      abortRef.current = null;
    }
  }

  async function handleDeep() {
    if (!canDeep) return;

    setLoading(true);
    setLoadingKind("deep");
    setError("");
    setPhase("deep_running");
    setActiveView(ANALYSIS_VIEW.DEEP_MAIN);
    setHdlGuideActive(false);

    try {
      const r = await callAPI("deep", "", { scan: scanResult });
      setDeepResult(r);
      setPhase("deep_done");
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "Erro desconhecido");
      setPhase("scan_done");
      setActiveView(ANALYSIS_VIEW.SCAN);
    } finally {
      setLoading(false);
      setLoadingKind("");
      abortRef.current = null;
    }
  }

  async function handleFollowUp() {
    if (!canFollow) return;

    setLoading(true);
    setLoadingKind("follow");
    setError("");

    try {
      let importedSource = null;
      if (needsUserSource) {
        const importResponse = await fetch("/api/biblioteca/ingest-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: ticker.trim().toUpperCase(), assetType: currentAssetType, url: followUrl.trim() }),
        });
        const imported = await readApiJsonResponse(importResponse);
        if (!importResponse.ok || !imported?.ok) throw new Error(imported?.error?.message || "Não foi possível importar a fonte para a Biblioteca Viva.");
        importedSource = imported.result;
      }
      const contexto =
        "Aprofundamento adicional do Deep NEXO.\n" +
        (importedSource ? "Fonte complementar importada e processada pela Biblioteca: " + importedSource.dedupKey + "\n" : "") +
        (followQ.trim() ? "Pergunta/foco do usuário: " + followQ.trim() + "\n" : "") +
        "\nGere um NOVO resultado de Deep aprofundado em JSON válido, mantendo o mesmo schema. Não apague nem substitua o Deep anterior.\n" +
        "Deep anterior:\n" +
        JSON.stringify(deepResult || {}) +
        "\nAprofundamentos anteriores:\n" +
        JSON.stringify(deepAdds || []);

      const r = await callAPI("deep", contexto, {
        scan: scanResult,
        deep: deepResult,
        deepAdds,
      });
      setDeepAdds((prev) => [...prev, r]);
      setActiveView(`deep-${deepAdds.length + 1}`);
      setFollowQ("");
      setFollowUrl("");
      setPhase("deep_done");
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "Erro desconhecido");
    } finally {
      setLoading(false);
      setLoadingKind("");
      abortRef.current = null;
    }
  }

  async function handleFinal() {
    if (!canFinalize) return;

    setLoading(true);
    setLoadingKind("final");
    setError("");
    setPhase("final_running");
    setActiveView(ANALYSIS_VIEW.FINAL);

    try {
      const contexto =
        "Histórico completo para Reclassificação Final NEXO:\n\n" +
        buildManualContext() +
        "\nTICKER:\n" +
        ticker.trim().toUpperCase() +
        "\n\nTIPO DO ATIVO:\n" +
        detectType(ticker) +
        "\n\nCONTEXTO INICIAL DO USUÁRIO:\n" +
        (extraCtx || "") +
        "\n\nSCAN ORIGINAL:\n" +
        JSON.stringify(scanResult || {}, null, 2) +
        "\n\nDEEP PRINCIPAL:\n" +
        JSON.stringify(deepResult || {}, null, 2) +
        "\n\nDEEPS APROFUNDADOS:\n" +
        JSON.stringify(deepAdds || [], null, 2);

      const r = await callAPI("final", contexto, {
        scan: scanResult,
        deep: deepResult,
        deepAdds,
      });
      setFinalResult(r);
      setEnded(true);
      setPhase("final_done");
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "Erro desconhecido");
      setPhase(hasDeep ? "deep_done" : "scan_done");
      setActiveView(hasDeep ? currentDeepView : ANALYSIS_VIEW.SCAN);
    } finally {
      setLoading(false);
      setLoadingKind("");
      abortRef.current = null;
    }
  }

  async function handleExportPDF() {
    if (!hasFinal || pdfLoading) return;

    const normalizedTicker = ticker.trim().toUpperCase();
    const date = new Date().toISOString().slice(0, 10);
    const fallbackFilename = `NEXO_${normalizedTicker}_${date}.pdf`;
    const mobileDelivery = isMobilePdfEnvironment(navigator);
    let saveHandle = null;
    let previewWindow = null;

    setPdfLoading(true);
    setPdfError("");
    try {
      if (!mobileDelivery) {
        previewWindow = window.open("", "_blank");
        if (previewWindow) {
          previewWindow.document.title = "Relatório NEXO";
          previewWindow.document.body.textContent = "Preparando relatório NEXO...";
        }
        saveHandle = await choosePdfSaveHandle(window, fallbackFilename);
      }

      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportVersion: "NEXO_REPORT_V1",
          generatedAt: new Date().toISOString(),
          ticker: normalizedTicker,
          assetType: detectType(normalizedTicker),
          currency,
          asset: compactAssetContext(assetData),
          macro: macroData,
          edge: edgeLedger,
          hdlInput: {
            tir_esperada_pct: hdlExpectedRealReturn,
            horizonte_anos: hdlHorizonYears,
          },
          scan: scanResult,
          deep: deepResult,
          deepAdds,
          final: finalResult,
          options: { classicValuations },
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Não foi possível gerar o PDF.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || fallbackFilename;
      const file = new File([blob], filename, { type: "application/pdf" });

      if (canSharePdfFile(navigator, file)) {
        await navigator.share({
          files: [file],
          title: `Relatório NEXO · ${normalizedTicker}`,
          text: `Relatório final da análise NEXO de ${normalizedTicker}.`,
        });
        return;
      }

      const url = window.URL.createObjectURL(blob);
      const savedWithPicker = await writePdfToHandle(saveHandle, blob);
      if (!savedWithPicker) triggerPdfDownload({ documentRef: document, url, filename });

      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.href = url;
      } else {
        window.open(url, "_blank");
      }
      window.setTimeout(() => window.URL.revokeObjectURL(url), 120_000);
    } catch (exportError) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      if (!isPdfDeliveryCancellation(exportError)) {
        setPdfError(exportError?.message || "Não foi possível gerar o PDF.");
      }
    } finally {
      setPdfLoading(false);
    }
  }

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Inter:wght@300;400;500;600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#131008;color:#D4C9A8;font-family:'Inter',sans-serif;min-height:100vh}
    .app{max-width:960px;margin:0 auto;padding:0 16px 48px;overflow-x:hidden}
    .hdr{border-bottom:1px solid #2A2318;padding:10px 0 8px;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
    .logo-box{font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:#E8D5A3;letter-spacing:3px}
    .logo-s{font-family:'JetBrains Mono',monospace;font-size:9px;color:#4A3E28;letter-spacing:2.5px;text-transform:uppercase}
    .sdot{width:5px;height:5px;border-radius:50%;background:#C9A84C;box-shadow:0 0 5px #C9A84C88;animation:blink 2.5s ease-in-out infinite}
    .sdot-wrap{display:flex;align-items:center;gap:5px;font-family:'JetBrains Mono',monospace;font-size:9px;color:#4A3E28}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
    .quads{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:18px}
    .quad{border:1px solid #2A2318;border-top:2px solid;padding:7px 10px;font-family:'JetBrains Mono',monospace}
    .quad.N{border-top-color:#C9A84C}.quad.E{border-top-color:#D4D4E0}.quad.X{border-top-color:#A8A8B8}.quad.O{border-top-color:#E8D5A3}
    .q-l{font-size:13px;font-weight:700;margin-bottom:1px}
    .quad.N .q-l{color:#C9A84C}.quad.E .q-l{color:#D4D4E0}.quad.X .q-l{color:#A8A8B8}.quad.O .q-l{color:#E8D5A3}
    .q-n{font-size:8px;color:#6A5C3A;letter-spacing:1px;text-transform:uppercase}
    .types{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
    .type-card{font-family:'JetBrains Mono',monospace;font-size:11px;padding:6px 12px;border:1px solid #2A2318;color:#4A3E28;display:flex;align-items:center;gap:6px;border-radius:2px}
    .field{border:1px solid #2A2318;padding:10px 14px 8px;margin-bottom:8px;min-width:0}
    .flbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6A5C3A;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;overflow-wrap:anywhere}
    .finp{width:100%;background:transparent;border:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#E8D5A3;letter-spacing:1.5px;text-transform:uppercase}
    .finp::placeholder{color:#2A2318;font-weight:300;font-size:13px;letter-spacing:0;text-transform:none}
    .finp-sm,.select-sm{width:100%;min-width:0;background:transparent;border:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:12px;color:#A89060}
    .finp-sm::placeholder{color:#2A2318}
    .metric-input{font-size:13px;font-weight:700;color:#E8D5A3}
    .metric-input::placeholder{font-size:12px;font-weight:400;color:#2A2318}
    .select-sm{padding-right:24px;text-overflow:ellipsis}
    .select-sm option{background:#131008;color:#D4C9A8}
    .ftxt{width:100%;background:transparent;border:none;outline:none;resize:none;font-family:'JetBrains Mono',monospace;font-size:11px;color:#A89060;line-height:1.5;max-height:100px;overflow-y:auto}
    .ftxt::placeholder{color:#2A2318}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    .help-box{border:1px solid #2A2318;background:rgba(201,168,76,.04);padding:12px 14px;margin-bottom:14px}
    .help-title{font-family:'JetBrains Mono',monospace;font-size:9px;color:#C9A84C;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
    .help-text{font-size:11px;color:#8A7A58;line-height:1.6}
    .scan-hint{font-family:'JetBrains Mono',monospace;font-size:9px;color:#D2A03C;border:1px solid rgba(210,160,60,.25);background:rgba(210,160,60,.06);padding:9px 12px;margin-bottom:10px;letter-spacing:.8px}
    .warn-box{font-family:'JetBrains Mono',monospace;font-size:9px;color:#D2A03C;border:1px solid rgba(210,160,60,.25);border-left:2px solid #D2A03C;background:rgba(210,160,60,.06);padding:9px 12px;margin:8px 0;line-height:1.5}
    .edg-ok-box{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6DB46D;border:1px solid rgba(109,180,109,.25);border-left:2px solid #6DB46D;background:rgba(109,180,109,.05);padding:9px 12px;margin:8px 0;line-height:1.5}
    .edg-rule-box{font-family:'JetBrains Mono',monospace;font-size:9px;color:#D2A03C;border:1px solid rgba(210,160,60,.25);border-left:2px solid #D2A03C;background:rgba(210,160,60,.06);padding:9px 12px;margin-top:10px;line-height:1.7;overflow-wrap:anywhere}
    .edg-rule-box strong{display:block;letter-spacing:1px;margin-bottom:3px}
    .edg-audit-note{font-family:'JetBrains Mono',monospace;font-size:8px;color:#4A3E28;margin-top:8px;line-height:1.5}
    .valuation-subtitle{font-family:'JetBrains Mono',monospace;font-size:8px;color:#C9A84C;letter-spacing:1.5px;text-transform:uppercase;margin:16px 0 4px;padding-top:10px;border-top:1px solid #2A2318;overflow-wrap:anywhere}
    .choice-help{font-family:'JetBrains Mono',monospace;font-size:9px;color:#8A7A58;border-left:2px solid #6A5C3A;background:rgba(201,168,76,.035);padding:8px 10px;margin:7px 0 10px;line-height:1.55;overflow-wrap:anywhere}
    .choice-help strong{color:#C9A84C;letter-spacing:.5px}
    .selected-detail{font-family:'JetBrains Mono',monospace;font-size:9px;color:#8A7A58;line-height:1.55;margin-top:7px;padding-top:7px;border-top:1px solid #2A2318;white-space:normal;overflow-wrap:anywhere}
    .edg-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #2A2318;background:rgba(201,168,76,.025);padding:9px 10px;margin-bottom:10px;font-family:'JetBrains Mono',monospace;font-size:8px;color:#6A5C3A;line-height:1.5}
    .btn-manual{flex-shrink:0;color:#C9A84C;border:1px solid #6A5C3A;padding:7px 9px;text-decoration:none;text-transform:uppercase;letter-spacing:.7px;border-radius:2px}
    .reserved-box{min-height:72px;border:1px dashed #2A2318;display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;font-family:'JetBrains Mono',monospace;font-size:9px;color:#4A3E28;letter-spacing:1px;line-height:1.5}
    .section-meta{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;font-family:'JetBrains Mono',monospace;font-size:9px;color:#8A7A58;line-height:1.5}
    .subsection-label{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6A5C3A;letter-spacing:1.5px;text-transform:uppercase;margin:14px 0 7px;line-height:1.5;overflow-wrap:anywhere}
    .macro-card{border:1px solid #2A2318;padding:8px 10px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#A89060}
    .macro-title{font-size:8px;color:#6A5C3A;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px}
    .macro-value{font-size:13px;color:#E8D5A3;font-weight:700}
    .macro-note{font-size:8px;color:#4A3E28;margin-top:3px;line-height:1.45;overflow-wrap:anywhere}
    .actions{display:flex;gap:7px;margin-bottom:10px}
    .btn-scan{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:9px 20px;background:linear-gradient(135deg,#C9A84C,#E8D5A3);color:#131008;border:none;cursor:pointer;border-radius:2px;flex:1}
    .btn-deep{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:9px 20px;background:transparent;border:1px solid #A8A8B8;color:#A8A8B8;cursor:pointer;border-radius:2px;flex:1}
    .btn-cl,.btn-end{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6A5C3A;background:transparent;border:1px solid #2A2318;padding:9px 13px;cursor:pointer;letter-spacing:1px;text-transform:uppercase;border-radius:2px}
    .btn-end{border-color:#C9A84C;color:#C9A84C}
    .analysis-shell{scroll-margin-top:12px}
    .analysis-nav{display:flex;gap:6px;overflow-x:auto;padding:2px 0 9px;margin-bottom:8px;scrollbar-width:thin;scrollbar-color:#6A5C3A #1E1A0E}
    .analysis-tab{flex:0 0 auto;min-width:108px;border:1px solid #2A2318;background:rgba(201,168,76,.02);color:#6A5C3A;padding:9px 12px;border-radius:2px;font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;white-space:nowrap}
    .analysis-tab.active{border-color:#C9A84C;color:#E8D5A3;background:rgba(201,168,76,.1)}
    .analysis-tab.complete:not(.active){border-color:#4A3E28;color:#A89060}
    .analysis-tab:disabled{opacity:.28!important}
    .analysis-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;border:1px solid #2A2318;background:rgba(201,168,76,.025);padding:8px;margin-bottom:12px}
    .analysis-summary-item{min-width:0;padding:4px 6px;font-family:'JetBrains Mono',monospace}
    .analysis-summary-label{font-size:7px;color:#4A3E28;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px}
    .analysis-summary-value{font-size:9px;color:#A89060;line-height:1.4;overflow-wrap:anywhere}
    .hdl-route{scroll-margin-top:12px}
    .route-box{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid rgba(210,160,60,.3);background:rgba(210,160,60,.06);padding:10px 12px;margin:10px 0}
    .route-copy{font-family:'JetBrains Mono',monospace;font-size:9px;color:#D2A03C;line-height:1.5}
    .btn-route{flex:0 0 auto;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:9px 13px;background:transparent;border:1px solid #D2A03C;color:#D2A03C;cursor:pointer;border-radius:2px}
    .output{border:1px solid #2A2318;padding:20px 16px;margin-bottom:8px;min-height:120px;position:relative;overflow-x:hidden}
    .out-lbl{position:absolute;top:-1px;left:12px;font-family:'JetBrains Mono',monospace;font-size:8px;color:#6A5C3A;background:#131008;padding:0 6px;letter-spacing:1.5px;text-transform:uppercase}
    .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:140px;gap:8px;opacity:.2}
    .empty-g{font-family:'JetBrains Mono',monospace;font-size:26px;color:#C9A84C}
    .empty-t{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6A5C3A;letter-spacing:2px;text-transform:uppercase}
    .loading-r{display:flex;align-items:center;gap:10px;padding:20px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#6A5C3A;letter-spacing:1px;justify-content:center}
    .err-box{font-family:'JetBrains Mono',monospace;font-size:10px;color:#C87070;background:rgba(200,112,112,.06);border:1px solid rgba(200,112,112,.2);border-left:2px solid #C87070;padding:9px 12px;margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}
    .decision-box,.follow-box{margin-top:20px;border-top:1px solid #2A2318;padding-top:16px}
    .decision-title,.follow-title{font-family:'JetBrains Mono',monospace;font-size:9px;color:#C9A84C;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px}
    .decision-actions,.follow-actions{display:flex;gap:8px;margin-top:10px}
    .ended-box{margin-top:16px;padding:12px 14px;border:1px solid #2A2318;background:rgba(201,168,76,.04);font-family:'JetBrains Mono',monospace;font-size:10px;color:#C9A84C;letter-spacing:1px;text-transform:uppercase}
    .footer{display:flex;gap:12px;flex-wrap:wrap;padding:10px 0 0;border-top:1px solid #1E1A0E;margin-top:4px}
    .fc{font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#3A3020;letter-spacing:.8px;display:flex;align-items:center;gap:4px}
    .fd{width:4px;height:4px;border-radius:50%;flex-shrink:0}
    button:disabled,input:disabled,textarea:disabled,select:disabled{opacity:.3!important;cursor:not-allowed!important}
    @media(max-width:600px){.quads,.grid2,.grid3{grid-template-columns:1fr}.analysis-summary{grid-template-columns:1fr 1fr}.actions,.decision-actions,.follow-actions,.edg-tools,.route-box{flex-direction:column;align-items:stretch}.btn-deep,.btn-scan,.btn-cl,.btn-end,.btn-manual,.btn-route{width:100%;text-align:center}.analysis-tab{min-width:92px;padding:9px 10px}.metric-input.select-sm{font-size:11px;letter-spacing:0}.field{padding-left:12px;padding-right:12px}}
  `;

  return (
    <>
      <style>{CSS}</style>

      <div className="app" ref={pageTopRef}>
        <header className="hdr">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="logo-box">NEXO</div>
            <span className="logo-s">Portfolio Framework Beta</span>
          </div>
          <div className="sdot-wrap"><div className="sdot" /> ONLINE</div>
        </header>

        <div className="quads">
          {[["N", "Núcleo"], ["E", "Estrutural"], ["X", "Exchange"], ["O", "Oportunidade"]].map((q) => (
            <div key={q[0]} className={"quad " + q[0]}>
              <div className="q-l">{q[0]}</div>
              <div className="q-n">{q[1]}</div>
            </div>
          ))}
        </div>

        <div className="types">
          {[{ i: "🏢", l: "FII" }, { i: "📈", l: "Ação BR" }, { i: "🌍", l: "ETF" }, { i: "🔭", l: "Stock" }].map((t) => (
            <div key={t.l} className="type-card"><span style={{ fontSize: 13 }}>{t.i}</span>{t.l}</div>
          ))}
        </div>

        <div className="analysis-shell">
          <nav className="analysis-nav" aria-label="Etapas da análise NEXO">
            {analysisTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`analysis-tab${activeView === tab.id ? " active" : ""}${tab.enabled ? " complete" : ""}`}
                disabled={!tab.enabled || loading}
                aria-current={activeView === tab.id ? "page" : undefined}
                onClick={() => navigateAnalysis(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {(hasScan || loading) && (
            <div className="analysis-summary">
              <div className="analysis-summary-item">
                <div className="analysis-summary-label">Ativo</div>
                <div className="analysis-summary-value">{ticker.trim().toUpperCase() || "—"} · {currentAssetType}</div>
              </div>
              <div className="analysis-summary-item">
                <div className="analysis-summary-label">Página atual</div>
                <div className="analysis-summary-value">{analysisViewLabel(activeView, deepAdds.length)}</div>
              </div>
              <div className="analysis-summary-item">
                <div className="analysis-summary-label">Scan</div>
                <div className="analysis-summary-value">{scanResult ? `${asText(scanResult.veredito)} · ${asText(scanResult.score_total)}/${asText(scanResult.score_max || 30)}` : "Em processamento"}</div>
              </div>
              <div className="analysis-summary-item">
                <div className="analysis-summary-label">Última saída</div>
                <div className="analysis-summary-value">{latestAnalysis ? `${asText(latestVerdict)}${latestScore !== null ? ` · ${asText(latestScore)}/30` : ""}` : "Aguardando"}</div>
              </div>
            </div>
          )}
        </div>

        {activeView === ANALYSIS_VIEW.SETUP && (
          <>

        <div className="help-box">
          <div className="help-title">Como usar o NEXO App</div>
          <div className="help-text">
            1) Informe o ticker. 2) Revise os dados do ativo preenchidos automaticamente.
            3) O Macro Fundamental NMI permanece ativo. Habilite dados complementares somente quando forem úteis para a tese.
            4) Declare um edge verificável no EDG ou mantenha “nenhum” para aplicar o teto de Watchlist.
            5) Execute o Scan. O contexto validado alimenta também o Deep e a Reclassificação Final.
          </div>
        </div>

        <div className="field">
          <div className="flbl">Ticker</div>
          <input className="finp" disabled={locked} value={ticker} maxLength={12} placeholder="Ex: KNSC11, VALE3, VWCE, NVDA" onChange={(e) => setTicker(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }} />
        </div>

        <Sec title="Dados do ativo / ticker">
          {!ticker.trim() ? (
            <div className="reserved-box">AGUARDANDO TICKER · COTAÇÃO, HISTÓRICO E INDICADORES SERÃO EXIBIDOS NESTE BLOCO</div>
          ) : (
            <>
              <div className="section-meta">
                <span>{assetData?.asset?.name || ticker.trim().toUpperCase()}</span>
                <span>
                  {assetLoading
                    ? "CARREGANDO..."
                    : assetLookupStatus === ASSET_LOOKUP_STATUS.FOUND
                    ? "DADOS RECEBIDOS"
                    : assetLookupStatus === ASSET_LOOKUP_STATUS.NOT_FOUND
                    ? "TICKER INEXISTENTE"
                    : assetLookupStatus === ASSET_LOOKUP_STATUS.MANUAL_FALLBACK
                    ? "FALLBACK MANUAL"
                    : assetLookupStatus === ASSET_LOOKUP_STATUS.UNAVAILABLE
                    ? "VALIDAÇÃO INDISPONÍVEL"
                    : "AGUARDANDO"}
                </span>
              </div>

              {assetLookupStatus === ASSET_LOOKUP_STATUS.NOT_FOUND && (
                <div className="err-box">Ticker inexistente</div>
              )}

              {assetLookupStatus === ASSET_LOOKUP_STATUS.UNAVAILABLE && (
                <div className="warn-box">
                  {assetError}. Os campos permanecem bloqueados porque a existência do ticker não pôde ser confirmada.
                </div>
              )}

              {assetLookupStatus === ASSET_LOOKUP_STATUS.MANUAL_FALLBACK && (
                <div className="warn-box">
                  {assetError}. O preenchimento manual foi liberado porque o ticker foi confirmado.
                </div>
              )}

              {assetLoading ? (
                <div className="reserved-box">BUSCANDO COTAÇÃO, HISTÓRICO E INDICADORES...</div>
              ) : assetLookupStatus === ASSET_LOOKUP_STATUS.FOUND && assetData?.ok ? (
                <>
                  <div className="grid3">
                    <MetricCard title="Cotação atual" value={displayMoney(assetData?.asset?.price ?? assetData?.derived?.currentPrice, assetData?.asset?.currency)} note="Automático · somente leitura" />
                    <MetricCard title="Moeda" value={assetData?.asset?.currency || currency} note="Unidade dos campos de preço" />
                    <MetricCard title="Mínimo histórico" value={displayMoney(assetData?.derived?.minPrice, assetData?.asset?.currency)} note={histMinDate ? `Data · ${histMinDate}` : "Data indisponível"} />
                    <MetricCard title="Máximo histórico" value={displayMoney(assetData?.derived?.maxPrice, assetData?.asset?.currency)} note={histMaxDate ? `Data · ${histMaxDate}` : "Data indisponível"} />
                  </div>
                  <div className="subsection-label">Indicadores automáticos do ativo</div>
                  <div className="grid3">
                    {[
                      ["Variação", assetData?.asset?.changePercent == null ? "—" : `${displayNumber(assetData.asset.changePercent)}%`, "sessão atual"],
                      ["P/L", assetData?.keyIndicators?.pe == null ? "—" : `${displayNumber(assetData.keyIndicators.pe)}x`, "indicador do ativo"],
                      ["P/VP", assetData?.keyIndicators?.pb == null ? "—" : `${displayNumber(assetData.keyIndicators.pb)}x`, "indicador do ativo"],
                      ["Dividend Yield", assetData?.keyIndicators?.dividendYieldPercent == null ? "—" : `${displayNumber(assetData.keyIndicators.dividendYieldPercent)}%`, "12 meses"],
                      ["Liquidez média", displayMoney(assetData?.derived?.averageFinancialVolume, assetData?.asset?.currency) || "—", "volume financeiro diário"],
                    ].map((item) => (
                      <MetricCard key={item[0]} title={item[0]} value={item[1]} note={item[2]} />
                    ))}
                  </div>
                  <div className="macro-note" style={{ marginTop: 8 }}>
                    Fonte: {assetData?.asset?.source || assetData?.asset?.dataProvider || assetData?.route} · {assetData?.asset?.updatedAt || assetData?.updatedAt || ""}
                  </div>
                </>
              ) : assetLookupStatus === ASSET_LOOKUP_STATUS.MANUAL_FALLBACK ? (
                <>
                  <div className="subsection-label">Fallback manual</div>
                  <div className="grid2">
                    <div className="field">
                      <div className="flbl">Valor atual / cota atual ({priceUnit}) *</div>
                      <input className="finp-sm metric-input" disabled={locked} value={currentPrice} placeholder="Ex: 35,80" onChange={(e) => setCurrentPrice(e.target.value)} />
                      <div className="macro-note">Obrigatório somente quando a automação falhar</div>
                    </div>
                    <div className="field">
                      <div className="flbl">Moeda</div>
                      <select className="select-sm metric-input" disabled={locked} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                        <option value="BRL">BRL</option>
                        <option value="USD">USD</option>
                      </select>
                      <div className="macro-note">Unidade do preço informado</div>
                    </div>
                  </div>
                </>
              ) : [ASSET_LOOKUP_STATUS.NOT_FOUND, ASSET_LOOKUP_STATUS.UNAVAILABLE].includes(assetLookupStatus) ? null : (
                <div className="reserved-box">AGUARDANDO RETORNO DOS DADOS AUTOMÁTICOS...</div>
              )}
            </>
          )}
        </Sec>

        <Sec title="Macro fundamental NMI">
          {macroLoading && !macroData?.nmi && <div className="reserved-box">CARREGANDO CONTEXT PACKAGE NMI VALIDADO...</div>}
          {macroData?.nmi?.available && (
            <div className="scan-hint">
              MACRO NMI — CONFIABILIDADE {displayNumber((macroData.nmi.overallConfidence || 0) * 100)}%
            </div>
          )}
          {macroError && <div className="warn-box">{macroError}</div>}

          {!macroLoading && !macroData?.nmi && (
            <div className="reserved-box">NMI INDISPONÍVEL NA INTERFACE · A VALIDAÇÃO DO SERVIDOR CONTINUA OBRIGATÓRIA NO SCAN</div>
          )}

          {macroData?.nmi && (
            <div className="grid2">
              <div className="macro-card">
                <div className="macro-title">Regime macro</div>
                <div className="macro-value">{readableRegime(macroData.nmi.regimeLabel)}</div>
                <div className="macro-note">Regra NMI · convicção {displayNumber((macroData.nmi.regimeConviction || 0) * 100)}%</div>
              </div>
              {[
                ["Selic Meta", macro?.selic_meta],
                ["IPCA 12m", macro?.ipca_12m],
                ["Crédito/PIB", macro?.credit_gdp],
              ].map((m) => (
                <MetricCard key={m[0]} title={m[0]} value={formattedMacroValue(m[0], m[1])} note={m[1]?.ok ? `${m[1]?.source} · ${m[1]?.date || ""}` : "Indisponível no pacote"} />
              ))}
            </div>
          )}
        </Sec>

        <Sec title="Dados complementares opcionais">
          <div className="field">
            <div className="flbl">Usar dados complementares na análise?</div>
            <select className="select-sm" disabled={locked} value={useComplementaryData} onChange={(e) => handleComplementaryMode(e.target.value)}>
              <option value="NAO">NÃO</option>
              <option value="SIM">SIM</option>
            </select>
            <div className="macro-note">Padrão NÃO · habilite apenas quando o contexto de mercado agregar à tese</div>
          </div>

          {useComplementaryData === "NAO" ? (
            <div className="reserved-box">COMPLEMENTOS DESATIVADOS · NÃO SERÃO ENVIADOS À ANÁLISE</div>
          ) : (
            <>
              {supplementalLoading && <div className="scan-hint">CARREGANDO DADOS COMPLEMENTARES...</div>}
              {supplementalError && <div className="warn-box">{supplementalError}</div>}

              <div className="subsection-label">Dados automáticos disponíveis</div>
              <div className="grid3">
                {[
                  ["CDI diário", macro?.cdi_diario],
                  ["Selic diária", macro?.selic_diaria],
                  ["IPCA mensal", macro?.ipca_mensal],
                  ["USD PTAX", macro?.usd_ptax],
                  ["Fed Funds", macro?.fed_funds],
                  ["Ibovespa", macro?.ibovespa_pontos],
                  ["IFIX", macro?.ifix_pontos],
                ].map((m) => (
                  <MetricCard key={m[0]} title={m[0]} value={formattedMacroValue(m[0], m[1])} note={m[1]?.ok ? `${m[1]?.source} · ${m[1]?.date || ""}` : supplementalLoading ? "Carregando..." : "Automação indisponível"} />
                ))}
              </div>

              <div className="subsection-label">Ajustes manuais complementares</div>
              <div className="grid2">
                <div className="field">
                  <div className="flbl">P/L Ibovespa</div>
                  <input className="finp-sm metric-input" disabled={locked} value={plIbov} placeholder="Ex: 8,5" onChange={(e) => setPlIbov(e.target.value)} />
                  <div className="macro-note">Manual · sem fonte pública oficial estável</div>
                </div>
                <div className="field">
                  <div className="flbl">P/L S&P 500</div>
                  <input className="finp-sm metric-input" disabled={locked} value={plSp500} placeholder="Ex: 22,0" onChange={(e) => setPlSp500(e.target.value)} />
                  <div className="macro-note">Manual · sem fonte pública oficial estável</div>
                </div>
                <div className="field">
                  <div className="flbl">Ibovespa pontos</div>
                  <input className="finp-sm metric-input" disabled={locked} value={ibovManual} placeholder={macro?.ibovespa_pontos?.ok ? macroValue(macro.ibovespa_pontos) : "Ex: 145000"} onChange={(e) => setIbovManual(e.target.value)} />
                  <div className="macro-note">{macroStatusText(macro?.ibovespa_pontos)} · manual sobrescreve</div>
                </div>
                <div className="field">
                  <div className="flbl">S&P 500 pontos</div>
                  <input className="finp-sm metric-input" disabled={locked} value={sp500Manual} placeholder={macro?.sp500_pontos?.ok ? macroValue(macro.sp500_pontos) : "Ex: 6100"} onChange={(e) => setSp500Manual(e.target.value)} />
                  <div className="macro-note">Manual até integrar fonte licenciada/confiável</div>
                </div>
                <div className="field">
                  <div className="flbl">IFIX pontos</div>
                  <input className="finp-sm metric-input" disabled={locked} value={ifixManual} placeholder={macro?.ifix_pontos?.ok ? macroValue(macro.ifix_pontos) : "Ex: 3400"} onChange={(e) => setIfixManual(e.target.value)} />
                  <div className="macro-note">{macroStatusText(macro?.ifix_pontos)} · manual sobrescreve</div>
                </div>
                <div className="field">
                  <div className="flbl">Juros futuro Brasil</div>
                  <input className="finp-sm metric-input" disabled={locked} value={jurosFuturoManual} placeholder="Ex: DI Jan/29 13,20%" onChange={(e) => setJurosFuturoManual(e.target.value)} />
                  <div className="macro-note">Manual nesta fase · automação B3 exige coletor dedicado</div>
                </div>
              </div>
            </>
          )}
        </Sec>

        <div className="field">
          <div className="flbl">Usar valuations clássicos?</div>
          <select className="select-sm" disabled={locked} value={classicValuations} onChange={(e) => setClassicValuations(e.target.value)}>
            <option value="NAO">NÃO</option>
            <option value="SIM">SIM</option>
          </select>
          <div className="macro-note">Referência auxiliar, não decisória · escolha independente dos dados complementares</div>
        </div>

        <Sec title="EDG · Declaração e governança do edge">
          <div className="edg-tools">
            <span>Consulte o guia antes de declarar uma vantagem.</span>
            <a className="btn-manual" href="/edg-manual" target="_blank" rel="noreferrer">
              Abrir mini manual EDG ↗
            </a>
          </div>

          {isExternalAsset && (
            <div className="reserved-box">
              EDG INDISPONÍVEL PARA ATIVOS NO EXTERIOR · o contrato é normalizado para “nenhum edge” e permanece sujeito ao teto D2 de Watchlist até a evolução do motor internacional.
            </div>
          )}

          <div className="field">
            <div className="flbl">Tipo de edge</div>
            <select className="select-sm metric-input" disabled={edgLocked} value={edgeType} onChange={(e) => handleEdgeType(e.target.value)}>
              <option value="nenhum">Nenhum edge declarado</option>
              <option value="informacional">Informacional</option>
              <option value="analitico">Analítico</option>
              <option value="estrutural">Estrutural</option>
              <option value="temporal">Temporal</option>
            </select>
            <div className="choice-help">{EDGE_TYPE_DESCRIPTIONS[edgeType]}</div>
          </div>

          {edgeType === "nenhum" ? (
            <div className="warn-box">
              REGRA D2 · Sem edge declarado e verificável, o Scan fica limitado a WATCHLIST e o Deep/Final não pode emitir COMPRAR.
            </div>
          ) : (
            <>
              <div className="grid3">
                <div className="field">
                  <div className="flbl">Insumo NEXO</div>
                  <select className="select-sm metric-input" disabled={edgLocked} value={edgeInsumo} onChange={(e) => setEdgeInsumo(e.target.value)}>
                    <option value="">Selecione</option>
                    {EDGE_INSUMOS.map((insumo) => (
                      <option key={insumo} value={insumo} disabled={EDGE_INSUMO_METADATA[insumo]?.available === false || (insumo === "NFI" && !nfiEdgeReady)}>
                        {insumo}{EDGE_INSUMO_METADATA[insumo]?.available === false ? " · em implementação" : insumo === "NFI" && !nfiEdgeReady ? " · aguardando 24 meses" : ""}
                      </option>
                    ))}
                  </select>
                  <div className="macro-note">Módulo que lastreia a evidência declarada</div>
                </div>

                <div className="field">
                  <div className="flbl">Declarado em</div>
                  <input className="finp-sm metric-input" type="date" disabled={edgLocked} value={edgeDeclaredAt} onChange={(e) => setEdgeDeclaredAt(e.target.value)} />
                  <div className="macro-note">Data registrada no ledger</div>
                </div>

                <div className="field">
                  <div className="flbl">Status do edge</div>
                  <select className="select-sm metric-input" disabled={edgLocked} value={edgeStatus} onChange={(e) => setEdgeStatus(e.target.value)}>
                    <option value="ativo">Ativo</option>
                    <option value="expirado">Expirado</option>
                  </select>
                  <div className="macro-note">Expirado aciona a precedência D3</div>
                </div>
              </div>

              {selectedInsumo && <div className="choice-help"><strong>{edgeInsumo}</strong> · {selectedInsumo.description}</div>}

              <div className="subsection-label">Evidência verificável · formulário guiado</div>
              <div className="grid3">
                <div className="field">
                  <div className="flbl">Padrão da evidência</div>
                  <select className="select-sm metric-input" disabled={edgLocked} value={edgeEvidenceTemplate} onChange={(e) => setEdgeEvidenceTemplate(e.target.value)}>
                    <option value="">Selecione</option>
                    {edgeEvidenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <div className="macro-note">Opções coerentes com o tipo de edge</div>
                </div>

                <div className="field">
                  <div className="flbl">Base verificável</div>
                  <select className="select-sm metric-input" disabled={edgLocked} value={edgeEvidenceBasis} onChange={(e) => setEdgeEvidenceBasis(e.target.value)}>
                    <option value="">Selecione</option>
                    {EDGE_EVIDENCE_BASES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <div className="macro-note">Origem objetiva da evidência</div>
                </div>

                <div className="field">
                  <div className="flbl">Janela observada</div>
                  <select className="select-sm metric-input" disabled={edgLocked} value={edgeEvidenceWindow} onChange={(e) => setEdgeEvidenceWindow(e.target.value)}>
                    <option value="">Selecione</option>
                    {EDGE_EVIDENCE_WINDOWS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <div className="macro-note">Período ao qual a evidência declarada se refere</div>
                </div>
              </div>

              {selectedEvidenceTemplate?.statement && (
                <div className="choice-help">
                  <strong>Significado da opção</strong> · {selectedEvidenceTemplate.statement}.
                </div>
              )}

              {edgeEvidenceTemplate === "custom" && (
                <div className="field">
                  <div className="flbl">Evidência específica · modo avançado</div>
                  <textarea className="ftxt" disabled={edgLocked} rows={3} maxLength={280} value={edgeEvidenceCustom} placeholder="Descreva somente o fato específico que não está no catálogo..." onChange={(e) => setEdgeEvidenceCustom(e.target.value)} />
                  <div className="macro-note">Máximo 280 caracteres · o módulo, a base e a janela continuam obrigatórios</div>
                </div>
              )}

              <div className="subsection-label">Condição observável de expiração · formulário guiado</div>
              <div className="field">
                <div className="flbl">Gatilho que encerra o edge</div>
                <select className="select-sm metric-input" disabled={edgLocked} value={edgeExpiryTemplate} onChange={(e) => handleExpiryTemplate(e.target.value)}>
                  <option value="">Selecione</option>
                  {EDGE_EXPIRY_TEMPLATES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                <div className="macro-note">O caminho guiado gera a condição canônica enviada ao motor</div>
              </div>

              {["metric_below", "metric_above"].includes(edgeExpiryTemplate) && (
                <>
                  <div className="grid3">
                    <div className="field">
                      <div className="flbl">Métrica observada</div>
                      <select className="select-sm metric-input" disabled={edgLocked} value={edgeExpiryMetric} onChange={(e) => setEdgeExpiryMetric(e.target.value)}>
                        <option value="">Selecione</option>
                        {EDGE_EXPIRY_METRICS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                    </div>

                    <div className="field">
                      <div className="flbl">Limite</div>
                      <input className="finp-sm metric-input" inputMode="decimal" disabled={edgLocked} value={edgeExpiryThreshold} placeholder="Ex.: 17 ou 17,5" onChange={(e) => setEdgeExpiryThreshold(e.target.value)} />
                      <div className="macro-note">Valor objetivo do gatilho</div>
                    </div>

                    <div className="field">
                      <div className="flbl">Unidade</div>
                      <select className="select-sm metric-input" disabled={edgLocked} value={edgeExpiryUnit} onChange={(e) => setEdgeExpiryUnit(e.target.value)}>
                        {EDGE_EXPIRY_UNITS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid2">
                    <div className="field">
                      <div className="flbl">Persistência</div>
                      <select className="select-sm metric-input" disabled={edgLocked} value={edgeExpiryPersistence} onChange={(e) => setEdgeExpiryPersistence(e.target.value)}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={String(value)}>{value}</option>)}
                      </select>
                      <div className="macro-note">Quantidade necessária para confirmar o gatilho</div>
                    </div>

                    <div className="field">
                      <div className="flbl">Período</div>
                      <select className="select-sm metric-input" disabled={edgLocked} value={edgeExpiryPeriod} onChange={(e) => setEdgeExpiryPeriod(e.target.value)}>
                        {EDGE_EXPIRY_PERIODS.map((option) => <option key={option.id} value={option.id}>{option.plural}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {edgeExpiryTemplate === "objective_event" && (
                <div className="field">
                  <div className="flbl">Evento objetivo</div>
                  <select className="select-sm metric-input" disabled={edgLocked} value={edgeExpiryEvent} onChange={(e) => setEdgeExpiryEvent(e.target.value)}>
                    <option value="">Selecione</option>
                    {EDGE_EXPIRY_EVENTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <div className="macro-note">Eventos devem ser confirmáveis em fonte oficial</div>
                  {selectedExpiryEvent && (
                    <div className="selected-detail">{selectedExpiryEvent.condition}</div>
                  )}
                </div>
              )}

              {edgeExpiryTemplate === "deadline_unconfirmed" && (
                <div className="grid2">
                  <div className="field">
                    <div className="flbl">Objeto da confirmação</div>
                    <select className="select-sm metric-input" disabled={edgLocked} value={edgeDeadlineObject} onChange={(e) => setEdgeDeadlineObject(e.target.value)}>
                      <option value="">Selecione</option>
                      {EDGE_DEADLINE_OBJECTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </div>

                  <div className="field">
                    <div className="flbl">Data-limite</div>
                    <input className="finp-sm metric-input" type="date" disabled={edgLocked} value={edgeDeadlineDate} onChange={(e) => setEdgeDeadlineDate(e.target.value)} />
                    <div className="macro-note">Sem confirmação nesta data, o edge expira</div>
                  </div>
                </div>
              )}

              {edgeExpiryTemplate === "custom" && (
                <div className="field">
                  <div className="flbl">Condição específica · modo avançado</div>
                  <textarea className="ftxt" disabled={edgLocked} rows={3} maxLength={220} value={edgeExpiryCustom} placeholder="Use métrica + limite + janela, ou evento objetivo..." onChange={(e) => setEdgeExpiryCustom(e.target.value)} />
                  <div className="macro-note">Máximo 220 caracteres · formulações vagas continuam rejeitadas pelo servidor</div>
                </div>
              )}
            </>
          )}

          {!scannedEdg && edgeType !== "nenhum" && !edgeGate.ready && (
            <div className="warn-box">
              <strong>COMPLETE O EDG PARA LIBERAR O SCAN</strong>
              {asArray(edgeGate.validation?.errors).map((code) => (
                <div key={code}>· {EDG_ERROR_LABELS[code] || code}</div>
              ))}
            </div>
          )}

          {!scannedEdg && edgeType !== "nenhum" && edgeGate.ready && (
            <div className="edg-ok-box">EDG PREENCHIDO E COERENTE · O Scan está liberado após a validação dos demais dados obrigatórios.</div>
          )}

          <div className="subsection-label">Prévia determinística do contrato</div>
          <div className="grid3">
            <MetricCard title="Contrato" value={scannedEdg ? scannedEdg.validation?.valid ? "Válido" : "Incompleto" : "—"} note={scannedEdg ? scannedEdg.version : "Disponível após concluir o Scan"} />
            <MetricCard title="Completude" value={scannedEdg ? `${displayNumber(scannedEdg.ledger_completeness * 100)}%` : "—"} note={scannedEdg ? "6 campos canônicos" : "Disponível após concluir o Scan"} />
            <MetricCard title="Teto permitido" value={scannedEdg ? scannedEdg.max_allowed_classification === "posicao" ? "Posição" : "Watchlist" : "—"} note={scannedEdg ? scannedEdg.has_declared_edge ? "Edge verificável" : "Regra D2" : "Disponível após concluir o Scan"} />
            <MetricCard title="Sinal de saída" value={scannedEdg ? scannedEdg.exit_signal === "edge_expired" ? "Edge expirado" : "Nenhum" : "—"} note={scannedEdg ? scannedEdg.exit_signal === "edge_expired" ? "Regra D3" : "Sem gatilho" : "Disponível após concluir o Scan"} />
          </div>

          {scannedEdg && edgeType !== "nenhum" && scannedEdg.validation?.valid && scannedEdg.exit_signal === "none" && (
            <div className="edg-ok-box">CONTRATO EDG VÁLIDO · A evidência e a condição de expiração serão enviadas ao Scan, Deep e Final.</div>
          )}

          {scannedEdg?.exit_signal === "edge_expired" && (
            <div className="edg-rule-box"><strong>REGRA D3 ATIVA</strong>O sinal de edge expirado precede uma leitura favorável de preço.</div>
          )}

          {scannedEdg && edgeType !== "nenhum" && !scannedEdg.validation?.valid && (
            <div className="warn-box">
              <strong>CONTRATO EDG INCOMPLETO</strong>
              {asArray(scannedEdg.validation?.errors).map((code) => (
                <div key={code}>· {EDG_ERROR_LABELS[code] || code}</div>
              ))}
              <div style={{ marginTop: 4 }}>Um contrato incompleto não pode iniciar uma nova análise.</div>
            </div>
          )}
        </Sec>

        <div className="field">
          <div className="flbl">Contexto adicional</div>
          <textarea className="ftxt" disabled={locked} rows={2} value={extraCtx} placeholder="Foco em KPI específico, tese, dúvida pontual..." onChange={(e) => setExtraCtx(e.target.value)} />
        </div>

        <div ref={hdlSectionRef} className="hdl-route">
        <Sec title="HDL · Hurdle do Leviatã · F1a">
          <div className="edg-tools">
            <span>Consulte as condições por classe de ativo, cenário macro e limites de interpretação.</span>
            <a className="btn-manual" href="/hdl-manual" target="_blank" rel="noreferrer">
              Abrir mini manual HDL ↗
            </a>
          </div>
          <div className="choice-help">
            <strong>O que o HDL mede</strong> · compara a TIR real esperada do ativo com a taxa real soberana ANBIMA no mesmo horizonte. Ele responde se o prêmio esperado supera o Tesouro; não calcula valuation, score ou veredito.
          </div>

          {hdlApplies ? (
            <>
              <div className="grid2">
                <div className="field">
                  <div className="flbl">TIR real esperada · % a.a.</div>
                  <input
                    ref={hdlReturnInputRef}
                    className="finp-sm metric-input"
                    inputMode="decimal"
                    disabled={hdlLocked}
                    value={hdlExpectedRealReturn}
                    placeholder="Ex.: 9,50"
                    onChange={(event) => setHdlExpectedRealReturn(event.target.value)}
                  />
                  <div className="macro-note">Retorno anual já descontado da inflação; não use retorno nominal.</div>
                </div>

                <div className="field">
                  <div className="flbl">Horizonte · anos</div>
                  <input
                    ref={hdlHorizonInputRef}
                    className="finp-sm metric-input"
                    inputMode="decimal"
                    disabled={hdlLocked}
                    value={hdlHorizonYears}
                    placeholder="Ex.: 5"
                    onChange={(event) => setHdlHorizonYears(event.target.value)}
                  />
                  <div className="macro-note">Entre {HDL_MIN_HORIZON_YEARS} e {HDL_MAX_HORIZON_YEARS} anos · sem extrapolação além da curva.</div>
                </div>
              </div>
              <div className={hdlInputReady ? "edg-ok-box" : "warn-box"}>
                {hdlInputReady
                  ? "HDL PRONTO · os valores serão calculados pelo servidor usando a curva oficial versionada."
                  : edgeInsumo === "HDL"
                  ? "HDL OBRIGATÓRIO NO SCAN · este módulo foi escolhido como insumo do Edge."
                  : "HDL OBRIGATÓRIO NO DEEP · o Scan pode ser concluído antes do preenchimento."}
              </div>
              {hdlGuideActive && hdlInputReady && (
                <div className="route-box">
                  <div className="route-copy">HDL validado. O Deep está desbloqueado e pronto para execução.</div>
                  <button type="button" className="btn-route" onClick={returnToDeepAction}>Voltar para executar o Deep →</button>
                </div>
              )}
            </>
          ) : (
            <div className="reserved-box">
              NÃO APLICÁVEL NESTA FASE · ativos no exterior exigem uma curva soberana e premissas na mesma moeda. O módulo não fará comparação BRL × moeda estrangeira.
            </div>
          )}
        </Sec>
        </div>

        <Sec title="NFI · NEXO Flow Intelligence · F1b">
          <div className="edg-tools">
            <span>Consulte a defasagem, os estados da fonte e os limites da leitura causal.</span>
            <a className="btn-manual" href="/nfi-manual" target="_blank" rel="noreferrer">Abrir mini manual NFI ↗</a>
          </div>
          <div className="choice-help">
            <strong>Leitura automática</strong> · usa o fluxo estrangeiro oficial da B3 com defasagem D+2 e o posiciona no histórico. O usuário não precisa preencher campos; o módulo explica deslocamentos de preço, sem entrar no cálculo de valor intrínseco.
          </div>
          {isExternalAsset ? (
            <div className="reserved-box">NFI INDISPONÍVEL PARA ATIVOS NO EXTERIOR · o fluxo B3 não será aplicado nem substituído por proxy internacional.</div>
          ) : (
            <div className="edg-ok-box">NFI AUTOMÁTICO · fonte oficial B3 integrada ao Context Package NMI. A publicação pendente permanece null e nunca é estimada.</div>
          )}
        </Sec>

        <div className="actions">
          {loading && loadingKind !== "final" && <button className="btn-cl" onClick={resetToInitial}>Cancelar</button>}
          <button className="btn-scan" onClick={handleScan} disabled={!canScan}>{loadingKind === "scan" ? "Analisando..." : "Scan NEXO →"}</button>
          {hasScan && hdlGuideActive && <button className="btn-deep" onClick={returnToDeepAction} disabled={!hdlInputReady}>Voltar ao Deep</button>}
        </div>

        {activeView === ANALYSIS_VIEW.SETUP && error && <div className="err-box">Erro: {error}</div>}

        {!canScan && !locked && (
          <div className="scan-hint">
            Para habilitar o Scan: {scanBlockReason}
          </div>
        )}

        {hasScan && !hasDeep && !isVeto && deepBlockReason && (
          <div className="scan-hint">Para habilitar o Deep: {deepBlockReason}</div>
        )}

          </>
        )}

        {activeView !== ANALYSIS_VIEW.SETUP && <div className="output">
          <span className="out-lbl">{analysisViewLabel(activeView, deepAdds.length)}</span>

          {!hasScan && !hasDeep && deepAdds.length === 0 && !hasFinal && !loading && !error && !ended && (
            <div className="empty"><div className="empty-g">⬡</div><div className="empty-t">Aguardando análise</div></div>
          )}

          {loading && <div className="loading-r">{loadingKind === "macro" ? "Atualizando dados macro..." : loadingKind === "final" ? "Gerando Reclassificação Final NEXO..." : loadingKind === "follow" ? "Aprofundando Deep NEXO..." : loadingKind === "deep" ? "Processando Deep NEXO..." : "Processando Scan NEXO..."}</div>}
          {error && <div className="err-box">Erro: {error}</div>}

          {activeView === ANALYSIS_VIEW.SCAN && hasScan && <Sec title="Resultado Scan"><ScanReport r={scanResult} /></Sec>}

          {activeView === ANALYSIS_VIEW.SCAN && hasScan && !hasDeep && !hasFinal && !isVeto && !ended && (
            <div className="decision-box">
              <div className="decision-title">Próxima etapa</div>
              {deepBlockReason && (
                <div className="route-box">
                  <div className="route-copy">Para rodar o Deep: {deepBlockReason}</div>
                  <button type="button" className="btn-route" onClick={openHdlFromDeep}>Preencher HDL →</button>
                </div>
              )}
              <div className="decision-actions">
                <button ref={deepActionRef} className="btn-deep" onClick={handleDeep} disabled={!canDeep}>Rodar NEXO Deep →</button>
                <button className="btn-end" onClick={handleFinal} disabled={!canFinalize}>Finalizar e Reclassificar</button>
                {loadingKind !== "final" && <button className="btn-cl" onClick={resetToInitial}>Reset e nova análise</button>}
              </div>
            </div>
          )}

          {activeView === ANALYSIS_VIEW.SCAN && hasScan && isVeto && !hasFinal && !ended && (
            <div className="decision-box">
              <div className="decision-title">Ativo vetado no Scan</div>
              <div className="decision-actions">
                <button className="btn-end" onClick={handleFinal} disabled={!canFinalize}>Finalizar e Reclassificar</button>
                {loadingKind !== "final" && <button className="btn-cl" onClick={resetToInitial}>Reset e nova análise</button>}
              </div>
            </div>
          )}

          {activeDeepResult && (
            <div style={{ marginTop: 8 }}>
              <Sec title={activeDeepIndex === 0 ? "Resultado Deep Principal" : `Resultado Deep Aprofundado ${activeDeepIndex}`}>
                <DeepReport r={activeDeepResult} showClassicValuations={classicValuations === "SIM"} />
              </Sec>
            </div>
          )}

          {activeView === currentDeepView && hasDeep && !hasFinal && !ended && (
            <div className="follow-box">
              <div className="follow-title">Aprofundamento Pós-Deep</div>

              {needsUserSource && (
                <div className="field">
                  <div className="flbl">Fonte oficial para fechar as lacunas · obrigatório</div>
                  <input className="finp-sm" disabled={loading} value={followUrl} placeholder="https://ri.empresa.com.br/documento.pdf" onChange={(e) => setFollowUrl(e.target.value)} />
                  <div className="macro-note">Ao aprofundar, o documento será validado, importado e processado na Biblioteca deste ativo.</div>
                  {followUrl.trim() && !isValidHttpsUrl(followUrl) && <div className="scan-hint">Informe um endereço HTTPS válido.</div>}
                </div>
              )}

              <div className="field">
                <div className="flbl">Pergunta ou foco {needsUserSource ? "opcional" : "obrigatório"}</div>
                <textarea className="ftxt" disabled={loading} rows={3} value={followQ} placeholder="Ex: aprofundar impacto da Selic, risco fiscal, guidance, dívida, payout..." onChange={(e) => setFollowQ(e.target.value)} />
              </div>

              <div className="follow-actions">
                <button className="btn-deep" onClick={handleFollowUp} disabled={!canFollow}>{loadingKind === "follow" ? (needsUserSource ? "Importando e aprofundando..." : "Aprofundando...") : "Aprofundar Deep →"}</button>
                <button className="btn-end" disabled={!canFinalize} onClick={handleFinal}>Finalizar e Reclassificar</button>
                {loadingKind !== "final" && <button className="btn-cl" onClick={resetToInitial}>Reset e nova análise</button>}
              </div>
            </div>
          )}

          {activeView === ANALYSIS_VIEW.FINAL && hasFinal && <div style={{ marginTop: 8 }}><Sec title="Resultado Final Reclassificado"><FinalReport r={finalResult} /></Sec></div>}

          {activeView === ANALYSIS_VIEW.FINAL && ended && hasFinal && (
            <div className="ended-box">
              Análise finalizada · Reclassificação concluída
            </div>
          )}

          {activeView === ANALYSIS_VIEW.FINAL && ended && hasFinal && (
            <div className="decision-actions" style={{ marginTop: 12 }}>
              <button className="btn-end" onClick={handleExportPDF} disabled={pdfLoading}>
                {pdfLoading ? "Gerando PDF..." : "Exportar PDF"}
              </button>
              <button className="btn-cl" onClick={resetToInitial} disabled={pdfLoading}>Nova análise</button>
            </div>
          )}
          {activeView === ANALYSIS_VIEW.FINAL && pdfError && <div className="err-box">Erro na exportação: {pdfError}</div>}
        </div>}

        <div className="footer">
          {[{ c: "#C9A84C", t: "Liq. min. R$300k BR" }, { c: "#A8A8B8", t: "ADV min. US$1M Ext" }, { c: "#C87070", t: "0B: nota 1=veto" }, { c: "#E8D5A3", t: "BESST: 15-25% abaixo" }, { c: "#6A5C3A", t: "Beta v3.0" }].map((c, i) => (
            <div key={i} className="fc"><div className="fd" style={{ background: c.c }} />{c.t}</div>
          ))}
        </div>
      </div>
    </>
  );
}
