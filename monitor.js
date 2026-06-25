const crypto = require("crypto");
const { extractContent } = require("./extract");

// In-memory monitor storage (resets on restart)
// For persistence, we'd use a file or KV, but this works for demo/agent use
const monitoredPages = new Map();

async function monitorPage(params) {
  const { url, action, page_id, webhook } = params;

  if (!url) throw new Error("url is required");

  const extracted = await extractContent(url);
  const textContent = extracted.textContent || "";

  if (!textContent || textContent.trim().length < 10) {
    throw new Error("Insufficient content extracted from URL");
  }

  // Create content hash
  const contentHash = crypto.createHash("sha256").update(textContent).digest("hex");
  const wordCount = textContent.split(/\s+/).filter(Boolean).length;

  // If action is "watch", register for monitoring
  if (action === "watch") {
    const existing = monitoredPages.get(url);
    const newEntry = {
      id: page_id || `mon-${Date.now()}`,
      url,
      firstSeen: existing?.firstSeen || new Date().toISOString(),
      lastChecked: new Date().toISOString(),
      currentHash: contentHash,
      previousHash: existing?.currentHash || null,
      hasChanged: existing ? existing.currentHash !== contentHash : false,
      webhook: webhook || null,
      checkCount: (existing?.checkCount || 0) + 1,
    };
    monitoredPages.set(url, newEntry);

    return {
      monitored: true,
      id: newEntry.id,
      url,
      title: extracted.title,
      wordCount,
      contentHash,
      hasChanged: newEntry.hasChanged,
      checkCount: newEntry.checkCount,
      lastChecked: newEntry.lastChecked,
    };
  }

  // Default: just return content with hash (agent can compare on their end)
  return {
    monitored: false,
    url,
    title: extracted.title,
    excerpt: extracted.excerpt,
    wordCount,
    contentHash,
    textContent: textContent.substring(0, 30000),
    lastChecked: new Date().toISOString(),
  };
}

async function getMonitoredPages() {
  const pages = [];
  for (const [url, data] of monitoredPages.entries()) {
    pages.push({
      id: data.id,
      url,
      firstSeen: data.firstSeen,
      lastChecked: data.lastChecked,
      hasChanged: data.hasChanged,
      checkCount: data.checkCount,
    });
  }
  return { pages, count: pages.length };
}

module.exports = { monitorPage, getMonitoredPages };
