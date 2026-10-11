const MAX_PAGES = 5;
const PAGE_TIMEOUT_MS = 5000;
const BRAVE_TIMEOUT_MS = 6000;
const FIRST_PARTY_PHASE_TIMEOUT_MS = 12000;
const ANTHROPIC_TIMEOUT_MS = 90000;
const MAX_CHARS_PER_PAGE = 2000;
const MAX_HTML_LENGTH = 600000;
const SOFT_DUPLICATE_THRESHOLD = 0.85;

const AGGREGATOR_BLOCKLIST = [
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'youtube.com',
  'wikipedia.org', 'crunchbase.com', 'bloomberg.com', 'zoominfo.com', 'glassdoor.com',
  'indeed.com', 'pitchbook.com', 'owler.com', 'yelp.com', 'bbb.org', 'sec.gov',
  'reuters.com', 'forbes.com', 'techcrunch.com', 'businesswire.com', 'prnewswire.com',
  'manta.com', 'dnb.com', 'rocketreach.co', 'apollo.io', 'g2.com', 'capterra.com',
  'trustpilot.com', 'medium.com', 'github.com', 'google.com', 'maps.google.com'
];

const SECONDARY_SOURCE_LABELS = {
  'linkedin.com': 'LinkedIn',
  'zoominfo.com': 'ZoomInfo',
  'crunchbase.com': 'Crunchbase',
  'bloomberg.com': 'Bloomberg',
  'forbes.com': 'Forbes',
  'techcrunch.com': 'TechCrunch',
  'businesswire.com': 'Business Wire',
  'prnewswire.com': 'PR Newswire',
  'glassdoor.com': 'Glassdoor',
  'pitchbook.com': 'PitchBook',
  'owler.com': 'Owler',
  'wikipedia.org': 'Wikipedia',
  'reuters.com': 'Reuters',
  'manta.com': 'Manta',
  'dnb.com': 'Dun & Bradstreet'
};

const ABOUT_KEYWORDS = /about|company|who-we-are/i;
const TEAM_KEYWORDS = /team|leadership|people|our-team/i;
const NEWS_KEYWORDS = /news|insights|press|blog/i;

const ABOUT_PATH_FALLBACKS = ['/about', '/about-us', '/our-story'];
const TEAM_PATH_FALLBACKS = ['/team', '/our-team', '/leadership', '/people'];
const NEWS_PATH_FALLBACKS = ['/news', '/insights', '/blog', '/press'];

async function braveSearch(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRAVE_TIMEOUT_MS);
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      signal: controller.signal,
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
  } finally {
    clearTimeout(timer);
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHost(hostname) {
  return AGGREGATOR_BLOCKLIST.some(d => hostname === d || hostname.endsWith(`.${d}`));
}

function secondarySourceLabel(url) {
  const host = hostnameOf(url);
  if (!host) return 'Web';
  for (const [domain, label] of Object.entries(SECONDARY_SOURCE_LABELS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return label;
  }
  const base = host.split('.')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function looksLikeDomain(input) {
  return /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/.*)?$/i.test(input.trim());
}

function normalizeDomainInput(input) {
  let s = input.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return s.split('/')[0].toLowerCase();
}

function normalizeUrlForDedup(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    const path = u.pathname.replace(/\/$/, '');
    return `${host}${path}`.toLowerCase();
  } catch {
    return url;
  }
}

function citationRef(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${host}${path}`;
  } catch {
    return url;
  }
}

async function discoverDomain(company) {
  if (looksLikeDomain(company)) {
    return normalizeDomainInput(company);
  }
  const results = await braveSearch(company);
  for (const r of results) {
    const host = hostnameOf(r.url);
    if (host && !isBlockedHost(host)) return host;
  }
  return null;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GTMResearchBot/1.0)' }
    });
    if (!response.ok) return null;
    const html = await response.text();
    return { finalUrl: response.url || url, html: html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractReadableText(html) {
  let text = html;
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|noscript|svg|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function extractInternalLinks(html, baseUrl) {
  const baseHost = hostnameOf(baseUrl);
  const links = [];
  const anchorRegex = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      const resolved = new URL(match[1], baseUrl);
      if (hostnameOf(resolved.href) === baseHost) {
        links.push({ url: resolved.href, text });
      }
    } catch {
      // ignore unresolvable hrefs (mailto:, tel:, javascript:, etc.)
    }
  }
  return links;
}

function findBestLink(links, keywordRegex) {
  for (const link of links) {
    if (keywordRegex.test(`${link.url} ${link.text}`.toLowerCase())) return link.url;
  }
  return null;
}

function wordSet(text) {
  return new Set(text.toLowerCase().match(/[a-z]{5,}/g) || []);
}

function jaccardSimilarity(textA, textB) {
  const setA = wordSet(textA);
  const setB = wordSet(textB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

async function tryFetchPage(url, homepageUrl, homepageText) {
  const fetched = await fetchWithTimeout(url, PAGE_TIMEOUT_MS);
  if (!fetched) return null;
  if (normalizeUrlForDedup(fetched.finalUrl) === normalizeUrlForDedup(homepageUrl)) return null;
  const text = extractReadableText(fetched.html);
  if (jaccardSimilarity(text, homepageText) > SOFT_DUPLICATE_THRESHOLD) return null;
  return { url: fetched.finalUrl, text: text.slice(0, MAX_CHARS_PER_PAGE) };
}

async function resolveCategoryPage(category, links, domain, homepageUrl, homepageText, seenUrls) {
  const navMatch = findBestLink(links, category.keywords);
  if (navMatch && !seenUrls.has(normalizeUrlForDedup(navMatch))) {
    const page = await tryFetchPage(navMatch, homepageUrl, homepageText);
    if (page) return page;
  }

  const fallbackUrls = category.fallbackPaths
    .map(path => `https://${domain}${path}`)
    .filter(url => !seenUrls.has(normalizeUrlForDedup(url)));

  const results = await Promise.all(fallbackUrls.map(url => tryFetchPage(url, homepageUrl, homepageText)));
  return results.find(page => page !== null) || null;
}

async function fetchFirstPartyPages(domain) {
  const homepageUrl = `https://${domain}/`;
  const homepage = await fetchWithTimeout(homepageUrl, PAGE_TIMEOUT_MS);
  if (!homepage) return [];

  const homepageText = extractReadableText(homepage.html);
  const pages = [{ url: homepage.finalUrl, text: homepageText.slice(0, MAX_CHARS_PER_PAGE) }];
  const seenUrls = new Set([normalizeUrlForDedup(homepage.finalUrl)]);

  const links = extractInternalLinks(homepage.html, homepage.finalUrl);
  const categories = [
    { keywords: ABOUT_KEYWORDS, fallbackPaths: ABOUT_PATH_FALLBACKS },
    { keywords: TEAM_KEYWORDS, fallbackPaths: TEAM_PATH_FALLBACKS },
    { keywords: NEWS_KEYWORDS, fallbackPaths: NEWS_PATH_FALLBACKS }
  ];

  const categoryPages = await Promise.all(
    categories.map(category => resolveCategoryPage(category, links, domain, homepage.finalUrl, homepageText, seenUrls))
  );

  for (const page of categoryPages) {
    if (page && pages.length < MAX_PAGES && !seenUrls.has(normalizeUrlForDedup(page.url))) {
      pages.push(page);
      seenUrls.add(normalizeUrlForDedup(page.url));
    }
  }

  return pages;
}

function formatSecondaryResults(label, results) {
  if (!results.length) return `${label}: no results found.`;
  return `${label}:\n` + results
    .map(r => `- ${r.title}: ${r.description} (${r.url}) [Secondary: ${secondarySourceLabel(r.url)}]`)
    .join('\n');
}

function buildFirstPartyContext(pages) {
  if (!pages.length) {
    return 'FIRST-PARTY SOURCES: none could be fetched (no official site identified, or it did not respond in time).';
  }
  const body = pages
    .map(p => `--- FIRST-PARTY: ${citationRef(p.url)} ---\n${p.text}`)
    .join('\n\n');
  return `FIRST-PARTY SOURCES (the company's own website — authoritative for names, titles, founding date, and services):\n\n${body}`;
}

function buildSecondaryContext(linkedinResults, newsResults) {
  const body = [
    formatSecondaryResults('Recent LinkedIn activity', linkedinResults),
    formatSecondaryResults('Recent news and announcements', newsResults)
  ].join('\n\n');
  return `SECONDARY SOURCES (search snippets, aggregators, news, social — use to supplement first-party content or surface recent external signals, never to override it):\n\n${body}`;
}

function withTimeout(promise, ms, fallbackValue) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallbackValue), ms))
  ]);
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

  try {
    const [linkedinResults, newsResults, domain] = await Promise.all([
      braveSearch(`${company} site:linkedin.com`),
      braveSearch(`${company} news`),
      discoverDomain(company)
    ]);

    const firstPartyPages = domain
      ? await withTimeout(fetchFirstPartyPages(domain), FIRST_PARTY_PHASE_TIMEOUT_MS, [])
      : [];

    const sourceContext = [
      buildFirstPartyContext(firstPartyPages),
      buildSecondaryContext(linkedinResults, newsResults)
    ].join('\n\n');

    const anthropicController = new AbortController();
    const anthropicTimer = setTimeout(() => anthropicController.abort(), ANTHROPIC_TIMEOUT_MS);
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: anthropicController.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `You are a senior competitive intelligence analyst briefing a sales or marketing professional ahead of a call or campaign targeting "${company}". You have two tiers of source material below.\n\n${sourceContext}\n\nSOURCE RULES (apply throughout the brief):\n- Treat FIRST-PARTY content as the authoritative source of truth for names, titles, founding date, and services. Use SECONDARY sources only to fill gaps FIRST-PARTY content doesn't cover, or to surface recent external news/signals FIRST-PARTY content wouldn't contain.\n- Copy job titles exactly as written on FIRST-PARTY pages, character for character. Never paraphrase, shorten, or invent a title — if the site says "Principal and Chief Investment Officer," do not write "CIO" or "Managing Principal" instead.\n- Every named person and every key fact (founding date, leadership titles, specific services) needs a short inline citation in parentheses immediately after it, in exactly this format: "(First-party: <citation>)" or "(Secondary: <SourceName>)" — using the exact citation references given alongside each source above. Never cite a fact without one of these two formats.\n- If a fact cannot be confirmed from the sources above or your own reliable knowledge, write "Unknown" or "Not confirmed" rather than guessing.\n- If a SECONDARY source conflicts with a FIRST-PARTY date or fact (e.g. a title, a join date, a name), always use the FIRST-PARTY version as the stated fact, and add a brief flag noting the conflict, e.g. "Eric Shute joined in 2023 (First-party: example.com/team); a secondary source implies a more recent hire date (Secondary: LinkedIn) — first-party date used." Never draw a conclusion or build an analytical point from the conflicting secondary claim itself — the conflict gets a one-line flag and nothing more.\n- Keep sourced facts (Company Bio, Recent Activity, and any named people in Buyer Persona) visibly distinct from your own analysis and inference (Strategic Focus, Competitive Positioning, Key Takeaways) — facts carry a citation, interpretive bullets don't need one but should read as analysis, not as confirmed fact.\n\nUsing this source material as your primary input, plus your own knowledge to fill gaps the sources above don't cover, generate a rigorous, analytically sharp Company Intelligence Brief. Go beyond surface-level description in every section — each bullet must deliver specific, actionable intelligence the reader could use immediately, not a generic summary.\n\nYou MUST write all six sections below in full, ending with a complete KEY TAKEAWAYS section — never truncate or stop early.\n\nIf the sources above and your own knowledge do not let you confidently identify a real, specific company matching "${company}" (for example the input looks like a random string, a typo, an internal code, or the sources are all unrelated), do NOT fabricate a brief. Instead, briefly explain in 1-3 sentences why "${company}" doesn't appear to correspond to an identifiable company, based on the sources above and your own knowledge, then continue directly into exactly this structure, with each header in plain text on its own line (no "#" markdown heading symbols):\n\nWHAT LIKELY HAPPENED\nRECOMMENDED NEXT STEPS\n\nWHAT LIKELY HAPPENED: 1-3 sentences on the most likely explanation (e.g. a typo, an internal code, a test input).\n\nRECOMMENDED NEXT STEPS: A bulleted list of 3-4 concrete next steps, using the "- **Label**: description" bold-label format below.\n\nDo not add a transitional line (like "here is what I can offer instead") between your opening explanation and the WHAT LIKELY HAPPENED header, and do not close with an offer to generate the brief once a corrected name is provided — end after the last bullet.\n\nOtherwise, if you can confidently identify the company, use these exact headers, each in plain text on its own line (no "#" markdown heading symbols, and no horizontal-rule lines like "---" between sections):\n\nCOMPANY BIO\nRECENT ACTIVITY\nSTRATEGIC FOCUS\nBUYER PERSONA\nCOMPETITIVE POSITIONING\nKEY TAKEAWAYS\n\nCOMPANY BIO: In 2-3 sentences, summarize what the company is and does, and how long it has been in existence (founding year if known).\n\nEach section below this point needs exactly 3-4 bullets — not more. Keep every bullet to one sentence (two only if truly necessary) so the full brief stays concise.\n\nRECENT ACTIVITY: Identify concrete, specific initiatives, launches, announcements, or leadership moves from the sources above. Avoid generic observations like follower counts or award mentions unless they reveal a strategic signal. Every bullet should answer "so what does this mean for someone selling against or to them?"\n\nSTRATEGIC FOCUS: Identify the 3-4 dominant themes in their current messaging and positioning. Explain what each theme signals about where they are investing and where they may be vulnerable or stretched.\n\nBUYER PERSONA: Identify 3-4 distinct buyer types with specific titles, company contexts, and the core job-to-be-done each persona is trying to solve. Go beyond job titles to describe the mindset and pressure each buyer is under.\n\nCOMPETITIVE POSITIONING: Name 3-4 specific competitors and explain how ${company} differentiates against each. Identify at least one key vulnerability or positioning gap that a competitor could exploit.\n\nKEY TAKEAWAYS: Provide specific, opinionated takeaways a sales or marketing professional can act on immediately. Include at least one suggested question to ask prospects that surfaces a weakness or creates urgency.\n\nWhenever a section uses a bulleted list with a named item (a persona segment, a competitor, a channel, etc.), always bold the label with double asterisks and follow it with a colon, in this exact format: "- **Label**: description". Never use a dash or em-dash after the label, and never leave the label unbolded.\n\nBe specific, opinionated, and actionable throughout — favor concrete detail over broad statements, and keep every bullet concise and information-dense rather than a long explanatory sentence.`
          }]
        })
      });
    } finally {
      clearTimeout(anthropicTimer);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Anthropic API error: ${response.status} ${errorBody.slice(0, 500)}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || 'No response received.';
    res.status(200).json({ result: text });
  } catch (err) {
    console.error('research handler error:', err);
    res.status(502).json({ error: 'Failed to generate research brief' });
  }
}
