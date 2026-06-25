const WALLET = "0x7003209BDDb2253B5Ba902211279a28fB7b39aD7";
const BACKEND = "http://13.61.3.171:3000";
const FACILITATOR = "https://x402.org/facilitator";

const PRICES = {
  '/v1/extract':            { amount: '0.005', desc: 'Extract clean content from a URL' },
  '/v1/analyze':            { amount: '0.003', desc: 'Analyze text (summary, sentiment, entities)' },
  '/v1/research':           { amount: '0.02',  desc: 'Multi-source research synthesis' },
  '/v1/process':            { amount: '0.01',  desc: 'Full pipeline: extract + analyze' },
  '/v1/compare':            { amount: '0.01',  desc: 'Compare two sources for similarities and differences' },
  '/v1/extract-structured': { amount: '0.008', desc: 'Extract structured JSON from a URL' },
  '/v1/sentiment-over-time':{ amount: '0.008', desc: 'Sentiment trend analysis across multiple sources' },
  '/v1/competitor-intel':   { amount: '0.025', desc: 'Competitive intelligence analysis of two companies' },
  '/v1/monitor':            { amount: '0.005', desc: 'Monitor a page for content changes' },
  '/v1/brief':              { amount: '0.015', desc: 'Generate a briefing from multiple sources' },
  '/v1/subscribe':          { amount: '5.00',  desc: 'Monthly subscription (200 calls) — $5 USDC' },
};

function getPrice(path) {
  for (const key of Object.keys(PRICES)) {
    if (path.startsWith(key)) return PRICES[key];
  }
  return { amount: '0.005', desc: 'Content Intelligence API' };
}

function b64(obj) { return btoa(JSON.stringify(obj)); }
function b64d(s) { return JSON.parse(atob(s)); }

async function verifyPayment(payloadHeader) {
  try {
    const decoded = b64d(payloadHeader);
    const resp = await fetch(FACILITATOR + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: decoded, expectedRecipient: WALLET, network: 'eip155:8453' })
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    return result.verified ? decoded : null;
  } catch(e) { return null; }
}

async function validateSubscription(token) {
  try {
    const resp = await fetch(BACKEND + '/v1/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Paid-Request': 'true' },
      body: JSON.stringify({ token })
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    return result.valid ? result : null;
  } catch(e) { return null; }
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' } });
  }

  if (path === '/health' || path === '/') {
    try {
      const resp = await fetch(BACKEND + '/health');
      const data = await resp.json();
      return new Response(JSON.stringify(Object.assign(data, {
        gateway: 'x402',
        wallet: WALLET,
        subscriptions: { monthly: { price: '5 USDC', calls: 200 }, yearly: { price: '50 USDC', calls: 3000 } }
      })), {
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: 'backend unreachable' }), {
        headers: { 'content-type': 'application/json' }
      });
    }
  }

  if (path.startsWith('/v1/')) {
    // Check for subscription token first
    const subToken = request.headers.get('X-Subscription-Token');
    if (subToken) {
      const subValid = await validateSubscription(subToken);
      if (subValid) {
        // Subscription valid — proxy directly
        try {
          const body = request.method === 'GET' ? null : await request.text();
          const backendResp = await fetch(BACKEND + path + url.search, {
            method: request.method,
            headers: {
              'Content-Type': 'application/json',
              'X-Paid-Request': 'true',
              'X-Subscription-Token': subToken,
              'X-Request-Id': request.headers.get('X-Request-Id') || ''
            },
            body: body
          });
          const responseData = await backendResp.text();
          return new Response(responseData, {
            status: backendResp.status,
            headers: {
              'content-type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'X-Subscription-Remaining': String(subValid.remainingCalls || 0)
            }
          });
        } catch(e) {
          return new Response(JSON.stringify({ error: 'backend_error', detail: e.message }), {
            status: 502, headers: { 'content-type': 'application/json' }
          });
        }
      }
      // Token invalid — fall through to x402
    }

    // x402 payment flow
    const price = getPrice(path);
    const paymentHeader = request.headers.get('PAYMENT-SIGNATURE');

    if (!paymentHeader) {
      const payReq = b64({
        x402Version: 2,
        resource: { url: url.toString(), description: price.desc },
        accepted: { scheme: 'exact', network: 'eip155:8453', amount: price.amount, asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: WALLET }
      });

      return new Response(JSON.stringify({
        error: 'payment_required',
        message: 'Send ' + price.amount + ' USDC on Base to access ' + path,
        price: price.amount,
        wallet: WALLET,
        network: 'base',
        subscribe: { monthly: '5 USDC for 200 calls', endpoint: '/v1/subscribe' }
      }), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'PAYMENT-REQUIRED': payReq,
          'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const verified = await verifyPayment(paymentHeader);
    if (!verified) {
      return new Response(JSON.stringify({ error: 'invalid_payment' }), {
        status: 402, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      const body = request.method === 'GET' ? null : await request.text();
      const backendResp = await fetch(BACKEND + path + url.search, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Paid-Request': 'true',
          'X-Request-Id': request.headers.get('X-Request-Id') || ''
        },
        body: body
      });
      const responseData = await backendResp.text();
      return new Response(responseData, {
        status: backendResp.status,
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'PAYMENT-RESPONSE': b64({ status: 'settled', amount: price.amount })
        }
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'backend_error', detail: e.message }), {
        status: 502, headers: { 'content-type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404, headers: { 'content-type': 'application/json' }
  });
}

addEventListener('fetch', event => { event.respondWith(handleRequest(event.request)); });
