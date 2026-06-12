export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json();

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 100,
        system: "Return only valid JSON: {\"ok\": true, \"ticker\": \"received\"}",
        messages: [{ role: "user", content: "test: " + (body.ticker || "none") }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return Response.json({ error: data.error.message });
    }

    const text = data.content[0].text;
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(s, e + 1));
    return Response.json(parsed);

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
