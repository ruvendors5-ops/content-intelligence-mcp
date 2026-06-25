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
const {
  createSubscription,
  validateAndUseToken,
  getSubscriptionInfo,
  getPricing,
} = require('./lib/subscription');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '512kb' }));

// Request ID + timing
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || `req_${Date.now()}`;
  req.startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    if (res.statusCode >= 400) {
      console.log(`[${req.id}] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Payment guard — allow x402 (X-Paid-Request) OR valid subscription token
app.use('/v1', (req, res, next) => {
  // Skip auth for subscription management endpoints
  if (req.path === '/v1/subscribe' || req.path === '/v1/auth/validate' || req.path === '/v1/auth/pricing') {
    return next();
  }

  // Check for x402 payment
  if (req.headers['x-paid-request'] === 'true') {
    return next();
  }

  // Check for subscription token
  const subToken = req.headers['x-subscription-token'];
  if (subToken) {
    const validation = validateAndUseToken(subToken);
    if (validation.valid) {
      res.set('X-Subscription-Remaining', String(validation.remaining));
      return next();
    }
    return res.status(402).json({
      error: 'subscription_invalid',
      reason: validation.reason,
      message: 'Subscription token is invalid, expired, or exhausted. Purchase a new subscription at /v1/subscribe',
      subscribe: `https://agent-gateway.wajih-hyder55.workers.dev/v1/subscribe`,
    });
  }

  return res.status(402).json({
    error: 'payment_required',
    message: 'Access via x402 gateway: https://agent-gateway.wajih-hyder55.workers.dev' + req.path,
    gateway: 'https://agent-gateway.wajih-hyder55.workers.dev',
    subscribe: 'https://agent-gateway.wajih-hyder55.workers.dev/v1/subscribe',
  });
});

// ---- Health ----
app.get('/health', async (req, res) => {
  try {
    const status = await healthCheck();
    res.status(status.ok ? 200 : 503).json({
      ...status,
      version: '2.1.0',
      endpoints: [
        '/v1/extract',
        '/v1/analyze',
        '/v1/research',
        '/v1/process',
        '/v1/compare',
        '/v1/extract-structured',
        '/v1/sentiment-over-time',
        '/v1/competitor-intel',
        '/v1/monitor',
        '/v1/brief',
        '/v1/subscribe',
        '/v1/auth/pricing',
        '/v1/auth/validate',
      ],
      subscriptions: getPricing(),
    });
  } catch {
    res.json({
      ok: true,
      api: 'running',
      version: '2.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }
});

// ---- Subscription endpoints (no x402 needed) ----

// Subscription pricing info
app.get('/v1/auth/pricing', (req, res) => {
  res.json(getPricing());
});

// Validate subscription token (used by Worker internally)
app.post('/v1/auth/validate', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ valid: false, reason: 'no_token' });

  const info = getSubscriptionInfo(token);
  if (!info) return res.json({ valid: false, reason: 'invalid_token' });

  res.json({
    valid: info.status === 'active' && new Date(info.expiresAt) > new Date() && info.remainingCalls > 0,
    ...info,
  });
});

// Subscribe endpoint (x402 payment gated, returns token)
app.post('/v1/subscribe', async (req, res) => {
  try {
    // Note: x402 payment is verified by the Worker before reaching here
    // The Worker sets X-Paid-Request after verifying payment
    const { plan } = req.body;
    if (!plan || !['monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ error: 'Plan must be "monthly" or "yearly"' });
    }

    const sub = createSubscription(plan);
    console.log(`[${req.id}] New subscription created: ${sub.token} (${plan})`);

    res.status(201).json({
      success: true,
      token: sub.token,
      plan: sub.plan,
      totalCalls: sub.totalCalls,
      price: sub.price,
      expiresAt: sub.expiresAt,
      message: `Subscription active. Remaining: ${sub.remainingCalls} calls.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Subscription creation failed' });
  }
});

// ---- Existing endpoints ----

app.post('/v1/extract', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const result = await extractContent(url);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Extraction failed' });
  }
});

app.post('/v1/analyze', async (req, res) => {
  try {
    const { text, actions } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > 50000) return res.status(400).json({ error: 'Text exceeds 50,000 character limit' });
    const result = await analyzeText(text, actions || ['summarize']);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Analysis failed' });
  }
});

app.post('/v1/research', async (req, res) => {
  try {
    const { query, depth } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    if (query.trim().length < 3) return res.status(400).json({ error: 'Query must be at least 3 characters' });
    const result = await researchTopic(query, depth || 'standard');
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Research failed' });
  }
});

app.post('/v1/process', async (req, res) => {
  try {
    const { url, text, actions } = req.body;
    if (!url && !text) return res.status(400).json({ error: 'Either url or text is required' });

    let content = text || '';
    let extractMeta = {};
    if (url) {
      const extracted = await extractContent(url);
      content = extracted.textContent || '';
      extractMeta = { title: extracted.title, wordCount: extracted.wordCount, excerpt: extracted.excerpt };
    }

    if (!content || content.trim().length < 10) {
      return res.status(400).json({ error: 'Insufficient content to analyze' });
    }

    const analysis = await analyzeText(content, actions || ['summarize']);
    res.json({ pipeline: 'extract+analyze', extract: extractMeta, analysis });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Pipeline failed' });
  }
});

app.post('/v1/compare', async (req, res) => {
  try {
    const { source_a, source_b, aspect } = req.body;
    if (!source_a || !source_b) {
      return res.status(400).json({ error: 'Both source_a and source_b are required' });
    }
    const result = await compareSources(source_a, source_b, aspect || 'general');
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Comparison failed' });
  }
});

// ---- NEW endpoints ----

// Structured extraction
app.post('/v1/extract-structured', async (req, res) => {
  try {
    const { url, schema } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const result = await extractStructured(url, schema);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Structured extraction failed' });
  }
});

// Sentiment over time / batch sentiment
app.post('/v1/sentiment-over-time', async (req, res) => {
  try {
    const { texts, urls, topic } = req.body;
    if (!texts && !urls && !topic) {
      return res.status(400).json({ error: 'One of texts, urls, or topic is required' });
    }
    const result = await sentimentOverTime({ texts, urls, topic });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Sentiment analysis failed' });
  }
});

// Competitor intelligence
app.post('/v1/competitor-intel', async (req, res) => {
  try {
    const { company_a, company_b, industry, aspect } = req.body;
    if (!company_a || !company_b) {
      return res.status(400).json({ error: 'Both company_a and company_b are required' });
    }
    const result = await competitorIntel({ company_a, company_b, industry, aspect });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Competitor intel failed' });
  }
});

// Page monitoring
app.post('/v1/monitor', async (req, res) => {
  try {
    const { url, action, page_id, webhook } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const result = await monitorPage({ url, action, page_id, webhook });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Monitor failed' });
  }
});

// List monitored pages
app.get('/v1/monitor/pages', async (req, res) => {
  try {
    const result = await getMonitoredPages();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list monitored pages' });
  }
});

// Daily/weekly brief
app.post('/v1/brief', async (req, res) => {
  try {
    const { urls, topics, format, focus } = req.body;
    if ((!urls || !Array.isArray(urls) || urls.length === 0) &&
        (!topics || !Array.isArray(topics) || topics.length === 0)) {
      return res.status(400).json({ error: 'Either urls (array) or topics (array) is required' });
    }
    const result = await generateBrief({ urls, topics, format, focus });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Brief generation failed' });
  }
});

// ---- Error handler ----
app.use((err, req, res, next) => {
  console.error(`[${req.id}] Unhandled error:`, err.message);
  res.status(500).json({ error: 'Internal server error', id: req.id });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Content Intelligence API v2.1.0 running on port ${PORT}`);
});
