export const runtime = 'edge';

export async function POST(req) {
  try {
    const body = await req.json();

    const payload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: body.system,
      messages: body.messages,
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    // Retorna erro detalhado se houver
    if (data.error) {
      return Response.json({ 
        error: { message: `API Error [${data.error.type}]: ${data.error.message}` }
      });
    }

    return Response.json(data);

  } catch (error) {
    return Response.json(
      { error: { message: `Route Error: ${error.message}` } },
      { status: 500 }
    );
  }
}
