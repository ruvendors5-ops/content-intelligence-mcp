// ===== agent-gateway — Enhanced x402 Payment Gate =====
// Features: rate limiting, request validation, response caching, better error handling

const WALLET = "0x7003209BDDb2253B5Ba902211279a28fB7b39aD7";
const BACKEND = "http://13.61.3.171.nip.io:3000";
const FACILITATOR = "https://x402.org/facilitator";

// === Configuration ===
const CONFIG = {
  rateLimit: {
    windowMs: 60_000,        // 1 minute window
    maxPerWindow: 60,         // max requests per window per IP
    maxPerWindowStrict: 10,   // stricter limit for non-paying requests
  },
  cache: {
    healthTtl: 30,            // seconds to cache /health responses
  },
  maxBodyBytes: 512_000,      // 512KB max request body
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
};

// === Pricing ===
const PRICES = {
  '/v1/extract':  { amount: '0.005', desc: 'Extract clean content from a URL' },
  '/v1/analyze':  { amount: '0.003', desc: 'Analyze text (summary, sentiment, entities)' },
  '/v1/research': { amount: '0.02',  desc: 'Multi-source research synthesis' },
  '/v1/process':  { amount: '0.01',  desc: 'Full pipeline: extract + analyze' },
  '/v1/compare':  { amount: '0.02',  desc: 'Compare two articles side-by-side' },
};

function getPrice(path) {
  for (const key of Object.keys(PRICES)) {
    if (path.startsWith(key)) return PRICES[key];
  }
  return { amount: '0.005', desc: 'Content Intelligence API' };
}

// === Utilities ===
function b64(obj) { return btoa(JSON.stringify(obj)); }
function b64d(s) { return JSON.parse(atob(s)); }

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    }
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Payment-Signature, X-Paid-Request, X-Request-Id',
      'Access-Control-Max-Age': '86400',
    }
  });
}

// === Rate Limiter (per-isolate in-memory) ===
const rateLimitMap = new Map();

function checkRateLimit(ip, strict = false) {
  const maxReqs = strict ? CONFIG.rateLimit.maxPerWindowStrict : CONFIG.rateLimit.maxPerWindow;
  const now = Date.now();
  const windowKey = Math.floor(now / CONFIG.rateLimit.windowMs);
  const key = `${ip}:${windowKey}`;

  let entry = rateLimitMap.get(key);
  if (!entry) {
    entry = { count: 0, createdAt: now };
    rateLimitMap.set(key, entry);
    // Clean up old entries every time we add a new one
    if (rateLimitMap.size > 10000) {
      const cutoff = now - CONFIG.rateLimit.windowMs * 2;
      for (const [k, v] of rateLimitMap) {
        if (v.createdAt < cutoff) rateLimitMap.delete(k);
      }
    }
  }

  entry.count++;
  const remaining = Math.max(0, maxReqs - entry.count);

  return {
    allowed: entry.count <= maxReqs,
    remaining,
    resetIn: CONFIG.rateLimit.windowMs - (now % CONFIG.rateLimit.windowMs),
  };
}

// === Response Cache ===
const responseCache = new Map();

function getCacheKey(path, body) {
  const data = path + ':' + (body || '');
  return b64(data); // simple hash-like key
}

function cacheGet(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.response;
}

function cacheSet(key, response, ttlSec) {
  responseCache.set(key, {
    response,
    expiresAt: Date.now() + ttlSec * 1000,
  });
  // Evict if too many entries
  if (responseCache.size > 500) {
    const cutoff = Date.now();
    for (const [k, v] of responseCache) {
      if (v.expiresAt < cutoff) responseCache.delete(k);
    }
  }
}

// === Payment Verification ===
async function verifyPayment(payloadHeader) {
  try {
    const decoded = b64d(payloadHeader);
    const resp = await fetch(FACILITATOR + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: decoded,
        expectedRecipient: WALLET,
        network: 'eip155:8453'
      })
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    return result.verified ? decoded : null;
  } catch (e) {
    return null;
  }
}

// === Request Validation ===
function validateRequest(method, path, headers, body) {
  // Method check
  if (!CONFIG.allowedMethods.includes(method)) {
    return { valid: false, status: 405, error: 'method_not_allowed', message: `Method ${method} not allowed` };
  }

  // Path validation — prevent path traversal or weird paths
  if (path.includes('..') || path.includes('//') || /[^\w\/\-\_.~]/.test(path)) {
    return { valid: false, status: 400, error: 'invalid_path', message: 'Invalid request path' };
  }

  // Content-Type check for POST requests with bodies
  if (method === 'POST' && body && body.length > 0) {
    const ct = headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return { valid: false, status: 415, error: 'unsupported_media', message: 'Content-Type must be application/json' };
    }
  }

  // Body size check
  if (body && body.length > CONFIG.maxBodyBytes) {
    return { valid: false, status: 413, error: 'payload_too_large', message: `Request body exceeds ${CONFIG.maxBodyBytes / 1024}KB limit` };
  }

  return { valid: true };
}

// === Main Request Handler ===
async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  // === CORS Preflight ===
  if (method === 'OPTIONS') {
    return corsPreflight();
  }

  // === Rate Limiting (strict for non-paying) ===
  const isPaidPath = path.startsWith('/v1/');
  const alreadyPaid = !!request.headers.get('PAYMENT-SIGNATURE');
  const strict = isPaidPath && !alreadyPaid;

  const rl = checkRateLimit(clientIP, strict);
  const rlHeaders = {
    'X-RateLimit-Limit': String(strict ? CONFIG.rateLimit.maxPerWindowStrict : CONFIG.rateLimit.maxPerWindow),
    'X-RateLimit-Remaining': String(rl.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rl.resetIn / 1000)),
  };

  if (!rl.allowed) {
    return jsonResponse({
      error: 'rate_limited',
      message: 'Too many requests. Please slow down.',
      retryAfter: Math.ceil(rl.resetIn / 1000),
    }, 429, rlHeaders);
  }

  // === Health / Root (with caching) ===
  if (path === '/health' || path === '/') {
    const cacheKey = getCacheKey(path);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const resp = await fetch(BACKEND + '/health', { signal: AbortSignal.timeout(5000) });
      const data = await resp.json();
      const response = jsonResponse({
        ...data,
        gateway: 'x402',
        wallet: WALLET,
        prices: Object.fromEntries(
          Object.entries(PRICES).map(([k, v]) => [k, { amount: v.amount, description: v.desc }])
        ),
      }, 200, rlHeaders);
      cacheSet(cacheKey, response, CONFIG.cache.healthTtl);
      return response;
    } catch (e) {
      return jsonResponse({
        ok: false,
        error: 'backend_unreachable',
        detail: e.message,
        gateway: 'x402',
      }, 503, rlHeaders);
    }
  }

  // === Validation ===
  let body = null;
  try {
    if (method === 'POST' || method === 'PUT') {
      body = await request.text();
    }
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: 'Could not read request body' }, 400, rlHeaders);
  }

  const validation = validateRequest(method, path, request.headers, body);
  if (!validation.valid) {
    return jsonResponse({
      error: validation.error,
      message: validation.message,
    }, validation.status, rlHeaders);
  }

  // === v1 Endpoints — Payment Required ===
  if (path.startsWith('/v1/')) {
    const price = getPrice(path);
    const paymentHeader = request.headers.get('PAYMENT-SIGNATURE') || request.headers.get('payment-signature');

    if (!paymentHeader) {
      const payReq = b64({
        x402Version: 2,
        resource: { url: url.toString(), description: price.desc },
        accepted: {
          scheme: 'exact',
          network: 'eip155:8453',
          amount: price.amount,
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
          payTo: WALLET,
        }
      });

      return jsonResponse({
        error: 'payment_required',
        message: `Send ${price.amount} USDC on Base to access ${path}`,
        price: price.amount,
        wallet: WALLET,
        network: 'base',
        asset: 'USDC',
        endpoint: path,
        description: price.desc,
      }, 402, {
        ...rlHeaders,
        'PAYMENT-REQUIRED': payReq,
        'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, X-RateLimit-*',
      });
    }

    // Verify the payment
    const verified = await verifyPayment(paymentHeader);
    if (!verified) {
      return jsonResponse({
        error: 'invalid_payment',
        message: 'Payment verification failed. Check the signature or try again.',
      }, 402, rlHeaders);
    }

    // Proxy to backend
    try {
      const backendResp = await fetch(BACKEND + path + (url.search || ''), {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-Paid-Request': 'true',
          'X-Forwarded-For': clientIP,
        },
        body: body,
        signal: AbortSignal.timeout(60000), // 60s timeout for research endpoints
      });

      const responseData = await backendResp.text();

      // Try to parse as JSON for a clean response
      let parsed;
      try { parsed = JSON.parse(responseData); } catch { parsed = null; }

      return new Response(parsed ? JSON.stringify({
        ...parsed,
        _paid: true,
        _price: price.amount,
      }) : responseData, {
        status: backendResp.status,
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'PAYMENT-RESPONSE': b64({ status: 'settled', amount: price.amount, network: 'eip155:8453' }),
          'Access-Control-Expose-Headers': 'PAYMENT-RESPONSE, X-RateLimit-*',
          ...rlHeaders,
        }
      });
    } catch (e) {
      return jsonResponse({
        error: 'backend_error',
        message: 'The backend service encountered an error',
        detail: e.message,
      }, 502, rlHeaders);
    }
  }

  // === 404 ===
  return jsonResponse({
    error: 'not_found',
    message: `No endpoint at ${path}`,
    available: ['/health', '/v1/extract', '/v1/analyze', '/v1/research', '/v1/process', '/v1/compare'],
  }, 404, rlHeaders);
}

// === KV-based rate limiting (optional — use if KV namespace bound) ===
// If KV_RATE_LIMIT binding is available, use it for distributed rate limiting
async function kvRateLimitCheck(ip, strict) {
  if (typeof KV_RATE_LIMIT === 'undefined') {
    // Fall back to in-memory
    return checkRateLimit(ip, strict);
  }
  // KV-based rate limiting logic would go here
  // For now, fall back to in-memory
  return checkRateLimit(ip, strict);
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
