"use client";

import React, { useEffect, useRef, useState } from "react";

function detectType(t) {
  const tk = (t || "").toUpperCase().trim();

  if (!tk) return "fii";
  if (/^[A-Z]{4}11$/.test(tk)) return "fii";
  if (/^[A-Z]{4}[3-9]B?$/.test(tk) || /^[A-Z]{3,4}[0-9]{1,2}$/.test(tk)) return "acao-br";

  if (["VWCE", "CSPX", "EQQQ", "WSML", "IWDA", "SWDA", "VUSA", "XWLD", "MEUD"].includes(tk)) {
    return "etf-ext";
  }

  if (/^[A-Z]{1,5}$/.test(tk) && tk.length <= 5) return "stock-ext";

  return "acao-br";
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function asText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
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
  };

  const c = colors[value] || ["#6A5C3A", "rgba(168,168,184,.1)"];

  return (
    <span
      style={{
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1,
        padding: "2px 8px",
        border: "1px solid " + c[0],
        color: c[0],
        background: c[1],
        display: "inline-block",
      }}
    >
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
      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: c, minWidth: 36 }}>
        {s}/{m}
      </span>
    </div>
  );
}

function Sec({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 9,
          color: "#C9A84C",
          letterSpacing: 2,
          textTransform: "uppercase",
          marginBottom: 8,
          paddingBottom: 4,
          borderBottom: "1px solid #2A2318",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, right, children }) {
  return (
    <div style={{ padding: "5px 0", borderBottom: "1px solid #1E1A0E" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 12, color: "#D4C9A8", flex: 1 }}>{asText(label)}</span>
        <span style={{ flexShrink: 0 }}>{right}</span>
      </div>
      {children}
    </div>
  );
}

function Note({ children, col }) {
  return <div style={{ fontSize: 11, color: col || "#8A7A58", marginTop: 2, lineHeight: 1.5 }}>{children}</div>;
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
    <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.7, color: "#D4C9A8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
        <div>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 16, fontWeight: 700, color: "#E8D5A3" }}>
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

      {filtros.length > 0 && (
        <Sec title="Filtros Eliminatorios">
          {filtros.map((f, i) => (
            <Row key={i} label={f?.nome} right={<Badge text={f?.status} />}>
              {f?.valor && <span style={{ color: "#8A7A58", fontSize: 11 }}>{asText(f.valor)}</span>}
              {f?.nota && <Note>{asText(f.nota)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {governanca.length > 0 && (
        <Sec title="Governanca 0B">
          {governanca.map((g, i) => (
            <Row key={i} label={g?.dimensao} right={<ScoreBar score={g?.nota} />}>
              {g?.obs && <Note>{asText(g.obs)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {kpis.length > 0 && (
        <Sec title="KPIs">
          {kpis.map((k, i) => (
            <Row key={i} label={k?.nome} right={<Badge text={k?.status} />}>
              <span style={{ color: "#A89060", fontSize: 12 }}>{asText(k?.valor)}</span>
              {k?.benchmark && <span style={{ color: "#6A5C3A", fontSize: 11 }}> ref: {asText(k.benchmark)}</span>}
            </Row>
          ))}
        </Sec>
      )}

      {scoreDimensoes.length > 0 && (
        <Sec title="Score por Dimensao">
          {scoreDimensoes.map((d, i) => (
            <Row key={i} label={d?.nome} right={<ScoreBar score={d?.nota} />}>
              {d?.obs && <Note>{asText(d.obs)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {r?.tese && (
        <Sec title="Tese">
          <Note col="#A89060">{asText(r.tese)}</Note>
        </Sec>
      )}

      {catalisadores.length > 0 && (
        <Sec title="Catalisadores">
          {catalisadores.map((c, i) => (
            <Row key={i} label={c?.descricao} right={<span style={{ fontSize: 11, color: "#6A5C3A" }}>{asText(c?.prazo)}</span>}>
              {c?.impacto && <Note>{asText(c.impacto)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {riscos.length > 0 && (
        <Sec title="Riscos">
          {riscos.map((risco, i) => (
            <Row key={i} label={risco?.descricao} right={<Badge text={risco?.severidade} />}>
              {risco?.probabilidade && <Note>{asText(risco.probabilidade)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {lacunas.length > 0 && (
        <Sec title="Lacunas para o Deep">
          {lacunas.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid #1E1A0E" }}>
              <span style={{ color: "#C9A84C", opacity: 0.6 }}>◈</span>
              <span style={{ fontSize: 12, color: "#A89060" }}>{asText(l)}</span>
            </div>
          ))}
        </Sec>
      )}
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
    <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.7, color: "#D4C9A8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700, color: "#E8D5A3" }}>
          {asText(r?.ticker)} · Deep NEXO
        </div>
        {r?.veredito_final && <Badge text={r.veredito_final} />}
      </div>

      {lacs.length > 0 && (
        <Sec title="Respostas as Lacunas">
          {lacs.map((l, i) => (
            <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #1E1A0E" }}>
              <div style={{ fontSize: 11, color: "#C9A84C" }}>◈ {asText(l?.q || l?.lacuna)}</div>
              <div style={{ fontSize: 12, color: "#A89060" }}>{asText(l?.r || l?.resposta || l)}</div>
            </div>
          ))}
        </Sec>
      )}

      {precs.length > 0 && (
        <Sec title="Modelo de Preco - 3 Camadas">
          {precs.map((c, i) => (
            <Row
              key={i}
              label={c?.c || c?.camada || "Camada"}
              right={<span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#C9A84C" }}>{asText(c?.vj || c?.valor_justo)}</span>}
            >
              {(c?.met || c?.metodologia) && <Note>{asText(c?.met || c?.metodologia)}</Note>}
              {(c?.prem || c?.premissas) && <Note col="#6A5C3A">{asText(c?.prem || c?.premissas)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {(r?.zona || r?.zona_convergida) && (
        <Sec title="Zona Convergida · BESST">
          <Note col="#E8D5A3">{asText(r?.zona || r?.zona_convergida)}</Note>
          {(r?.besst || r?.zona_besst) && <Note>Entrada BESST: {asText(r?.besst || r?.zona_besst)}</Note>}
          {(r?.desconto || r?.desconto_atual) && <Note>Desconto atual: {asText(r?.desconto || r?.desconto_atual)}</Note>}
        </Sec>
      )}

      {macs.length > 0 && (
        <Sec title="Sensibilidade Macro">
          {macs.map((s, i) => (
            <Row key={i} label={s?.s || s?.cenario} right={<span style={{ fontSize: 12, color: "#A89060" }}>{asText(s?.i || s?.impacto)}</span>}>
              {s?.detalhe && <Note>{asText(s.detalhe)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {cats.length > 0 && (
        <Sec title="Catalisadores">
          {cats.map((c, i) => (
            <Row key={i} label={c?.d || c?.descricao} right={<span style={{ fontSize: 11, color: "#6A5C3A" }}>{asText(c?.p || c?.prazo)}</span>}>
              {c?.impacto && <Note>{asText(c.impacto)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {risks.length > 0 && (
        <Sec title="Riscos">
          {risks.map((risco, i) => (
            <Row key={i} label={risco?.d || risco?.descricao} right={<Badge text={risco?.sev || risco?.severidade || "MEDIO"} />}>
              {(risco?.g || risco?.gatilho) && <Note col="#C87070">Gatilho: {asText(risco?.g || risco?.gatilho)}</Note>}
            </Row>
          ))}
        </Sec>
      )}

      {steps.length > 0 && (
        <Sec title="Proximos Passos">
          {steps.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid #1E1A0E" }}>
              <span style={{ color: "#C9A84C", opacity: 0.5 }}>▸</span>
              <span style={{ fontSize: 12, color: "#A89060" }}>{asText(p)}</span>
            </div>
          ))}
        </Sec>
      )}
    </div>
  );
}

export default function NEXOApp() {
  const [scanResult, setScanResult] = useState(null);
  const [deepResult, setDeepResult] = useState(null);
  const [ticker, setTicker] = useState("");
  const [riUrl, setRiUrl] = useState("");
  const [extraCtx, setExtraCtx] = useState("");
  const [phase, setPhase] = useState("scan");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [followQ, setFollowQ] = useState("");
  const [followUrl, setFollowUrl] = useState("");
  const [followRes, setFollowRes] = useState("");
  const [followLoad, setFollowLoad] = useState(false);

  const outRef = useRef(null);

  const canRun = ticker.trim().length >= 3 && !loading;
  const canDeep = scanResult && scanResult.veredito !== "VETADO" && !loading && phase !== "deep" && phase !== "deep_done";

  useEffect(() => {
    if (outRef.current && (scanResult || deepResult || error)) {
      outRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scanResult, deepResult, error]);

  function reset() {
    setScanResult(null);
    setDeepResult(null);
    setPhase("scan");
    setError("");
    setFollowQ("");
    setFollowUrl("");
    setFollowRes("");
  }

  async function callAPI(ph) {
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

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phase: ph,
        assetType: tp,
        ticker: t,
        scanSummary: summary,
        extraCtx: extraCtx ? extraCtx.trim() : "",
      }),
    });

    const txt = await res.text();

    if (!txt || txt.trim() === "") {
      throw new Error("Sem resposta do servidor");
    }

    let data;

    try {
      data = JSON.parse(txt);
    } catch {
      const s = txt.indexOf("{");
      const e = txt.lastIndexOf("}");
      if (s === -1 || e === -1) throw new Error("Resposta invalida da API");
      data = JSON.parse(txt.slice(s, e + 1));
    }

    if (data?.error) {
      throw new Error(asText(data.error.message || data.error));
    }

    return data;
  }

  async function handleScan() {
    if (!canRun) return;

    setLoading(true);
    setError("");
    reset();

    try {
      const r = await callAPI("scan");

      if (r?.ticker_invalido) {
        setError("Ticker nao encontrado: " + ticker.trim().toUpperCase());
      } else {
        setScanResult(r);
        setPhase("scan_done");
      }
    } catch (e) {
      setError(e?.message || "Erro desconhecido");
      setPhase("scan_done");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeep() {
    if (!canDeep) return;

    setLoading(true);
    setError("");
    setDeepResult(null);
    setPhase("deep");

    try {
      const r = await callAPI("deep");
      setDeepResult(r);
      setPhase("deep_done");
    } catch (e) {
      setError(e?.message || "Erro desconhecido");
      setPhase("scan_done");
    } finally {
      setLoading(false);
    }
  }

  async function handleFollowUp() {
    if (followLoad || (!followQ.trim() && !followUrl.trim())) return;

    setFollowLoad(true);
    setFollowRes("");

    try {
      const t = ticker.trim().toUpperCase();
      const tp = detectType(t);

      const contexto =
        "Pergunta complementar: " +
        followQ.trim() +
        (followUrl.trim() ? "\nLink adicional: " + followUrl.trim() : "") +
        "\n\nContexto do Deep anterior: " +
        JSON.stringify(deepResult || {});

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "deep",
          assetType: tp,
          ticker: t,
          scanSummary: JSON.stringify(scanResult || {}),
          extraCtx: contexto,
        }),
      });

      const txt = await res.text();

      let data;

      try {
        data = JSON.parse(txt);
      } catch {
        data = { resposta: txt };
      }

      if (data?.error) {
        throw new Error(asText(data.error.message || data.error));
      }

      if (typeof data === "string") {
        setFollowRes(data);
      } else if (data?.resposta) {
        setFollowRes(asText(data.resposta));
      } else {
        setFollowRes(JSON.stringify(data, null, 2));
      }
    } catch (e) {
      setFollowRes("Erro: " + (e?.message || "erro desconhecido"));
    } finally {
      setFollowLoad(false);
    }
  }

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Inter:wght@300;400;500;600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#131008;color:#D4C9A8;font-family:'Inter',sans-serif;min-height:100vh}
    .app{max-width:960px;margin:0 auto;padding:0 16px 48px}
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
    .slbl{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:#4A3E28;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:8px}
    .snum{width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;border:1px solid #4A3E28;color:#4A3E28;flex-shrink:0}
    .snum.on{border-color:#C9A84C;color:#C9A84C}
    .sline{flex:1;height:1px;background:#2A2318}
    .field{border:1px solid #2A2318;padding:10px 14px 8px;margin-bottom:8px}
    .flbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6A5C3A;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px}
    .finp{width:100%;background:transparent;border:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#E8D5A3;letter-spacing:1.5px;text-transform:uppercase}
    .finp::placeholder{color:#2A2318;font-weight:300;font-size:13px;letter-spacing:0;text-transform:none}
    .finp-sm{width:100%;background:transparent;border:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:12px;color:#A89060}
    .finp-sm::placeholder{color:#2A2318}
    .ftxt{width:100%;background:transparent;border:none;outline:none;resize:none;font-family:'JetBrains Mono',monospace;font-size:11px;color:#6A5C3A;line-height:1.5;max-height:80px;overflow-y:auto}
    .ftxt::placeholder{color:#2A2318}
    .fex{font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#3A3020;margin-top:4px}
    .actions{display:flex;gap:7px;margin-bottom:10px}
    .btn-scan{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:9px 20px;background:linear-gradient(135deg,#C9A84C,#E8D5A3);color:#131008;border:none;cursor:pointer;border-radius:2px;flex:1}
    .btn-deep{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:9px 20px;background:transparent;border:1px solid #A8A8B8;color:#A8A8B8;cursor:pointer;border-radius:2px;flex:1}
    .btn-cl{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6A5C3A;background:transparent;border:1px solid #2A2318;padding:9px 13px;cursor:pointer;letter-spacing:1px;text-transform:uppercase;border-radius:2px}
    .output{border:1px solid #2A2318;padding:20px 16px;margin-bottom:8px;min-height:120px;position:relative}
    .out-lbl{position:absolute;top:-1px;left:12px;font-family:'JetBrains Mono',monospace;font-size:8px;color:#6A5C3A;background:#131008;padding:0 6px;letter-spacing:1.5px;text-transform:uppercase}
    .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:140px;gap:8px;opacity:.2}
    .empty-g{font-family:'JetBrains Mono',monospace;font-size:26px;color:#C9A84C}
    .empty-t{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6A5C3A;letter-spacing:2px;text-transform:uppercase}
    .loading-r{display:flex;align-items:center;gap:10px;padding:20px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#6A5C3A;letter-spacing:1px;justify-content:center}
    .err-box{font-family:'JetBrains Mono',monospace;font-size:10px;color:#C87070;background:rgba(200,112,112,.06);border:1px solid rgba(200,112,112,.2);border-left:2px solid #C87070;padding:9px 12px;margin:8px 0;white-space:pre-wrap}
    .deep-unlock{margin-top:16px;padding:12px 14px;border:1px solid #A8A8B8;background:rgba(168,168,184,.05);display:flex;align-items:center;justify-content:space-between;gap:12px}
    .footer{display:flex;gap:12px;flex-wrap:wrap;padding:10px 0 0;border-top:1px solid #1E1A0E;margin-top:4px}
    .fc{font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#3A3020;letter-spacing:.8px;display:flex;align-items:center;gap:4px}
    .fd{width:4px;height:4px;border-radius:50%;flex-shrink:0}
    @media(max-width:600px){.quads{grid-template-columns:repeat(2,1fr)}}
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
          <div className="sdot-wrap">
            <div className="sdot" /> ONLINE
          </div>
        </header>

        <div className="quads">
          {[
            ["N", "Nucleo"],
            ["E", "Estrutural"],
            ["X", "Exchange"],
            ["O", "Oportunidade"],
          ].map((q) => (
            <div key={q[0]} className={"quad " + q[0]}>
              <div className="q-l">{q[0]}</div>
              <div className="q-n">{q[1]}</div>
            </div>
          ))}
        </div>

        <div className="field">
          <div className="flbl">Ticker</div>
          <input
            className="finp"
            value={ticker}
            maxLength={12}
            placeholder="Ex: KNSC11, VALE3, VWCE, NVDA"
            onChange={(e) => {
              setTicker(e.target.value.toUpperCase());
              if (scanResult || deepResult) reset();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleScan();
            }}
          />
          <div className="fex">FIIs · Acoes BR · ETFs · Stocks</div>
        </div>

        <div className="field">
          <div className="flbl">Link RI / Dados Oficiais</div>
          <input className="finp-sm" value={riUrl} placeholder="https://ri.empresa.com.br..." onChange={(e) => setRiUrl(e.target.value)} />
        </div>

        <div className="field">
          <div className="flbl">Contexto adicional</div>
          <textarea className="ftxt" rows={2} value={extraCtx} placeholder="Foco em KPI especifico, tese, duvida pontual..." onChange={(e) => setExtraCtx(e.target.value)} />
        </div>

        <div className="actions">
          {(scanResult || deepResult) && (
            <button className="btn-cl" onClick={reset}>
              Limpar
            </button>
          )}

          <button className="btn-scan" onClick={handleScan} disabled={!canRun} style={!canRun ? { background: "#2A2318", color: "#4A3E28", cursor: "not-allowed" } : {}}>
            {loading && phase === "scan" ? "Analisando..." : "Executar Scan →"}
          </button>

          <button className="btn-deep" onClick={handleDeep} disabled={!canDeep} style={!canDeep ? { opacity: 0.25, cursor: "not-allowed" } : {}}>
            Deep NEXO
          </button>
        </div>

        <div className="output" ref={outRef}>
          <span className="out-lbl">{phase === "deep" || phase === "deep_done" ? "Deep NEXO" : "Scan NEXO"}</span>

          {!scanResult && !deepResult && !loading && !error && (
            <div className="empty">
              <div className="empty-g">⬡</div>
              <div className="empty-t">Aguardando analise</div>
            </div>
          )}

          {loading && <div className="loading-r">{phase === "deep" ? "Processando Deep NEXO..." : "Processando Scan NEXO..."}</div>}

          {error && <div className="err-box">Erro: {error}</div>}

          {scanResult && !deepResult && <ScanReport r={scanResult} />}

          {deepResult && <DeepReport r={deepResult} />}

          {scanResult && !deepResult && !loading && canDeep && (
            <div className="deep-unlock">
              <div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9, color: "#A8A8B8", letterSpacing: 1 }}>
                  Scan {asText(scanResult.veredito)} — Deep NEXO disponivel
                </div>
              </div>
              <button className="btn-deep" style={{ flex: "none", padding: "7px 14px" }} onClick={handleDeep}>
                Iniciar Deep →
              </button>
            </div>
          )}
        </div>

        <div className="footer">
          <div className="fc"><div className="fd" style={{ background: "#C9A84C" }} />Liq. min. R$300k BR</div>
          <div className="fc"><div className="fd" style={{ background: "#A8A8B8" }} />ADV min. US$1M Ext</div>
          <div className="fc"><div className="fd" style={{ background: "#C87070" }} />0B: nota 1=veto</div>
          <div className="fc"><div className="fd" style={{ background: "#E8D5A3" }} />BESST: 15-25% abaixo</div>
        </div>
      </div>
    </>
  );
}
