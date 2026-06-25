// Content Intelligence MCP Server v2.1.0
// Wraps x402 API as MCP tools for AI agent discovery
// Supports both x402 pay-per-call and subscriptions

const BACKEND = "https://agent-gateway.wajih-hyder55.workers.dev";

const SERVER_INFO = {
  name: "content-intelligence-api",
  version: "2.1.0",
  description: "Content Intelligence API — extract, analyze, research, monitor, compare, brief. Pay per call via USDC (x402) or subscribe for 200 calls/month.",
  payment: {
    type: "x402",
    network: "Base",
    asset: "USDC",
    assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    wallet: "0x7003209BDDb2253B5Ba902211279a28fB7b39aD7",
    subscription: {
      monthly: { price: "5 USDC", calls: 200, endpoint: "/v1/subscribe" },
      yearly: { price: "50 USDC", calls: 3000, endpoint: "/v1/subscribe" },
    },
  },
};

const TOOLS = [
  {
    name: "extract_content",
    description: "Extract clean readable content from a URL. Removes ads, clutter, navigation. Pay per call (0.005 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri", description: "The URL to extract content from" },
      },
      required: ["url"],
    },
  },
  {
    name: "analyze_text",
    description: "Analyze text for summary, sentiment, entities, topics, and classification. Pay per call (0.003 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to analyze (up to 50k chars)" },
      },
      required: ["text"],
    },
  },
  {
    name: "research_topic",
    description: "Multi-source research synthesis on any topic. Searches the web and synthesizes findings with AI. Pay per call (0.02 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Research query or topic" },
        depth: { type: "string", enum: ["quick", "standard", "deep"], default: "standard" },
      },
      required: ["query"],
    },
  },
  {
    name: "compare_articles",
    description: "Compare two sources (URLs or text) for similarities, differences, coverage, and bias. Pay per call (0.01 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        source_a: { type: "string", description: "First source URL or text content" },
        source_b: { type: "string", description: "Second source URL or text content" },
        aspect: { type: "string", description: "Optional focus aspect (e.g., 'security', 'performance')" },
      },
      required: ["source_a", "source_b"],
    },
  },
  {
    name: "extract_structured",
    description: "Extract structured JSON data from a URL. Define a schema or let AI infer the structure. Pay per call (0.008 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri", description: "The URL to extract structured data from" },
        schema: { type: "object", description: "Optional JSON schema definition for extraction fields" },
      },
      required: ["url"],
    },
  },
  {
    name: "sentiment_over_time",
    description: "Analyze sentiment trends across multiple sources (URLs or texts). Compares and synthesizes sentiment. Pay per call (0.008 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: {
            oneOf: [
              { type: "string", format: "uri" },
              {
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                  label: { type: "string" },
                },
              },
            ],
          },
          description: "Array of URLs to analyze for sentiment",
        },
        texts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              label: { type: "string" },
            },
          },
          description: "Array of text contents to analyze for sentiment",
        },
        topic: { type: "string", description: "Optional topic context for analysis" },
      },
    },
  },
  {
    name: "competitor_intel",
    description: "Competitive intelligence analysis comparing two companies/entities. Searches web, extracts content, and provides structured comparison. Pay per call (0.025 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        company_a: { type: "string", description: "First company name" },
        company_b: { type: "string", description: "Second company name" },
        industry: { type: "string", description: "Optional industry context" },
        aspect: { type: "string", description: "Optional focus area (e.g., 'market share', 'innovation')" },
      },
      required: ["company_a", "company_b"],
    },
  },
  {
    name: "monitor_page",
    description: "Extract a page with a content hash for change detection. Use action 'watch' to register for ongoing monitoring. Pay per call (0.005 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri", description: "The URL to monitor" },
        action: {
          type: "string",
          enum: ["check", "watch"],
          default: "check",
          description: "'check' returns content + hash; 'watch' registers for ongoing change detection",
        },
        page_id: { type: "string", description: "Optional custom ID for the monitored page" },
      },
      required: ["url"],
    },
  },
  {
    name: "daily_brief",
    description: "Generate a briefing from multiple URLs or topics. Supports executive, bullet, and detailed formats. Pay per call (0.015 USDC) or use subscription.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: {
            oneOf: [
              { type: "string", format: "uri" },
              { type: "object", properties: { url: { type: "string", format: "uri" }, label: { type: "string" } } },
            ],
          },
          description: "Array of URLs to include in the brief",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "Array of topics to search and include in the brief",
        },
        format: {
          type: "string",
          enum: ["executive", "bullet", "detailed"],
          default: "executive",
          description: "Briefing format style",
        },
        focus: { type: "string", description: "Optional focus area for the briefing" },
      },
    },
  },
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,x-agenticmarket-secret,x-request-id,x-subscription-token",
};

async function callApi(path, body, subToken) {
  const headers = {
    "Content-Type": "application/json",
    "X-Paid-Request": "true",
  };
  if (subToken) headers["X-Subscription-Token"] = subToken;

  const resp = await fetch(BACKEND + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!resp.ok) throw new Error(JSON.stringify(data));
  return data;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function handleRequest(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Well-known MCP configuration
  if (url.pathname === "/.well-known/mcp") {
    return jsonResponse({
      mcpServers: {
        "content-intelligence-api": {
          url: url.origin + "/",
          description: SERVER_INFO.description,
          payment: SERVER_INFO.payment,
        },
      },
    });
  }

  // Serve discovery info
  if (request.method === "GET") {
    return jsonResponse({
      schemaVersion: 1,
      ...SERVER_INFO,
      tools: TOOLS.map((t) => t.name),
      _mcp: true,
    });
  }

  // POST — JSON-RPC 2.0 MCP
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const requests = Array.isArray(body) ? body : [body];
      const responses = [];

      // Check for subscription token in request headers
      const subToken = request.headers.get("X-Subscription-Token");

      for (const req of requests) {
        const id = req.id ?? null;
        const method = req.method;
        const params = req.params || {};

        switch (method) {
          case "tools/list":
            responses.push({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
            break;

          case "tools/call": {
            const { name, arguments: args } = params;
            if (!name) {
              responses.push({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } });
              break;
            }
            try {
              let result;
              switch (name) {
                case "extract_content":
                  result = await callApi("/v1/extract", { url: args.url }, subToken);
                  break;
                case "analyze_text":
                  result = await callApi("/v1/analyze", { text: args.text }, subToken);
                  break;
                case "research_topic":
                  result = await callApi("/v1/research", { query: args.query, depth: args.depth || "standard" }, subToken);
                  break;
                case "compare_articles":
                  result = await callApi("/v1/compare", { source_a: args.source_a, source_b: args.source_b, aspect: args.aspect }, subToken);
                  break;
                case "extract_structured":
                  result = await callApi("/v1/extract-structured", { url: args.url, schema: args.schema }, subToken);
                  break;
                case "sentiment_over_time":
                  result = await callApi("/v1/sentiment-over-time", { urls: args.urls, texts: args.texts, topic: args.topic }, subToken);
                  break;
                case "competitor_intel":
                  result = await callApi("/v1/competitor-intel", { company_a: args.company_a, company_b: args.company_b, industry: args.industry, aspect: args.aspect }, subToken);
                  break;
                case "monitor_page":
                  result = await callApi("/v1/monitor", { url: args.url, action: args.action || "check", page_id: args.page_id }, subToken);
                  break;
                case "daily_brief":
                  result = await callApi("/v1/brief", { urls: args.urls, topics: args.topics, format: args.format || "executive", focus: args.focus }, subToken);
                  break;
                default:
                  responses.push({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool: " + name } });
                  continue;
              }
              responses.push({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
            } catch (e) {
              responses.push({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
            }
            break;
          }

          case "initialize":
            responses.push({
              jsonrpc: "2.0",
              id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: SERVER_INFO,
              },
            });
            break;

          case "notifications/initialized":
            break;

          case "ping":
            responses.push({ jsonrpc: "2.0", id, result: {} });
            break;

          default:
            responses.push({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
        }
      }

      const filtered = responses.filter((r) => r !== undefined);
      const respBody = Array.isArray(body) ? filtered : filtered[0] || null;

      if (!respBody) return new Response(null, { status: 202, headers: CORS_HEADERS });

      return jsonResponse(respBody, respBody.error ? 500 : 200);
    } catch (e) {
      return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
  }

  return jsonResponse({ error: "Not found" }, 404);
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});
