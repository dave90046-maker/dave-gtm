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
      max_tokens: 2200,
      system: 'You are a B2B lifecycle marketing strategist. Respond with ONLY valid JSON matching the exact structure requested — no markdown code fences, no preamble, no explanation, no trailing commentary. The entire response must be a single parseable JSON object and nothing else.',
      messages: [{
        role: 'user',
        content: `Build a 4-stage lifecycle email journey tailored to this context:\n\nProduct/Service: ${product}\nTarget Persona: ${persona}\nCompany Size: ${companySize}\nPrimary Pain Point: ${painPoint}\nJourney Goal: ${goal}\n\nReturn a JSON object with this exact structure:\n\n{\n  "stages": [\n    { "stage": "Awareness", "subject_line": "...", "subject_line_length": 0, "headline": "...", "body_preview": "...", "cta": "...", "strategic_intent": "..." },\n    { "stage": "Consideration", "subject_line": "...", "subject_line_length": 0, "headline": "...", "body_preview": "...", "cta": "...", "strategic_intent": "..." },\n    { "stage": "Decision", "subject_line": "...", "subject_line_length": 0, "headline": "...", "body_preview": "...", "cta": "...", "strategic_intent": "..." },\n    { "stage": "Onboarding", "subject_line": "...", "subject_line_length": 0, "headline": "...", "body_preview": "...", "cta": "...", "strategic_intent": "..." }\n  ]\n}\n\nField guidance for every stage:\n- subject_line: the email subject line, 30-50 characters, optimized for open rates and mobile display. No spammy language — no ALL CAPS, no excessive punctuation or emoji, no clickbait.\n- subject_line_length: the character count of subject_line.\n- headline: the email's opening headline or hook, shown inside the body once the email is opened — distinct from the subject line, and can be more expansive since it isn't constrained by inbox preview space.\n- body_preview: 2-3 sentences of realistic email body copy.\n- cta: short call-to-action button text, 2-5 words, e.g. "See Your Coverage Gaps".\n- strategic_intent: one sentence explaining the marketing rationale behind that stage for this specific journey.\n\nMake every field specific to this product, persona, company size, pain point, and goal — not generic boilerplate.`
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

  journey.stages.forEach(stage => {
    if (typeof stage.subject_line === 'string') {
      stage.subject_line_length = stage.subject_line.length;
    }
  });

  res.status(200).json(journey);
}
