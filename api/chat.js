// Simple in-memory rate limiter
// Max 5 API calls per IP per hour (covers: 1 analysis + all 4 modals)
const rateMap = new Map();

function checkRate(ip) {
  const now = Date.now();
  const window = 60 * 60 * 1000; // 1 hour
  const max = 5;
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > window) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(ip, entry);
  if (rateMap.size > 1000) {
    for (const [key, val] of rateMap) {
      if (now - val.start > window) rateMap.delete(key);
    }
  }
  return entry.count <= max;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Previše zahtjeva. Pokušaj ponovo za sat vremena.' });
  }

  const body = {
    ...req.body,
    model: 'claude-haiku-4-5-20251001',
    max_tokens: Math.min(req.body.max_tokens || 1000, 1500)
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
    return res.status(500).json({ error: 'Proxy error', details: error.message });
  }
}
