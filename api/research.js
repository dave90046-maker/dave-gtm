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
      max_tokens: 1300,
      messages: [{
        role: 'user',
        content: `You are a B2B marketing strategist. Generate a concise ICP research brief for "${company}". Use these exact headers, each in plain text on its own line (no "#" markdown heading symbols):\n\nCOMPANY OVERVIEW\nBUYER PERSONA\nTOP PAIN POINTS\nOUTREACH ANGLE\nMARKETING CHANNEL FIT\nCOMPETITIVE LANDSCAPE\n\nWhenever a section uses a bulleted list with a named item (a persona segment, a channel, a competitor, etc.), always bold the label with double asterisks and follow it with a colon, in this exact format: "- **Label**: description". Never use a dash or em-dash after the label, and never leave the label unbolded.\n\nFor COMPETITIVE LANDSCAPE, identify 3-4 key competitors as a bulleted list in that same "- **Company Name**: how it differs from ${company}" format. Do not use a table. End the section with one closing sentence on how to position against them in outreach.\n\nKeep it under 450 words. Be specific and actionable.`
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || 'No response received.';
  res.status(200).json({ result: text });
}
