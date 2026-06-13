export const maxDuration = 60;
export const dynamic = "force-dynamic";

function parseModelJSON(text) {
  if (!text) {
    return {
      ok: false,
      error: "Resposta vazia",
      raw: "",
    };
  }

  let raw = String(text).trim();

  // remove markdown
  raw = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // tenta localizar o primeiro objeto JSON
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return {
      ok: false,
      error: "Objeto JSON não encontrado",
      raw,
    };
  }

  raw = raw.slice(start, end + 1);

  // remove vírgulas inválidas
  raw = raw.replace(/,(\s*[}\]])/g, "$1");

  try {
    return {
      ok: true,
      data: JSON.parse(raw),
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      raw,
    };
  }
}

export async function POST(req) {
  try {
    const body = await req.json();

    const {
      phase,
      assetType,
      ticker,
      scanSummary,
      extraCtx
    } = body;

    const systemPrompt =
      phase === "deep"
        ? (DEEPS[assetType] || DEEPS["acao-br"])
        : (SCANS[assetType] || SCANS["acao-br"]);

    const userMsg =
      `Analyze ticker: ${ticker}` +
      (scanSummary ? `\nScan context: ${scanSummary}` : "") +
      (extraCtx ? `\nFocus: ${extraCtx}` : "") +
      `

IMPORTANT:
Return ONLY valid JSON.
Do NOT use markdown.
Do NOT use code fences.
Do NOT explain.
Do NOT write any text outside the JSON object.
`;

    const apiResp = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: userMsg,
            },
          ],
        }),
      }
    );

    if (!apiResp.ok) {
      const txt = await apiResp.text();

      return Response.json(
        {
          error: {
            message: `Anthropic HTTP ${apiResp.status}`,
            raw: txt,
          },
        },
        {
          status: apiResp.status,
        }
      );
    }

    const apiData = await apiResp.json();

    if (apiData.error) {
      return Response.json(
        {
          error: {
            message: apiData.error.message,
          },
        },
        {
          status: 500,
        }
      );
    }

    const rawText =
      apiData?.content?.[0]?.text || "";

    console.log("RAW MODEL RESPONSE:");
    console.log(rawText);

    const result = parseModelJSON(rawText);

    if (!result.ok) {
      return Response.json(
        {
          error: {
            message: "Parse falhou: " + result.error,
            raw: result.raw.slice(0, 3000),
          },
        },
        {
          status: 422,
        }
      );
    }

    return Response.json(result.data);

  } catch (err) {
    return Response.json(
      {
        error: {
          message: err.message,
          stack: err.stack,
        },
      },
      {
        status: 500,
      }
    );
  }
}
