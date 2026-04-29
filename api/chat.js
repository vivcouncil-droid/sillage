// ─────────────────────────────────────────
// SILLAGE — Secure API Proxy
// ─────────────────────────────────────────

// 1. RATE LIMITING — max 10 calls per IP per hour
const rateMap = new Map();

function checkRate(ip) {
  const now = Date.now();
  const window = 60 * 60 * 1000;
  const max = 10;
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > window) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(ip, entry);
  if (rateMap.size > 2000) {
    for (const [key, val] of rateMap) {
      if (now - val.start > window) rateMap.delete(key);
    }
  }
  return entry.count <= max;
}

// 2. PROMPT INJECTION FILTER
const INJECTION_PATTERNS = [
  /ignore\s+(previous|prior|above|all)\s+instructions?/i,
  /forget\s+(everything|all|your|previous)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /act\s+as\s+(a|an)\s+/i,
  /pretend\s+(you|to)\s+/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /do\s+anything\s+now/i,
  /disregard\s+(your|all|previous)/i,
  /override\s+(your|the|all)/i,
  /system\s*prompt/i,
  /bypass\s+(safety|filter|restriction)/i,
  /manipulation\s+script/i,
  /emotional\s+manipulat/i,
];

function containsInjection(text) {
  if (!text || typeof text !== 'string') return false;
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

function scanMessages(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some(msg => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return containsInjection(content);
  });
}

export default async function handler(req, res) {
  // 3. SECURITY HEADERS
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 4. ORIGIN CHECK — only allow requests from our domain
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const allowed = ['https://sillage.to', 'https://sillage-app.vercel.app'];
  const isLocalDev = origin.includes('localhost') || origin.includes('127.0.0.1');
  const isAllowed = isLocalDev || allowed.some(d => origin.includes(d) || referer.includes(d));

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 5. RATE LIMIT
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Previše zahtjeva. Pokušaj ponovo za sat vremena.' });
  }

  // 6. VALIDATE REQUEST BODY
  const { messages, system, max_tokens } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  // 7. PROMPT INJECTION CHECK
  if (scanMessages(messages) || containsInjection(system)) {
    return res.status(400).json({ error: 'Invalid input detected.' });
  }

  // 8. MODEL ROUTING — Sonnet for main analysis, Haiku for modals
  const isMainAnalysis = max_tokens >= 1400;
  const model = isMainAnalysis ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  const body = {
    model,
    system: system || '',
    messages,
    max_tokens: Math.min(max_tokens || 1000, 1500)
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Proxy error' });
  }
}
