export const runtime = 'edge';

export async function POST(req) {
  try {
    const body = await req.json();

    const payload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
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
    return Response.json(data);

  } catch (error) {
    return Response.json(
      { error: { message: error.message } },
      { status: 500 }
    );
  }
}
