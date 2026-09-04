// Cliente compartilhado do Banco Central do Brasil - SGS.
// Sem dependencias externas. Coletores offline usam esta unica implementacao.

export const BCB_SGS_BASE_URL =
  "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

const DAY_MS = 86_400_000;

function assertIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error(`${label} deve usar YYYY-MM-DD`);
  }
  const ts = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ts) || new Date(ts).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} invalida`);
  }
  return ts;
}

export function isoToBRDate(value) {
  assertIsoDate(value, "data");
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function brDateToIso(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value));
  if (!match) throw new Error(`data SGS invalida: ${value}`);
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  assertIsoDate(iso, "data SGS");
  return iso;
}

export function parseSgsRows(rows, { code } = {}) {
  if (!Array.isArray(rows)) throw new Error(`SGS ${code ?? "?"}: resposta nao e array`);

  const parsed = rows.map((row, index) => {
    const date = brDateToIso(row?.data);
    const value = Number(row?.valor);
    if (!Number.isFinite(value)) {
      throw new Error(`SGS ${code ?? "?"}: valor invalido na linha ${index}`);
    }
    return {
      date,
      ts: Date.parse(`${date}T00:00:00Z`),
      value,
    };
  });

  return parsed.sort((a, b) => a.ts - b.ts);
}

export function buildSgsWindows(startDate, endDate, chunkYears = 8) {
  const startTs = assertIsoDate(startDate, "startDate");
  const endTs = assertIsoDate(endDate, "endDate");
  if (startTs > endTs) throw new Error("startDate nao pode ser posterior a endDate");
  if (!Number.isInteger(chunkYears) || chunkYears < 1 || chunkYears > 10) {
    throw new Error("chunkYears deve ser inteiro entre 1 e 10");
  }

  const windows = [];
  let cursor = new Date(startTs);
  const end = new Date(endTs);

  while (cursor <= end) {
    const chunkStart = cursor.toISOString().slice(0, 10);
    const chunkEndDate = new Date(cursor);
    chunkEndDate.setUTCFullYear(chunkEndDate.getUTCFullYear() + chunkYears);
    chunkEndDate.setUTCDate(chunkEndDate.getUTCDate() - 1);
    if (chunkEndDate > end) chunkEndDate.setTime(end.getTime());
    const chunkEnd = chunkEndDate.toISOString().slice(0, 10);
    windows.push({ startDate: chunkStart, endDate: chunkEnd });
    cursor = new Date(chunkEndDate.getTime() + DAY_MS);
  }

  return windows;
}

export function buildSgsUrl(code, startDate, endDate) {
  if (!Number.isInteger(Number(code)) || Number(code) <= 0) {
    throw new Error("codigo SGS invalido");
  }
  const params = new URLSearchParams({
    formato: "json",
    dataInicial: isoToBRDate(startDate),
    dataFinal: isoToBRDate(endDate),
  });
  return `${BCB_SGS_BASE_URL}.${Number(code)}/dados?${params}`;
}

async function requestJson(url, {
  fetchImpl,
  retries,
  timeoutMs,
  sleepImpl,
  label,
}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleepImpl(350 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label}: ${lastError?.message || "falha desconhecida"}`);
}

export async function fetchSgsSeries(code, {
  startDate,
  endDate,
  chunkYears = 8,
  fetchImpl = globalThis.fetch,
  retries = 3,
  timeoutMs = 15_000,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch indisponivel");
  const endTs = assertIsoDate(endDate, "endDate");
  const windows = buildSgsWindows(startDate, endDate, chunkYears);
  const byDate = new Map();

  for (const window of windows) {
    const url = buildSgsUrl(code, window.startDate, window.endDate);
    const rows = await requestJson(url, {
      fetchImpl,
      retries,
      timeoutMs,
      sleepImpl,
      label: `BCB SGS ${code} ${window.startDate}..${window.endDate}`,
    });
    for (const observation of parseSgsRows(rows, { code })) {
      // Evita vazamento temporal caso a fonte devolva valor com data futura.
      if (observation.ts <= endTs) byDate.set(observation.date, observation);
    }
  }

  return [...byDate.values()].sort((a, b) => a.ts - b.ts);
}

export function latestObservationAtOrBefore(observations, endDate) {
  const endTs = assertIsoDate(endDate, "endDate");
  return [...(observations || [])]
    .filter((item) => Number.isFinite(item?.ts) && item.ts <= endTs)
    .sort((a, b) => a.ts - b.ts)
    .at(-1) || null;
}
