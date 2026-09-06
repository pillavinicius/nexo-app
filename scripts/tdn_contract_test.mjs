import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { applyTdnToAnalysis, computeTDN, TDN_WINDOWS } from "../lib/nexo/tdn/tdn_engine.mjs";
import { classifyTdnAsset, loadTdnInput } from "../lib/nexo/tdn/tdn_repository.mjs";

let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

const factsPayload = JSON.parse(gunzipSync(readFileSync(new URL("../data/goldberg/tdn_fatos.json.gz", import.meta.url))).toString("utf8"));
check(TDN_WINDOWS.map((window) => window.id).join(",") === "J1,J2", "TDN preserva as duas janelas fixas");
check(factsPayload.facts.length > 300, "coleta oficial versionada possui cobertura material");
check(factsPayload.facts.some((fact) => fact.fiscal_year === 2014), "J1 possui ano-base 2014");
check(factsPayload.facts.some((fact) => fact.fiscal_year === 2020), "J2 possui ano-base 2020");
check(factsPayload.facts.some((fact) => fact.scope === "individual"), "coletor preserva demonstração individual");
check(factsPayload.facts.some((fact) => fact.scope === "consolidado"), "coletor preserva demonstração consolidada");

async function calculate(ticker, assetType = "acao-br") {
  const input = await loadTdnInput({ ticker, assetType });
  return computeTDN({ ticker, assetType, classification: input.classification, facts: input.facts, inflation: input.inflation });
}

const operational = await calculate("WEGE3");
check(operational.status === "ok", "empresa operacional completa produz TDN");
check(operational.janelas_cobertas === 2, "score exige duas janelas completas");
check(Number.isFinite(operational.score_nominalidade), "score é calculado pelo servidor");

const commodity = await calculate("VALE3");
check(commodity.status === "ok", "commodity completa produz TDN");
check(commodity.veredito === "misto", "commodity sem atribuição de drivers é limitada a misto");
check(String(commodity.note).includes("câmbio"), "ressalva separa inflação doméstica, preço internacional e câmbio");

const utility = await calculate("SBSP3");
check(utility.status === "ok" && utility.veredito === "real", "utility calibrada produz defesa real com defasagem regulatória");
check(utility.windows.every((window) => window.observation_lag_years === 1), "as duas janelas de utility aplicam o lag contratado");
check(utility.veredito !== commodity.veredito, "calibração setorial discrimina utility e commodity");

const bank = await calculate("BBAS3");
check(bank.status === "not_applicable", "banco não recebe métrica industrial artificial");
const bankScan = applyTdnToAnalysis({
  phase: "scan",
  result: {
    lacunas_deep: [
      "TDN inconclusivo por ausência de receita e ativos circulantes.",
      "Como evoluíram NIM, inadimplência e provisões?",
    ],
  },
  tdn: bank,
});
check(bankScan.lacunas_deep.length === 1, "lacuna TDN indevida é removida para banco");
check(bankScan.lacunas_deep[0].includes("inadimplência"), "lacuna bancária legítima é preservada");
const external = await calculate("MSFT", "stock-ext");
check(external.status === "not_applicable", "ativo exterior permanece fora do TDN v1");
const unknown = await calculate("XXXX3");
check(unknown.status === "dados_insuficientes", "ativo não curado não herda perfil padrão");

const analysis = { score_revisado: 20, veredito_final: "MONITORAR", tdn_conclusao: "As duas janelas indicam proteção operacional mista, sem alterar automaticamente a tese global." };
const governed = applyTdnToAnalysis({ phase: "deep", result: analysis, tdn: operational });
check(governed.score_revisado === 20, "TDN não altera score global");
check(governed.veredito_final === "MONITORAR", "TDN não altera veredito global");
check(governed.tdn_integrity.complete === true, "conclusão válida completa a integridade sem recalcular números");

const utilityProfile = classifyTdnAsset({ ticker: "SBSP3" });
check(utilityProfile.mode === "regulated_lag" && utilityProfile.observation_lag_years === 1, "utility aplica defasagem regulatória de um ano");

console.log(`TDN F2: ${checks} verificações aprovadas.`);
