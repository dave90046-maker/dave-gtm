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
      max_tokens: 2400,
      messages: [{
        role: 'user',
        content: `You are a senior competitive intelligence analyst briefing a sales or marketing professional ahead of a call or campaign targeting "${company}". Using the web search results below as your primary source, plus your own knowledge to fill gaps, generate a rigorous, analytically sharp Company Intelligence Brief. Go beyond surface-level description in every section — each bullet must deliver specific, actionable intelligence the reader could use immediately, not a generic summary.\n\nWeb search results:\n${searchContext}\n\nIf the search results and your own knowledge do not let you confidently identify a real, specific company matching "${company}" (for example the input looks like a random string, a typo, an internal code, or the search results are all unrelated), do NOT fabricate a brief. Instead, briefly explain in 1-3 sentences why "${company}" doesn't appear to correspond to an identifiable company, based on the search results and your own knowledge, then continue directly into exactly this structure, with each header in plain text on its own line (no "#" markdown heading symbols):\n\nWHAT LIKELY HAPPENED\nRECOMMENDED NEXT STEPS\n\nWHAT LIKELY HAPPENED: 1-3 sentences on the most likely explanation (e.g. a typo, an internal code, a test input).\n\nRECOMMENDED NEXT STEPS: A bulleted list of 3-4 concrete next steps, using the "- **Label**: description" bold-label format below.\n\nDo not add a transitional line (like "here is what I can offer instead") between your opening explanation and the WHAT LIKELY HAPPENED header, and do not close with an offer to generate the brief once a corrected name is provided — end after the last bullet.\n\nOtherwise, if you can confidently identify the company, use these exact headers, each in plain text on its own line (no "#" markdown heading symbols, and no horizontal-rule lines like "---" between sections):\n\nCOMPANY BIO\nRECENT ACTIVITY\nSTRATEGIC FOCUS\nBUYER PERSONA\nCOMPETITIVE POSITIONING\nKEY TAKEAWAYS\n\nCOMPANY BIO: In 2-3 sentences, summarize what the company is and does, and how long it has been in existence (founding year if known).\n\nEach section below this point needs 3-4 bullets minimum.\n\nRECENT ACTIVITY: Identify concrete, specific initiatives, launches, announcements, or leadership moves from the search results. Avoid generic observations like follower counts or award mentions unless they reveal a strategic signal. Every bullet should answer "so what does this mean for someone selling against or to them?"\n\nSTRATEGIC FOCUS: Identify the 3-4 dominant themes in their current messaging and positioning. Explain what each theme signals about where they are investing and where they may be vulnerable or stretched.\n\nBUYER PERSONA: Identify 3-4 distinct buyer types with specific titles, company contexts, and the core job-to-be-done each persona is trying to solve. Go beyond job titles to describe the mindset and pressure each buyer is under.\n\nCOMPETITIVE POSITIONING: Name 3-4 specific competitors and explain how ${company} differentiates against each. Identify at least one key vulnerability or positioning gap that a competitor could exploit.\n\nKEY TAKEAWAYS: Provide specific, opinionated takeaways a sales or marketing professional can act on immediately. Include at least one suggested question to ask prospects that surfaces a weakness or creates urgency.\n\nWhenever a section uses a bulleted list with a named item (a persona segment, a competitor, a channel, etc.), always bold the label with double asterisks and follow it with a colon, in this exact format: "- **Label**: description". Never use a dash or em-dash after the label, and never leave the label unbolded.\n\nBe specific, opinionated, and actionable throughout — favor concrete detail over broad statements.`
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || 'No response received.';
  res.status(200).json({ result: text });
}
