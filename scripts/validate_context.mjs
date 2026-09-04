#!/usr/bin/env node
// validate_context.mjs
// -----------------------------------------------------------------------------
// GATE L1: nenhum Context Package e persistido sem passar pelo contrato.
//
// Uso:
//   node scripts/validate_context.mjs [caminho.json] [--expects 1.1]
//
// Sem argumento, valida data/context/latest.json.
// Sai com codigo 1 se o pacote violar o contrato -> quebra o CI e o build.
//
// Este script NAO produz pacote. Ele so julga conformidade. Producao do pacote
// e responsabilidade do NMI; este arquivo e a tranca da porta.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateContextPackage,
  checkCompatibility,
  signalMissing,
  CONTRACT_VERSION
} from "../lib/nmi/nexo_context_validator.mjs";

// Campos opcionais que o NEXO ESPERA ver preenchidos em regime normal.
// Ausencia aqui nao invalida o pacote, mas tem de ser RUIDOSA.
const EXPECTED_OPTIONAL = [
  "brazil.equity.foreign_net_brl",
  "brazil.credit_system.credit_gdp",
  "brazil.macro.real_rate_ex_12m",
  "country_risk.embi_bps"
];

const args = process.argv.slice(2);
const expectsIdx = args.indexOf("--expects");
const consumerExpects = expectsIdx >= 0 ? args[expectsIdx + 1] : CONTRACT_VERSION;
const pathArg = args.find((a) => !a.startsWith("--") && a !== consumerExpects);
const file = resolve(process.cwd(), pathArg || "data/context/latest.json");

console.log(`NEXO validate_context | contrato do validador: ${CONTRACT_VERSION}`);
console.log(`arquivo: ${file}`);

if (!existsSync(file)) {
  console.error(`\nFALHA: arquivo nao encontrado.`);
  process.exit(1);
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`\nFALHA: JSON invalido — ${e.message}`);
  process.exit(1);
}

const { ok, errors, isSeedMode } = validateContextPackage(pkg);

if (!ok) {
  console.error(`\nFALHA: pacote viola o contrato (${errors.length} erro(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\nO pacote NAO deve ser persistido nem servido.`);
  process.exit(1);
}

const compat = checkCompatibility(pkg.contextSchemaVersion, consumerExpects);
const missing = signalMissing(pkg, EXPECTED_OPTIONAL);

console.log(`\nOK: pacote valido.`);
console.log(`  context_id .......... ${pkg.context_id}`);
console.log(`  run_type ............ ${pkg.run_type}  (version ${pkg.version})`);
console.log(`  contrato do pacote .. ${pkg.contextSchemaVersion}`);
console.log(`  compatibilidade ..... ${compat.status}${compat.reason ? " — " + compat.reason : ""}`);
console.log(`  seed mode ........... ${isSeedMode ? "SIM — dado semente, nao e estado macro real" : "nao"}`);
console.log(`  confianca global .... ${pkg.quality.overall_confidence}`);

if (missing.length) {
  console.log(`  ausencias ruidosas .. ${missing.length}`);
  for (const m of missing) console.log(`      faltando: ${m}`);
  console.log(`  (ausencia deve rebaixar overall_confidence — nunca default silencioso)`);
} else {
  console.log(`  ausencias ruidosas .. nenhuma`);
}

if (compat.status === "incompatible") {
  console.error(`\nFALHA: MAJOR incompativel com o consumidor (${consumerExpects}).`);
  process.exit(1);
}

if (isSeedMode) {
  console.log(`\nAVISO: is_seed_mode=true. O pacote e honesto, mas NAO alimenta veredito.`);
}

process.exit(0);
