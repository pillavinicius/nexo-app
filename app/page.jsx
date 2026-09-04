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
  };

  const c = colors[value] || ["#6A5C3A", "rgba(168,168,184,.1)"];

  return (
    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "2px 8px", border: "1px solid " + c[0], color: c[0], background: c[1], display: "inline-block", whiteSpace: "nowrap" }}>
      {value}
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
    </div>
  );
}

function DeepReport({ r }) {
  const lacs = asArray(r?.lacunas || r?.lacunas_respondidas);
  const precs = asArray(r?.preco || r?.modelo_preco);
  const macs = asArray(r?.macro || r?.sensibilidade);
  const cats = asArray(r?.catalisadores);
  const risks = asArray(r?.riscos);
  const steps = asArray(r?.passos || r?.proximos_passos);

  return (
    <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.7, color: "#D4C9A8", overflowX: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700, color: "#E8D5A3", minWidth: 0 }}>
          {asText(r?.ticker)} · Deep NEXO
        </div>
        {r?.veredito_final && <Badge text={r.veredito_final} />}
      </div>

      {lacs.length > 0 && <Sec title="Respostas às Lacunas">{lacs.map((l, i) => <DetailBlock key={i} title={l?.q || l?.lacuna || "Lacuna"} value={l?.r || l?.resposta || l} />)}</Sec>}
      {precs.length > 0 && <Sec title="Modelo de Preço - 3 Camadas">{precs.map((c, i) => <DetailBlock key={i} title={(c?.c || c?.camada || "Camada") + (c?.vj || c?.valor_justo ? " · " + asText(c?.vj || c?.valor_justo) : "")} value={c?.met || c?.metodologia} note={c?.prem || c?.premissas} />)}</Sec>}
      {(r?.zona || r?.zona_convergida) && <Sec title="Zona Convergida · BESST"><DetailBlock title={r?.zona || r?.zona_convergida} value={r?.besst || r?.zona_besst ? "Entrada BESST: " + asText(r?.besst || r?.zona_besst) : ""} note={r?.desconto || r?.desconto_atual ? "Desconto atual: " + asText(r?.desconto || r?.desconto_atual) : ""} /></Sec>}
      {macs.length > 0 && <Sec title="Sensibilidade Macro">{macs.map((s, i) => <DetailBlock key={i} title={s?.s || s?.cenario} value={s?.i || s?.impacto} note={s?.detalhe} />)}</Sec>}
      {cats.length > 0 && <Sec title="Catalisadores">{cats.map((c, i) => <DetailBlock key={i} title={c?.d || c?.descricao} value={c?.impacto} note={c?.p || c?.prazo} />)}</Sec>}
      {risks.length > 0 && <Sec title="Riscos">{risks.map((risco, i) => <DetailBlock key={i} title={risco?.d || risco?.descricao} value={"Severidade: " + asText(risco?.sev || risco?.severidade || "MEDIO")} note={risco?.g || risco?.gatilho ? "Gatilho: " + asText(risco?.g || risco?.gatilho) : ""} />)}</Sec>}
      {steps.length > 0 && <Sec title="Próximos Passos">{steps.map((p, i) => <DetailBlock key={i} title={"Passo " + (i + 1)} value={p} />)}</Sec>}
    </div>
  );
}

function FinalReport({ r }) {
  const riscos = asArray(r?.riscos_incorporados);
  const ajustes = asArray(r?.ajustes_score);
  const passos = asArray(r?.proximos_passos);
  const preco = r?.preco_final || {};

  return (
    <div id="nexo-final-report" style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.7, color: "#D4C9A8", overflowX: "hidden" }}>
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
    </div>
  );
}

export default function NEXOApp() {
  const [scanResult, setScanResult] = useState(null);
  const [deepResult, setDeepResult] = useState(null);
  const [deepAdds, setDeepAdds] = useState([]);
  const [finalResult, setFinalResult] = useState(null);

  const [ticker, setTicker] = useState("");
  const [riUrl, setRiUrl] = useState("");
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

  const [assetData, setAssetData] = useState(null);
  const [assetError, setAssetError] = useState("");
  const [assetLoading, setAssetLoading] = useState(false);

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

  const [followQ, setFollowQ] = useState("");
  const [followUrl, setFollowUrl] = useState("");
  const [ended, setEnded] = useState(false);

  const abortRef = useRef(null);
  const assetAbortRef = useRef(null);
  const macroAbortRef = useRef(null);
  const supplementalAbortRef = useRef(null);

  const hasScan = !!scanResult;
  const hasDeep = !!deepResult;
  const hasFinal = !!finalResult;
  const isVeto = scanResult?.veredito === "VETADO";
  const locked = loading || hasScan || hasDeep || hasFinal || ended;

  const macro = macroData?.automatic || {};
  const priceUnit = currency === "USD" ? "USD" : "R$";
  const requiredInputsReady =
    ticker.trim().length >= 3 &&
    currentPrice.trim().length > 0;
  const complementaryPending =
    useComplementaryData === "SIM" && supplementalLoading;

  const scanBlockReason = !ticker.trim()
    ? "Informe o ticker."
    : ticker.trim().length < 3
    ? "Ticker precisa ter pelo menos 3 caracteres."
    : assetLoading
    ? "Aguarde a busca automática da cotação e dos indicadores."
    : !currentPrice.trim()
    ? "Cotação automática indisponível. Informe o valor atual manualmente."
    : complementaryPending
    ? "Aguarde o carregamento dos dados complementares selecionados."
    : "";

  const canScan = requiredInputsReady && !assetLoading && !complementaryPending && !loading && !hasScan && !hasDeep && !hasFinal && !ended;
  const canDeep = hasScan && !hasDeep && !isVeto && !loading && !hasFinal && !ended;
  const canFinalize = (hasScan || hasDeep) && !loading && !hasFinal && !ended;
  const canFollow = hasDeep && !loading && !hasFinal && !ended && (followQ.trim() || followUrl.trim());

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
    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      assetAbortRef.current = controller;
      try {
        const response = await fetch(
          `/api/asset?ticker=${encodeURIComponent(normalizedTicker)}`,
          { signal: controller.signal, cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || "Dados automáticos do ativo indisponíveis");
        }

        const prefill = assetPrefill(data);
        setAssetData(data);
        if (prefill.currentPrice) setCurrentPrice(prefill.currentPrice);
        if (prefill.currency) setCurrency(prefill.currency);
        if (prefill.histMin) setHistMin(prefill.histMin);
        if (prefill.histMinDate) setHistMinDate(prefill.histMinDate);
        if (prefill.histMax) setHistMax(prefill.histMax);
        if (prefill.histMaxDate) setHistMaxDate(prefill.histMaxDate);
      } catch (fetchError) {
        if (fetchError?.name !== "AbortError") {
          setAssetError(fetchError?.message || "Erro ao buscar dados do ativo");
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
      "- Macro fundamental: usar o Context Package NMI validado e injetado pelo servidor; não duplicar nem sobrescrever com dados do ativo.\n" +
      complementaryContext +
      "- Dados automáticos do ativo (HG Brasil/Twelve Data): " +
      (automaticAssetContext ? JSON.stringify(automaticAssetContext) : "indisponíveis; usar fallback manual") + "\n" +
      "Regra de prioridade: se houver valor manual informado pelo usuário, usar o manual. Se manual vazio, usar o automático. Se automático indisponível, marcar como não informado.\n" +
      "Observação: os valuations Buffett moderno, Peter Lynch, Graham e Bazin, quando solicitados, devem ser usados apenas como referência complementar, nunca como decisão principal.\n"
    );
  }

  function reset() {
    if (loading && abortRef.current) {
      abortRef.current.abort();
      setLoading(false);
      setLoadingKind("");
      setError("Análise cancelada pelo usuário.");
      return;
    }

    setScanResult(null);
    setDeepResult(null);
    setDeepAdds([]);
    setFinalResult(null);
    setPhase("initial");
    setError("");
    setFollowQ("");
    setFollowUrl("");
    setEnded(false);
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

  async function callAPI(ph, overrideCtx = "") {
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
      }),
    });

    const txt = await res.text();
    if (!txt || txt.trim() === "") throw new Error("Sem resposta do servidor");

    let data;

    try {
      data = JSON.parse(txt);
    } catch {
      const s = txt.indexOf("{");
      const e = txt.lastIndexOf("}");
      if (s === -1 || e === -1) throw new Error("Resposta inválida da API");
      data = JSON.parse(txt.slice(s, e + 1));
    }

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

    try {
      const r = await callAPI("scan");

      if (r?.ticker_invalido) {
        setError("Ticker não encontrado: " + ticker.trim().toUpperCase());
        setPhase("scan_done");
      } else {
        setScanResult(r);
        setPhase("scan_done");
      }
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "Erro desconhecido");
      setPhase("scan_done");
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

    try {
      const r = await callAPI("deep");
      setDeepResult(r);
      setPhase("deep_done");
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "Erro desconhecido");
      setPhase("scan_done");
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
      const contexto =
        "Aprofundamento adicional do Deep NEXO.\n" +
        (followUrl.trim() ? "Link ou fonte adicional: " + followUrl.trim() + "\n" : "") +
        (followQ.trim() ? "Pergunta/foco do usuário: " + followQ.trim() + "\n" : "") +
        "\nGere um NOVO resultado de Deep aprofundado em JSON válido, mantendo o mesmo schema. Não apague nem substitua o Deep anterior.\n" +
        "Deep anterior:\n" +
        JSON.stringify(deepResult || {}) +
        "\nAprofundamentos anteriores:\n" +
        JSON.stringify(deepAdds || []);

      const r = await callAPI("deep", contexto);
      setDeepAdds((prev) => [...prev, r]);
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

    try {
      const contexto =
        "Histórico completo para Reclassificação Final NEXO:\n\n" +
        buildManualContext() +
        "\nTICKER:\n" +
        ticker.trim().toUpperCase() +
        "\n\nTIPO DO ATIVO:\n" +
        detectType(ticker) +
        "\n\nLINK RI / FONTE INICIAL:\n" +
        (riUrl || "") +
        "\n\nCONTEXTO INICIAL DO USUÁRIO:\n" +
        (extraCtx || "") +
        "\n\nSCAN ORIGINAL:\n" +
        JSON.stringify(scanResult || {}, null, 2) +
        "\n\nDEEP PRINCIPAL:\n" +
        JSON.stringify(deepResult || {}, null, 2) +
        "\n\nDEEPS APROFUNDADOS:\n" +
        JSON.stringify(deepAdds || [], null, 2);

      const r = await callAPI("final", contexto);
      setFinalResult(r);
      setEnded(true);
      setPhase("final_done");
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "Erro desconhecido");
      setPhase(hasDeep ? "deep_done" : "scan_done");
    } finally {
      setLoading(false);
      setLoadingKind("");
      abortRef.current = null;
    }
  }

  function handlePrintPDF() {
    window.print();
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
    .field{border:1px solid #2A2318;padding:10px 14px 8px;margin-bottom:8px}
    .flbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6A5C3A;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px}
    .finp{width:100%;background:transparent;border:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#E8D5A3;letter-spacing:1.5px;text-transform:uppercase}
    .finp::placeholder{color:#2A2318;font-weight:300;font-size:13px;letter-spacing:0;text-transform:none}
    .finp-sm,.select-sm{width:100%;background:transparent;border:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:12px;color:#A89060}
    .finp-sm::placeholder{color:#2A2318}
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
    .reserved-box{min-height:72px;border:1px dashed #2A2318;display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;font-family:'JetBrains Mono',monospace;font-size:9px;color:#4A3E28;letter-spacing:1px;line-height:1.5}
    .section-meta{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;font-family:'JetBrains Mono',monospace;font-size:9px;color:#8A7A58;line-height:1.5}
    .subsection-label{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6A5C3A;letter-spacing:1.5px;text-transform:uppercase;margin:14px 0 7px}
    .macro-card{border:1px solid #2A2318;padding:8px 10px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#A89060}
    .macro-title{font-size:8px;color:#6A5C3A;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px}
    .macro-value{font-size:13px;color:#E8D5A3;font-weight:700}
    .macro-note{font-size:8px;color:#4A3E28;margin-top:3px}
    .actions{display:flex;gap:7px;margin-bottom:10px}
    .btn-scan{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:9px 20px;background:linear-gradient(135deg,#C9A84C,#E8D5A3);color:#131008;border:none;cursor:pointer;border-radius:2px;flex:1}
    .btn-deep{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:9px 20px;background:transparent;border:1px solid #A8A8B8;color:#A8A8B8;cursor:pointer;border-radius:2px;flex:1}
    .btn-cl,.btn-end{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6A5C3A;background:transparent;border:1px solid #2A2318;padding:9px 13px;cursor:pointer;letter-spacing:1px;text-transform:uppercase;border-radius:2px}
    .btn-end{border-color:#C9A84C;color:#C9A84C}
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
    @media(max-width:600px){.quads,.grid2,.grid3{grid-template-columns:1fr}.actions,.decision-actions,.follow-actions{flex-direction:column}.btn-deep,.btn-scan,.btn-cl,.btn-end{width:100%}}
    @media print{
      body{background:#fff!important;color:#111!important}
      body *{visibility:hidden!important}
      #nexo-final-report,#nexo-final-report *{visibility:visible!important;color:#111!important}
      #nexo-final-report{position:absolute;left:0;top:0;width:100%;padding:24px;background:#fff!important}
      #nexo-final-report div{border-color:#ddd!important}
    }
  `;

  return (
    <>
      <style>{CSS}</style>

      <div className="app">
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

        <div className="help-box">
          <div className="help-title">Como usar o NEXO App</div>
          <div className="help-text">
            1) Informe o ticker. 2) Revise os dados do ativo preenchidos automaticamente.
            3) O Macro Fundamental NMI permanece ativo. Habilite dados complementares somente quando forem úteis para a tese.
            4) Execute o Scan. O contexto validado alimenta também o Deep e a Reclassificação Final.
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
                <span>{assetLoading ? "CARREGANDO..." : assetData?.ok ? "DADOS RECEBIDOS" : "FALLBACK MANUAL"}</span>
              </div>

              {assetError && (
                <div className="warn-box">Dados automáticos do ativo indisponíveis: {assetError}. Preencha a cotação manualmente para prosseguir.</div>
              )}

              <div className="grid2">
                <div className="field">
                  <div className="flbl">Valor atual / cota atual ({priceUnit}) *</div>
                  <input className="finp-sm" disabled={locked} value={currentPrice} placeholder="Ex: 35,80" onChange={(e) => setCurrentPrice(e.target.value)} />
                  <div className="macro-note">{assetData?.ok ? `Automático · ${assetData?.asset?.dataProvider || assetData?.route} · editável` : "Fallback manual · obrigatório para habilitar o Scan"}</div>
                </div>
                <div className="field">
                  <div className="flbl">Moeda</div>
                  <select className="select-sm" disabled={locked} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                  </select>
                  <div className="macro-note">Unidade dos campos de preço</div>
                </div>
                <div className="field">
                  <div className="flbl">Mínimo histórico ({priceUnit})</div>
                  <input className="finp-sm" disabled={locked} value={histMin} placeholder="Ex: 18,40" onChange={(e) => setHistMin(e.target.value)} />
                  <div className="macro-note">{assetData?.derived?.minPrice != null ? "Automático · editável" : "Manual opcional"}</div>
                </div>
                <div className="field">
                  <div className="flbl">Data do mínimo</div>
                  <input className="finp-sm" disabled={locked} value={histMinDate} maxLength={5} placeholder="Ex: 02/21" onChange={(e) => setHistMinDate(e.target.value)} />
                  <div className="macro-note">MM/AA · automático quando disponível</div>
                </div>
                <div className="field">
                  <div className="flbl">Máximo histórico ({priceUnit})</div>
                  <input className="finp-sm" disabled={locked} value={histMax} placeholder="Ex: 42,77" onChange={(e) => setHistMax(e.target.value)} />
                  <div className="macro-note">{assetData?.derived?.maxPrice != null ? "Automático · editável" : "Manual opcional"}</div>
                </div>
                <div className="field">
                  <div className="flbl">Data do máximo</div>
                  <input className="finp-sm" disabled={locked} value={histMaxDate} maxLength={5} placeholder="Ex: 11/25" onChange={(e) => setHistMaxDate(e.target.value)} />
                  <div className="macro-note">MM/AA · automático quando disponível</div>
                </div>
              </div>

              {assetData?.ok && (
                <>
                  <div className="subsection-label">Indicadores automáticos do ativo</div>
                  <div className="grid3">
                    {[
                      ["Variação", assetData?.asset?.changePercent == null ? "—" : `${displayNumber(assetData.asset.changePercent)}%`, "sessão atual"],
                      ["P/L", assetData?.keyIndicators?.pe == null ? "—" : `${displayNumber(assetData.keyIndicators.pe)}x`, "indicador do ativo"],
                      ["P/VP", assetData?.keyIndicators?.pb == null ? "—" : `${displayNumber(assetData.keyIndicators.pb)}x`, "indicador do ativo"],
                      ["Dividend Yield", assetData?.keyIndicators?.dividendYieldPercent == null ? "—" : `${displayNumber(assetData.keyIndicators.dividendYieldPercent)}%`, "12 meses"],
                      ["Liquidez média", displayMoney(assetData?.derived?.averageFinancialVolume, assetData?.asset?.currency) || "—", "volume financeiro diário"],
                    ].map((item) => (
                      <div className="macro-card" key={item[0]}>
                        <div className="macro-title">{item[0]}</div>
                        <div className="macro-value">{item[1]}</div>
                        <div className="macro-note">{item[2]}</div>
                      </div>
                    ))}
                  </div>
                  <div className="macro-note" style={{ marginTop: 8 }}>
                    Fonte: {assetData?.asset?.source || assetData?.asset?.dataProvider || assetData?.route} · {assetData?.asset?.updatedAt || assetData?.updatedAt || ""}
                  </div>
                </>
              )}
            </>
          )}
        </Sec>

        <Sec title="Macro fundamental NMI">
          {macroLoading && !macroData?.nmi && <div className="reserved-box">CARREGANDO CONTEXT PACKAGE NMI VALIDADO...</div>}
          {macroData?.nmi?.available && (
            <div className="scan-hint">
              NMI ATIVO · {macroData.nmi.contextId} · CONFIANÇA {displayNumber((macroData.nmi.overallConfidence || 0) * 100)}%
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
                <div className="macro-card" key={m[0]}>
                  <div className="macro-title">{m[0]}</div>
                  <div className="macro-value">{formattedMacroValue(m[0], m[1])}</div>
                  <div className="macro-note">{m[1]?.ok ? `${m[1]?.source} · ${m[1]?.date || ""}` : "Indisponível no pacote"}</div>
                </div>
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
                  <div className="macro-card" key={m[0]}>
                    <div className="macro-title">{m[0]}</div>
                    <div className="macro-value">{formattedMacroValue(m[0], m[1])}</div>
                    <div className="macro-note">{m[1]?.ok ? `${m[1]?.source} · ${m[1]?.date || ""}` : supplementalLoading ? "Carregando..." : "Automação indisponível"}</div>
                  </div>
                ))}
              </div>

              <div className="subsection-label">Ajustes manuais complementares</div>
              <div className="grid2">
                <div className="field">
                  <div className="flbl">P/L Ibovespa</div>
                  <input className="finp-sm" disabled={locked} value={plIbov} placeholder="Ex: 8,5" onChange={(e) => setPlIbov(e.target.value)} />
                  <div className="macro-note">Manual · sem fonte pública oficial estável</div>
                </div>
                <div className="field">
                  <div className="flbl">P/L S&P 500</div>
                  <input className="finp-sm" disabled={locked} value={plSp500} placeholder="Ex: 22,0" onChange={(e) => setPlSp500(e.target.value)} />
                  <div className="macro-note">Manual · sem fonte pública oficial estável</div>
                </div>
                <div className="field">
                  <div className="flbl">Ibovespa pontos</div>
                  <input className="finp-sm" disabled={locked} value={ibovManual} placeholder={macro?.ibovespa_pontos?.ok ? macroValue(macro.ibovespa_pontos) : "Ex: 145000"} onChange={(e) => setIbovManual(e.target.value)} />
                  <div className="macro-note">{macroStatusText(macro?.ibovespa_pontos)} · manual sobrescreve</div>
                </div>
                <div className="field">
                  <div className="flbl">S&P 500 pontos</div>
                  <input className="finp-sm" disabled={locked} value={sp500Manual} placeholder={macro?.sp500_pontos?.ok ? macroValue(macro.sp500_pontos) : "Ex: 6100"} onChange={(e) => setSp500Manual(e.target.value)} />
                  <div className="macro-note">Manual até integrar fonte licenciada/confiável</div>
                </div>
                <div className="field">
                  <div className="flbl">IFIX pontos</div>
                  <input className="finp-sm" disabled={locked} value={ifixManual} placeholder={macro?.ifix_pontos?.ok ? macroValue(macro.ifix_pontos) : "Ex: 3400"} onChange={(e) => setIfixManual(e.target.value)} />
                  <div className="macro-note">{macroStatusText(macro?.ifix_pontos)} · manual sobrescreve</div>
                </div>
                <div className="field">
                  <div className="flbl">Juros futuro Brasil</div>
                  <input className="finp-sm" disabled={locked} value={jurosFuturoManual} placeholder="Ex: DI Jan/29 13,20%" onChange={(e) => setJurosFuturoManual(e.target.value)} />
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

        <div className="field">
          <div className="flbl">Link RI / Dados Oficiais</div>
          <input className="finp-sm" disabled={locked} value={riUrl} placeholder="https://ri.empresa.com.br..." onChange={(e) => setRiUrl(e.target.value)} />
        </div>

        <div className="field">
          <div className="flbl">Contexto adicional</div>
          <textarea className="ftxt" disabled={locked} rows={2} value={extraCtx} placeholder="Foco em KPI específico, tese, dúvida pontual..." onChange={(e) => setExtraCtx(e.target.value)} />
        </div>

        <div className="actions">
          {(hasScan || hasDeep || hasFinal || loading || ended) && <button className="btn-cl" onClick={reset}>{loading ? "Cancelar" : "Limpar"}</button>}
          <button className="btn-scan" onClick={handleScan} disabled={!canScan}>{loadingKind === "scan" ? "Analisando..." : "Scan NEXO →"}</button>
          <button className="btn-deep" onClick={handleDeep} disabled={!canDeep}>{loadingKind === "deep" ? "Analisando..." : "Deep NEXO"}</button>
        </div>

        {!canScan && !locked && (
          <div className="scan-hint">
            Para habilitar o Scan: {scanBlockReason}
          </div>
        )}

        <div className="output">
          <span className="out-lbl">{hasFinal ? "Reclassificação Final" : hasDeep || deepAdds.length > 0 ? "Deep NEXO" : "Scan NEXO"}</span>

          {!hasScan && !hasDeep && deepAdds.length === 0 && !hasFinal && !loading && !error && !ended && (
            <div className="empty"><div className="empty-g">⬡</div><div className="empty-t">Aguardando análise</div></div>
          )}

          {loading && <div className="loading-r">{loadingKind === "macro" ? "Atualizando dados macro..." : loadingKind === "final" ? "Gerando Reclassificação Final NEXO..." : loadingKind === "follow" ? "Aprofundando Deep NEXO..." : loadingKind === "deep" ? "Processando Deep NEXO..." : "Processando Scan NEXO..."}</div>}
          {error && <div className="err-box">Erro: {error}</div>}

          {hasScan && <Sec title="Resultado Scan"><ScanReport r={scanResult} /></Sec>}

          {hasScan && !hasDeep && !hasFinal && !isVeto && !ended && (
            <div className="decision-box">
              <div className="decision-title">Próxima etapa</div>
              <div className="decision-actions">
                <button className="btn-deep" onClick={handleDeep} disabled={!canDeep}>Rodar NEXO Deep →</button>
                <button className="btn-end" onClick={handleFinal} disabled={!canFinalize}>Finalizar e Reclassificar</button>
              </div>
            </div>
          )}

          {hasScan && isVeto && !hasFinal && !ended && (
            <div className="decision-box">
              <div className="decision-title">Ativo vetado no Scan</div>
              <button className="btn-end" onClick={handleFinal} disabled={!canFinalize}>Finalizar e Reclassificar</button>
            </div>
          )}

          {hasDeep && <div style={{ marginTop: 24 }}><Sec title="Resultado Deep Principal"><DeepReport r={deepResult} /></Sec></div>}

          {deepAdds.length > 0 && deepAdds.map((d, i) => (
            <div key={i} style={{ marginTop: 26 }}>
              <Sec title={"Resultado Deep Aprofundado " + (i + 1)}><DeepReport r={d} /></Sec>
            </div>
          ))}

          {hasDeep && !hasFinal && !ended && (
            <div className="follow-box">
              <div className="follow-title">Aprofundamento Pós-Deep</div>

              <div className="field">
                <div className="flbl">Link adicional opcional</div>
                <input className="finp-sm" disabled={loading} value={followUrl} placeholder="Cole aqui link de fato relevante, documento RI, release, página oficial..." onChange={(e) => setFollowUrl(e.target.value)} />
              </div>

              <div className="field">
                <div className="flbl">Pergunta ou foco opcional</div>
                <textarea className="ftxt" disabled={loading} rows={3} value={followQ} placeholder="Ex: aprofundar impacto da Selic, risco fiscal, guidance, dívida, payout..." onChange={(e) => setFollowQ(e.target.value)} />
              </div>

              <div className="follow-actions">
                <button className="btn-deep" onClick={handleFollowUp} disabled={!canFollow}>{loadingKind === "follow" ? "Aprofundando..." : "Aprofundar Deep →"}</button>
                <button className="btn-end" disabled={!canFinalize} onClick={handleFinal}>Finalizar e Reclassificar</button>
              </div>
            </div>
          )}

          {hasFinal && <div style={{ marginTop: 28 }}><Sec title="Resultado Final Reclassificado"><FinalReport r={finalResult} /></Sec></div>}

          {ended && hasFinal && (
            <div className="ended-box">
              Análise finalizada · Reclassificação concluída
            </div>
          )}

          {ended && hasFinal && (
            <div className="decision-actions" style={{ marginTop: 12 }}>
              <button className="btn-end" onClick={handlePrintPDF}>Exportar PDF</button>
              <button className="btn-cl" onClick={reset}>Nova análise</button>
            </div>
          )}
        </div>

        <div className="footer">
          {[{ c: "#C9A84C", t: "Liq. min. R$300k BR" }, { c: "#A8A8B8", t: "ADV min. US$1M Ext" }, { c: "#C87070", t: "0B: nota 1=veto" }, { c: "#E8D5A3", t: "BESST: 15-25% abaixo" }, { c: "#6A5C3A", t: "Beta v3.0" }].map((c, i) => (
            <div key={i} className="fc"><div className="fd" style={{ background: c.c }} />{c.t}</div>
          ))}
        </div>
      </div>
    </>
  );
}
