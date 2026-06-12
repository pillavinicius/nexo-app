export const runtime = 'edge';

export async function POST(req) {
  let body;
  
  try {
    const raw = await req.text();
    body = JSON.parse(raw);
  } catch (parseError) {
    return Response.json(
      { error: { message: `JSON Parse Error: ${parseError.message}` } },
      { status: 400 }
    );
  }

  try {
    const payload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: body.system || '',
      messages: body.messages || [],
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

    if (data.error) {
      return Response.json({
        error: { message: `Anthropic [${data.error.type}]: ${data.error.message}` }
      });
    }

    return Response.json(data);

  } catch (error) {
    return Response.json(
      { error: { message: `Fetch Error: ${error.message}` } },
      { status: 500 }
    );
  }
}
