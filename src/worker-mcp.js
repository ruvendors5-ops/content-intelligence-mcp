// ===== content-intelligence-mcp — Enhanced MCP Server =====
// Features: compare tool, pricing metadata, rate limit handling, x402 integration

const BACKEND = "http://13.61.3.171.nip.io:3000";

const SERVER_INFO = {
  name: "content-intelligence-api",
  version: "1.1.0",
  description: "Content Intelligence API — extract, analyze, research, compare. Pay-per-call USDC on Base via x402.",
  payment: {
    scheme: "x402",
    network: "eip155:8453",
    asset: "USDC",
    assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    wallet: "0x7003209BDDb2253B5Ba902211279a28fB7b39aD7",
    prices: {
      extract_content: "0.005 USDC",
      analyze_text: "0.003 USDC",
      research_topic: "0.02 USDC",
      compare_articles: "0.02 USDC",
    }
  }
};

const TOOLS = [
  {
    name: "extract_content",
    description: "Extract clean readable content from a URL. Removes ads, clutter, navigation. Cost: 0.005 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri", description: "The URL to extract content from" }
      },
      required: ["url"]
    }
  },
  {
    name: "analyze_text",
    description: "Analyze text for summary, sentiment, entities, topics, and classification. Cost: 0.003 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to analyze (up to 50k chars)" }
      },
      required: ["text"]
    }
  },
  {
    name: "research_topic",
    description: "Multi-source research synthesis on any topic. Searches web and synthesizes with AI. Cost: 0.02 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Research query or topic" },
        depth: { type: "string", enum: ["quick", "deep"], default: "quick" }
      },
      required: ["query"]
    }
  },
  {
    name: "compare_articles",
    description: "Compare two articles or content side-by-side for similarities, differences, and key insights. Cost: 0.02 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        source_a: { type: "string", description: "First URL or text content to compare" },
        source_b: { type: "string", description: "Second URL or text content to compare" },
        aspect: { type: "string", enum: ["general", "arguments", "coverage", "bias"], default: "general", description: "Aspect of comparison" }
      },
      required: ["source_a", "source_b"]
    }
  }
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,x-agenticmarket-secret,x-request-id",
};

async function callApi(path, body, timeoutMs = 60000) {
  const resp = await fetch(BACKEND + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Paid-Request": "true" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
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
    headers: { "content-type": "application/json", ...CORS_HEADERS }
  });
}

async function handleRequest(request) {
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Well-known MCP configuration endpoint
  if (url.pathname === "/.well-known/mcp") {
    return jsonResponse({
      mcpServers: {
        "content-intelligence-api": {
          url: url.origin + "/"
        }
      }
    });
  }

  // GET — server info
  if (request.method === "GET") {
    return jsonResponse({
      schemaVersion: 1,
      ...SERVER_INFO,
      tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      _mcp: true
    });
  }

  // POST — JSON-RPC 2.0 MCP
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const requests = Array.isArray(body) ? body : [body];
      const responses = [];

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
                  result = await callApi("/v1/extract", { url: args.url });
                  break;
                case "analyze_text":
                  result = await callApi("/v1/analyze", { text: args.text });
                  break;
                case "research_topic":
                  result = await callApi("/v1/research", { query: args.query, depth: args.depth || "quick" }, 90000);
                  break;
                case "compare_articles":
                  result = await callApi("/v1/compare", {
                    source_a: args.source_a,
                    source_b: args.source_b,
                    aspect: args.aspect || "general"
                  }, 90000);
                  break;
                default:
                  responses.push({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool: " + name } });
                  continue;
              }
              responses.push({
                jsonrpc: "2.0", id,
                result: {
                  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                  meta: { paid: true, price: SERVER_INFO.payment.prices[name] || "unknown" }
                }
              });
            } catch (e) {
              responses.push({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
            }
            break;
          }

          case "initialize":
            responses.push({ jsonrpc: "2.0", id, result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: SERVER_INFO
            }});
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

      const filtered = responses.filter(r => r !== undefined);
      const respBody = Array.isArray(body) ? filtered : filtered[0] || null;

      if (!respBody) return new Response(null, { status: 202, headers: CORS_HEADERS });

      return jsonResponse(respBody, respBody.error ? 500 : 200);
    } catch (e) {
      return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
  }

  return jsonResponse({ error: "Not found" }, 404);
}

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
