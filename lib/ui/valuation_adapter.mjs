const CLASSIC_PATTERN = /buffett|lynch|graham|bazin|cl[aá]ssic/i;

export const PRICE_LAYER_GUIDE = Object.freeze([
  Object.freeze({
    code: "C1",
    title: "Âncora fundamental",
    description: "parte da referência mais direta e mensurável do ativo, como patrimônio, resultados ou fluxo normalizado.",
  }),
  Object.freeze({
    code: "C2",
    title: "Validação relativa",
    description: "compara múltiplos, yields, spreads, pares e benchmarks adequados ao segmento.",
  }),
  Object.freeze({
    code: "C3",
    title: "Valor econômico e estratégico",
    description: "incorpora qualidade, riscos, catalisadores e cenários plausíveis de geração de valor.",
  }),
]);

export const PRICE_LAYER_SUMMARY =
  "As metodologias exatas se adaptam ao tipo e ao segmento do ativo. A zona convergida cruza as três leituras; não é uma média automática. A faixa BESST acrescenta margem de segurança abaixo dessa convergência.";

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function normalizeEntry(value, fallbackLabel, index) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      label: fallbackLabel || `Valuation ${index + 1}`,
      value: text(value),
      methodology: "",
      premises: "",
    };
  }

  const label = text(
    value.c ??
      value.camada ??
      value.modelo ??
      value.metodo ??
      value.nome ??
      value.titulo ??
      fallbackLabel
  );

  return {
    label: label || `Valuation ${index + 1}`,
    value: text(
      value.vj ??
        value.valor_justo ??
        value.preco_justo ??
        value.preco ??
        value.valor ??
        value.resultado
    ),
    methodology: text(value.met ?? value.metodologia ?? value.descricao ?? value.calculo),
    premises: text(value.prem ?? value.premissas ?? value.observacao ?? value.nota),
  };
}

function normalizeCollection(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeEntry(item, "", index)).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item], index) => normalizeEntry(item, key, index))
      .filter(Boolean);
  }

  return [];
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.label}|${item.value}`.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function splitPriceModels(result = {}, { includeClassic = false } = {}) {
  const embedded = normalizeCollection(result?.preco ?? result?.modelo_preco);
  const layers = embedded.filter((item) => !CLASSIC_PATTERN.test(item.label));
  const embeddedClassics = embedded.filter((item) => CLASSIC_PATTERN.test(item.label));

  if (!includeClassic) return { layers, classics: [] };

  const separateClassics = [
    result?.valuations_classicos,
    result?.valuation_classicos,
    result?.valuationsClassicos,
    result?.classic_valuations,
    result?.valuation_classico,
  ].flatMap(normalizeCollection);

  return {
    layers,
    classics: unique([...embeddedClassics, ...separateClassics]),
  };
}
