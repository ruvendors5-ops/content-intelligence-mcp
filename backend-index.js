const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { extractContent } = require('./lib/extract');
const { analyzeText } = require('./lib/analyze');
const { researchTopic } = require('./lib/research');
const { compareSources } = require('./lib/compare');
const { extractStructured } = require('./lib/structured');
const { sentimentOverTime } = require('./lib/sentiment-over-time');
const { competitorIntel } = require('./lib/competitor-intel');
const { monitorPage, getMonitoredPages } = require('./lib/monitor');
const { generateBrief } = require('./lib/brief');
const { healthCheck } = require('./lib/health');
const { createSubscription, validateAndDeduct, getSubscriptionInfo, getPricing, getCost, PLANS, CREDIT_COSTS } = require('./lib/subscription');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '512kb' }));

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || 'req_' + Date.now();
  req.startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    if (res.statusCode >= 400) {
      console.log('[' + req.id + '] ' + req.method + ' ' + req.path + ' -> ' + res.statusCode + ' (' + duration + 'ms)');
    }
  });
  next();
});

// Payment guard with credit-based subscription
app.use('/v1', (req, res, next) => {
  if (req.path === '/subscribe' || req.path === '/auth/validate' || req.path === '/auth/pricing') return next();
  if (req.headers['x-paid-request'] === 'true') return next();

  const subToken = req.headers['x-subscription-token'];
  if (subToken) {
    const v = validateAndDeduct(subToken, req.path);
    if (v.valid) {
      res.set('X-Subscription-Remaining', String(v.remaining));
      res.set('X-Subscription-Cost', String(v.cost));
      console.log('[' + req.id + '] Sub ' + subToken.substring(0,10) + '... -' + v.cost + ' credits (' + v.remaining + ' left)');
      return next();
    }
    return res.status(402).json({
      error: 'subscription_invalid', reason: v.reason, remaining: v.remaining, cost: v.cost,
      message: v.reason === 'insufficient_credits'
        ? 'Need ' + v.cost + ' credits, have ' + v.remaining + '. Top up at /v1/subscribe'
        : 'Subscription invalid/expired. Purchase at /v1/subscribe',
      subscribe: 'https://agent-gateway.wajih-hyder55.workers.dev/v1/subscribe',
    });
  }

  return res.status(402).json({
    error: 'payment_required',
    message: 'Access via x402: https://agent-gateway.wajih-hyder55.workers.dev' + req.path,
    gateway: 'https://agent-gateway.wajih-hyder55.workers.dev',
    subscribe: 'https://agent-gateway.wajih-hyder55.workers.dev/v1/subscribe',
  });
});

// Health
app.get('/health', async (req, res) => {
  try {
    const status = await healthCheck();
    res.status(status.ok ? 200 : 503).json(Object.assign(status, {
      version: '2.2.0',
      endpoints: ['/v1/extract','/v1/analyze','/v1/research','/v1/process','/v1/compare','/v1/extract-structured','/v1/sentiment-over-time','/v1/competitor-intel','/v1/monitor','/v1/brief','/v1/subscribe','/v1/auth/pricing','/v1/auth/validate'],
      subscription: getPricing(),
    }));
  } catch {
    res.json({ ok: true, api: 'running', version: '2.2.0', uptime: process.uptime(), timestamp: new Date().toISOString(), subscription: getPricing() });
  }
});

// Subscription management
app.get('/v1/auth/pricing', (req, res) => res.json(getPricing()));

app.post('/v1/auth/validate', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ valid: false, reason: 'no_token' });
  const info = getSubscriptionInfo(token);
  if (!info) return res.json({ valid: false, reason: 'invalid_token' });
  res.json(Object.assign({ valid: info.status === 'active' && new Date(info.expiresAt) > new Date() && info.remainingCredits > 0 }, info));
});

app.post('/v1/subscribe', async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan || !Object.keys(PLANS).includes(plan)) {
      return res.status(400).json({ error: 'Plan must be: ' + Object.keys(PLANS).join(', '), plans: PLANS });
    }
    const sub = createSubscription(plan);
    res.status(201).json({ success: true, token: sub.token, plan: sub.plan, credits: sub.totalCredits, price: sub.price, expiresAt: sub.expiresAt, message: sub.remainingCredits + ' credits remaining.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Subscription failed' });
  }
});

// Tool endpoints
const handlers = {
  '/v1/extract': async (req) => {
    const { url } = req.body;
    if (!url) { const e = new Error('url is required'); e.statusCode = 400; throw e; }
    return extractContent(url);
  },
  '/v1/analyze': async (req) => {
    const { text, actions } = req.body;
    if (!text) { const e = new Error('text is required'); e.statusCode = 400; throw e; }
    if (text.length > 50000) { const e = new Error('Text exceeds 50k limit'); e.statusCode = 400; throw e; }
    return analyzeText(text, actions || ['summarize']);
  },
  '/v1/research': async (req) => {
    const { query, depth } = req.body;
    if (!query) { const e = new Error('query is required'); e.statusCode = 400; throw e; }
    return researchTopic(query, depth || 'standard');
  },
  '/v1/process': async (req) => {
    const { url, text, actions } = req.body;
    if (!url && !text) { const e = new Error('url or text required'); e.statusCode = 400; throw e; }
    let content = text || '';
    let meta = {};
    if (url) {
      const ext = await extractContent(url);
      content = ext.textContent || '';
      meta = { title: ext.title, wordCount: ext.wordCount, excerpt: ext.excerpt };
    }
    if (!content || content.trim().length < 10) { const e = new Error('Insufficient content'); e.statusCode = 400; throw e; }
    const analysis = await analyzeText(content, actions || ['summarize']);
    return { pipeline: 'extract+analyze', extract: meta, analysis };
  },
  '/v1/compare': async (req) => {
    const { source_a, source_b, aspect } = req.body;
    if (!source_a || !source_b) { const e = new Error('source_a and source_b required'); e.statusCode = 400; throw e; }
    return compareSources(source_a, source_b, aspect || 'general');
  },
  '/v1/extract-structured': async (req) => {
    const { url, schema } = req.body;
    if (!url) { const e = new Error('url required'); e.statusCode = 400; throw e; }
    return extractStructured(url, schema);
  },
  '/v1/sentiment-over-time': async (req) => {
    const { texts, urls, topic } = req.body;
    if (!texts && !urls && !topic) { const e = new Error('texts, urls, or topic required'); e.statusCode = 400; throw e; }
    return sentimentOverTime({ texts, urls, topic });
  },
  '/v1/competitor-intel': async (req) => {
    const { company_a, company_b, industry, aspect } = req.body;
    if (!company_a || !company_b) { const e = new Error('company_a and company_b required'); e.statusCode = 400; throw e; }
    return competitorIntel({ company_a, company_b, industry, aspect });
  },
  '/v1/monitor': async (req) => {
    const { url, action, page_id, webhook } = req.body;
    if (!url) { const e = new Error('url required'); e.statusCode = 400; throw e; }
    return monitorPage({ url, action, page_id, webhook });
  },
  '/v1/brief': async (req) => {
    const { urls, topics, format, focus } = req.body;
    if ((!urls || !urls.length) && (!topics || !topics.length)) { const e = new Error('urls or topics required'); e.statusCode = 400; throw e; }
    return generateBrief({ urls, topics, format, focus });
  },
};

Object.entries(handlers).forEach(([path, handler]) => {
  app.post(path, async (req, res) => {
    try {
      const result = await handler(req);
      result.creditCost = getCost(req.path);
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Request failed' });
    }
  });
});

// Monitor pages list
app.get('/v1/monitor/pages', async (req, res) => {
  try { res.json(await getMonitoredPages()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[' + req.id + '] Unhandled:', err.message);
  res.status(500).json({ error: 'Internal error', id: req.id });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Content Intelligence API v2.2.0 on port ' + PORT);
  console.log('Plans: ' + Object.entries(PLANS).map(function(e) { return e[0] + ': $' + e[1].price + '/' + e[1].credits + ' credits'; }).join(', '));
  console.log('Costs: ' + JSON.stringify(CREDIT_COSTS));
});
