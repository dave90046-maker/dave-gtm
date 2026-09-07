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

  const { platform, campaigns, xLabel, yLabel } = req.body || {};

  if (!platform || !Array.isArray(campaigns) || campaigns.length === 0 || !xLabel || !yLabel) {
    return res.status(400).json({ error: 'platform, xLabel, yLabel, and a non-empty campaigns array are required' });
  }

  const hookLabel = platform === 'linkedin' ? 'headline' : 'subject line';

  const dataLines = campaigns
    .map(c => `- ${c.name} | ${hookLabel}: "${c.hook}" | ${xLabel}: ${(c.x * 100).toFixed(1)}% | ${yLabel}: ${(c.y * 100).toFixed(1)}%`)
    .join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      system: 'You are a B2B lifecycle and demand-gen analyst. Respond with ONLY valid JSON matching the exact structure requested — no markdown code fences, no preamble, no explanation, no trailing commentary. The entire response must be a single parseable JSON object and nothing else.',
      messages: [{
        role: 'user',
        content: `Analyze this ${platform === 'linkedin' ? 'LinkedIn organic post' : 'email'} campaign performance dataset. The X-axis is "${xLabel}" (how well the ${hookLabel} grabbed attention) and the Y-axis is "${yLabel}" (how well the content that followed performed). Here is every campaign:\n\n${dataLines}\n\nReturn a JSON object with this exact structure:\n\n{\n  "summary": "...",\n  "best": { "name": "...", "lever": "hook" | "content", "explanation": "..." },\n  "worst": { "name": "...", "lever": "hook" | "content", "explanation": "..." }\n}\n\nField guidance:\n- summary: 2-3 sentences describing the overall performance pattern across the dataset — where campaigns cluster relative to the quadrant means, and what that suggests about this team's hooks vs. content.\n- best: the single best-performing campaign by name (must match a name from the list exactly). "lever" is whichever of "hook" or "content" most drove that result. "explanation" is one sentence, specific, referencing its actual ${xLabel} and/or ${yLabel} values.\n- worst: the single worst-performing campaign by name (must match a name from the list exactly). Same format as best.\n\nBe specific and reference actual numbers. Do not hedge.`
      }]
    })
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    return res.status(502).json({ error: data.error?.message || 'Failed to generate performance analysis' });
  }

  const rawText = data.content?.[0]?.text || '';
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  let analysis;
  try {
    analysis = JSON.parse(cleaned);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to parse performance analysis response' });
  }

  if (!analysis || typeof analysis.summary !== 'string' || !analysis.best || !analysis.worst) {
    return res.status(502).json({ error: 'Unexpected performance analysis response format' });
  }

  res.status(200).json(analysis);
}
