function httpFailureMessage(status) {
  if (status === 504) {
    return "A análise ultrapassou o tempo limite do servidor. Tente novamente; nenhum dado foi perdido.";
  }
  if (status >= 500) {
    return `O servidor de análise falhou temporariamente (HTTP ${status}). Tente novamente.`;
  }
  return `A API retornou uma resposta inválida (HTTP ${status || "desconhecido"}).`;
}

export async function readApiJsonResponse(response) {
  const text = await response.text();
  if (!text || !text.trim()) throw new Error(httpFailureMessage(response.status));

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // A mensagem abaixo preserva o status HTTP sem expor HTML interno.
      }
    }
    throw new Error(httpFailureMessage(response.status));
  }
}
