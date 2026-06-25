const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SUBSCRIPTIONS_FILE = path.join(__dirname, "..", "subscriptions.json");
const DEFAULT_CALLS_MONTHLY = 200;
const DEFAULT_CALLS_YEARLY = 3000;
const PRICE_MONTHLY_USDC = "5.00";
const PRICE_YEARLY_USDC = "50.00";

// Load subscriptions from file
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

// Save subscriptions to file
function saveSubscriptions(subs) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
  } catch (e) {
    console.error("Failed to save subscriptions:", e.message);
  }
}

// Generate a unique subscription token
function generateToken() {
  return "sub_" + crypto.randomBytes(24).toString("hex");
}

// Create a new subscription
function createSubscription(plan) {
  const subs = loadSubscriptions();
  const isMonthly = plan === "monthly";

  const sub = {
    token: generateToken(),
    plan,
    status: "active",
    totalCalls: isMonthly ? DEFAULT_CALLS_MONTHLY : DEFAULT_CALLS_YEARLY,
    remainingCalls: isMonthly ? DEFAULT_CALLS_MONTHLY : DEFAULT_CALLS_YEARLY,
    price: isMonthly ? PRICE_MONTHLY_USDC : PRICE_YEARLY_USDC,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(
      Date.now() + (isMonthly ? 30 : 365) * 24 * 60 * 60 * 1000
    ).toISOString(),
    lastUsed: null,
  };

  subs.push(sub);
  saveSubscriptions(subs);
  return sub;
}

// Validate a subscription token and decrement call count
function validateAndUseToken(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "no_token" };
  }

  const subs = loadSubscriptions();
  const sub = subs.find((s) => s.token === token);

  if (!sub) {
    return { valid: false, reason: "invalid_token" };
  }

  if (sub.status !== "active") {
    return { valid: false, reason: "inactive", status: sub.status };
  }

  if (new Date(sub.expiresAt) < new Date()) {
    sub.status = "expired";
    saveSubscriptions(subs);
    return { valid: false, reason: "expired" };
  }

  if (sub.remainingCalls <= 0) {
    return { valid: false, reason: "exhausted" };
  }

  // Decrement call count
  sub.remainingCalls -= 1;
  sub.lastUsed = new Date().toISOString();
  saveSubscriptions(subs);

  return { valid: true, remaining: sub.remainingCalls, plan: sub.plan };
}

// Get subscription info (without decrementing)
function getSubscriptionInfo(token) {
  if (!token) return null;

  const subs = loadSubscriptions();
  const sub = subs.find((s) => s.token === token);

  if (!sub) return null;

  return {
    plan: sub.plan,
    status: sub.status,
    totalCalls: sub.totalCalls,
    remainingCalls: sub.remainingCalls,
    createdAt: sub.createdAt,
    expiresAt: sub.expiresAt,
    lastUsed: sub.lastUsed,
  };
}

// Get subscription pricing info
function getPricing() {
  return {
    monthly: { price: PRICE_MONTHLY_USDC, calls: DEFAULT_CALLS_MONTHLY, description: "200 calls/month for $5 USDC" },
    yearly: { price: PRICE_YEARLY_USDC, calls: DEFAULT_CALLS_YEARLY, description: "3000 calls/year for $50 USDC" },
    payPerCall: { description: "x402 instant payment per API call" },
  };
}

module.exports = {
  createSubscription,
  validateAndUseToken,
  getSubscriptionInfo,
  getPricing,
};
