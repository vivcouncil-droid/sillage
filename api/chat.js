// ─────────────────────────────────────────
// SILLAGE — Secure API Proxy v2
// ─────────────────────────────────────────

// 1. RATE LIMITING — 10 calls per IP per hour
const rateMap = new Map();

function checkRate(ip) {
  const now = Date.now();
  const WINDOW = 60 * 60 * 1000; // 1 hour
  const MAX = 10;
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(ip, entry);
  // Cleanup old entries
  if (rateMap.size > 2000) {
    for (const [key, val] of rateMap) {
      if (now - val.start > WINDOW) rateMap.delete(key);
    }
  }
  return entry.count <= MAX;
}

// 2. PROMPT INJECTION PATTERNS
const INJECTION_PATTERNS = [
  /ignore\s+(previous|prior|above|all)\s+instructions?/i,
  /forget\s+(everything|all|your|previous)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /act\s+as\s+(if\s+you\s+are|a|an)\s+/i,
  /pretend\s+(you|to)\s+/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /do\s+anything\s+now/i,
  /disregard\s+(your|all|previous)/i,
  /override\s+(your|the|all)\s+(instructions?|rules?|system)/i,
  /system\s*prompt/i,
  /bypass\s+(safety|filter|restriction|guideline)/i,
  /new\s+persona/i,
  /from\s+now\s+on\s+(you|act|behave)/i,
  /<script/i,
  /javascript:/i,
];

function isInjection(text) {
  if (!text || typeof text !== 'string') return false;
  return INJECTION_PATTERNS.some(p => p.test(text));
}

function scanMessages(messages) {
  if (!Array.isArray(messages)) return true; // block if invalid
  return messages.some(msg => {
    const content = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content || '');
    return isInjection(content);
  });
}

export default async function handler(req, res) {
  // 3. SECURITY HEADERS on every response
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // 4. CORS — only allow our domains
  const ALLOWED_ORIGINS = [
    'https://sillage.to',
    'https://www.sillage.to',
    'https://sillage-app.vercel.app',
  ];
  const origin = req.headers.origin || '';
  const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isAllowed = isLocalDev || ALLOWED_ORIGINS.includes(origin);

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 5. RATE LIMIT
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() 
    || req.socket?.remoteAddress 
    || 'unknown';

  if (!checkRate(ip)) {
    res.setHeader('Retry-After', '3600');
    return res.status(429).json({ 
      error: 'Too many requests. Please try again in an hour.' 
    });
  }

  // 6. VALIDATE BODY
  const body = req.body || {};
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // 7. PROMPT INJECTION CHECK
  if (scanMessages(body.messages) || isInjection(body.system || '')) {
    return res.status(400).json({ error: 'Invalid input detected.' });
  }

  // 8. WHITELIST ONLY SAFE FIELDS — never pass raw body to Anthropic
  const isMainAnalysis = (body.max_tokens || 0) >= 1400;
  const model = isMainAnalysis
    ? 'claude-sonnet-4-6'
    : 'claude-haiku-4-5-20251001';

  const safeBody = {
    model,
    max_tokens: Math.min(parseInt(body.max_tokens) || 1000, 1500),
    system: typeof body.system === 'string' ? body.system.slice(0, 4000) : '',
    messages: body.messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content.slice(0, 3000) : ''
    }))
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeBody),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
}
