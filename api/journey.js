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

  const { product, persona, companySize, painPoint, goal } = req.body || {};

  if (!product || !persona || !companySize || !painPoint || !goal) {
    return res.status(400).json({ error: 'product, persona, companySize, painPoint, and goal are all required' });
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
      max_tokens: 1500,
      system: 'You are a B2B lifecycle marketing strategist. Respond with ONLY valid JSON matching the exact structure requested — no markdown code fences, no preamble, no explanation, no trailing commentary. The entire response must be a single parseable JSON object and nothing else.',
      messages: [{
        role: 'user',
        content: `Build a 4-stage lifecycle email journey tailored to this context:\n\nProduct/Service: ${product}\nTarget Persona: ${persona}\nCompany Size: ${companySize}\nPrimary Pain Point: ${painPoint}\nJourney Goal: ${goal}\n\nReturn a JSON object with this exact structure:\n\n{\n  "stages": [\n    { "stage": "Awareness", "subject_line": "...", "body_preview": "...", "strategic_intent": "..." },\n    { "stage": "Consideration", "subject_line": "...", "body_preview": "...", "strategic_intent": "..." },\n    { "stage": "Decision", "subject_line": "...", "body_preview": "...", "strategic_intent": "..." },\n    { "stage": "Onboarding", "subject_line": "...", "body_preview": "...", "strategic_intent": "..." }\n  ]\n}\n\nMake every subject_line, body_preview, and strategic_intent specific to this product, persona, company size, pain point, and goal — not generic boilerplate. body_preview should read as 2-3 sentences of realistic email copy. strategic_intent should be one sentence explaining the marketing rationale behind that stage for this specific journey.`
      }]
    })
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    return res.status(502).json({ error: data.error?.message || 'Failed to generate journey' });
  }

  const rawText = data.content?.[0]?.text || '';
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  let journey;
  try {
    journey = JSON.parse(cleaned);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to parse journey response' });
  }

  if (!journey || !Array.isArray(journey.stages)) {
    return res.status(502).json({ error: 'Unexpected journey response format' });
  }

  res.status(200).json(journey);
}
