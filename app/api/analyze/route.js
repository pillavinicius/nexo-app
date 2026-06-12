export const runtime = 'edge';

export async function POST(req) {
  try {
    const body = await req.json();

    const payload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: body.system,
      messages: body.messages,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
        }
      ],
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
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
