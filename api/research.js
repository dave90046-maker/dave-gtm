export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { company } = req.body;

  if (!company) {
    return res.status(400).json({ error: 'Company name required' });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are a B2B marketing strategist. Generate a concise ICP research brief for "${company}". Use these exact headers:\n\nCOMPANY OVERVIEW\nBUYER PERSONA\nTOP PAIN POINTS\nOUTREACH ANGLE\nMARKETING CHANNEL FIT\n\nKeep it under 350 words. Be specific and actionable.`
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || 'No response received.';
  res.status(200).json({ result: text });
}
