const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SUBSCRIPTIONS_FILE = path.join(__dirname, "..", "subscriptions.json");

const PLANS = {
  starter:    { price: "5.00",  credits: 1000,  months: 1,  desc: "1,000 credits/mo - ~200 extracts or ~333 analyzes" },
  pro:        { price: "20.00", credits: 5000,  months: 1,  desc: "5,000 credits/mo - ~1,000 extracts or ~1,666 analyzes" },
  enterprise: { price: "50.00", credits: 15000, months: 1,  desc: "15,000 credits/mo - ~3,000 extracts or ~5,000 analyzes" },
  yearly_pro: { price: "200.00", credits: 60000, months: 12, desc: "60,000 credits/yr - best value at $0.003/credit" },
};

const CREDIT_COSTS = {
  "/v1/extract":              5,
  "/v1/analyze":              3,
  "/v1/research":             20,
  "/v1/process":              8,
  "/v1/compare":              10,
  "/v1/extract-structured":   8,
  "/v1/sentiment-over-time":  8,
  "/v1/competitor-intel":     25,
  "/v1/monitor":              5,
  "/v1/brief":                15,
};

function getCost(path) {
  for (const key of Object.keys(CREDIT_COSTS)) {
    if (path.startsWith(key)) return CREDIT_COSTS[key];
  }
  return 5;
}

function loadSubscriptions() {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const data = fs.readFileSync(SUBSCRIPTIONS_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error("Failed to load subscriptions:", e.message);
  }
  return [];
}

function saveSubscriptions(subs) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
  } catch (e) {
    console.error("Failed to save subscriptions:", e.message);
  }
}

function generateToken() {
  return "sub_" + crypto.randomBytes(24).toString("hex");
}

function createSubscription(plan) {
  const subs = loadSubscriptions();
  const planConfig = PLANS[plan];
  if (!planConfig) throw new Error("Invalid plan: " + plan + ". Valid: " + Object.keys(PLANS).join(", "));

  const sub = {
    token: generateToken(),
    plan: plan,
    status: "active",
    totalCredits: planConfig.credits,
    remainingCredits: planConfig.credits,
    price: planConfig.price,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + planConfig.months * 30 * 24 * 60 * 60 * 1000).toISOString(),
    lastUsed: null,
  };

  subs.push(sub);
  saveSubscriptions(subs);
  return sub;
}

function validateAndDeduct(token, reqPath) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "no_token" };
  }

  const subs = loadSubscriptions();
  const sub = subs.find(function(s) { return s.token === token; });

  if (!sub) return { valid: false, reason: "invalid_token" };
  if (sub.status !== "active") return { valid: false, reason: "inactive", status: sub.status };
  if (new Date(sub.expiresAt) < new Date()) {
    sub.status = "expired";
    saveSubscriptions(subs);
    return { valid: false, reason: "expired" };
  }

  const cost = getCost(reqPath);
  if (sub.remainingCredits < cost) {
    return { valid: false, reason: "insufficient_credits", remaining: sub.remainingCredits, cost: cost };
  }

  sub.remainingCredits -= cost;
  sub.lastUsed = new Date().toISOString();
  saveSubscriptions(subs);

  return { valid: true, remaining: sub.remainingCredits, cost: cost, plan: sub.plan, total: sub.totalCredits };
}

function getSubscriptionInfo(token) {
  if (!token) return null;
  const subs = loadSubscriptions();
  const sub = subs.find(function(s) { return s.token === token; });
  if (!sub) return null;
  return {
    plan: sub.plan,
    status: sub.status,
    totalCredits: sub.totalCredits,
    remainingCredits: sub.remainingCredits,
    createdAt: sub.createdAt,
    expiresAt: sub.expiresAt,
    lastUsed: sub.lastUsed,
  };
}

function getPricing() {
  return {
    plans: PLANS,
    creditCosts: CREDIT_COSTS,
    payPerCall: { description: "x402 instant payment per API call (USDC on Base)" },
  };
}

module.exports = {
  createSubscription,
  validateAndDeduct,
  getSubscriptionInfo,
  getPricing,
  getCost,
  PLANS: PLANS,
  CREDIT_COSTS: CREDIT_COSTS,
};
