export const runtime = 'edge';

export async function POST(req) {
  try {
    const { assetType, phase, messages } = await req.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: `Motor NEXO - ${assetType} - ${phase}. Analise o ativo solicitado.`,
        messages: messages,
      }),
    });

    const data = await response.json();
    return Response.json(data);

  } catch (err) {
    return Response.json({ error: { message: err.message } }, { status: 500 });
  }
}
