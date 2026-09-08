async function braveSearch(query) {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_API_KEY
      }
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data.web?.results || []).slice(0, 5).map(r => ({
      title: r.title,
      description: r.description,
      url: r.url
    }));
  } catch (err) {
    return [];
  }
}

function formatSearchResults(label, results) {
  if (!results.length) return `${label}: no results found.`;
  return `${label}:\n` + results.map(r => `- ${r.title}: ${r.description} (${r.url})`).join('\n');
}

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

  const [linkedinResults, newsResults] = await Promise.all([
    braveSearch(`${company} site:linkedin.com`),
    braveSearch(`${company} news`)
  ]);

  const searchContext = [
    formatSearchResults('Recent LinkedIn activity', linkedinResults),
    formatSearchResults('Recent news and announcements', newsResults)
  ].join('\n\n');

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
        content: `You are a competitive intelligence analyst for a B2B GTM team. Using the web search results below plus your own knowledge, generate a concise competitive intelligence report on "${company}".\n\nWeb search results:\n${searchContext}\n\nUse these exact headers, each in plain text on its own line (no "#" markdown heading symbols):\n\nRECENT ACTIVITY\nSTRATEGIC FOCUS\nBUYER PERSONA\nCOMPETITIVE POSITIONING\nENGAGEMENT ANGLE\n\nRECENT ACTIVITY: what the company has been publicly focused on lately, based on the search results above.\nSTRATEGIC FOCUS: themes and priorities showing up across their messaging.\nBUYER PERSONA: who they're selling to.\nCOMPETITIVE POSITIONING: how they present themselves against others, and where the openings are.\nENGAGEMENT ANGLE: a suggested way to approach a conversation about or against this company.\n\nWhenever a section uses a bulleted list with a named item (a persona segment, a competitor, a channel, etc.), always bold the label with double asterisks and follow it with a colon, in this exact format: "- **Label**: description". Never use a dash or em-dash after the label, and never leave the label unbolded.\n\nKeep it under 450 words. Be specific and actionable.`
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || 'No response received.';
  res.status(200).json({ result: text });
}
