# Content Intelligence MCP Server

A **pay-per-call** MCP server for content intelligence — extract, analyze, research, and compare web content using AI. Powered by **freellmpool** (30+ free LLMs) with **x402** payment onchain (USDC on Base).

## Architecture

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────────┐
│   AI Agent   │────▶│  MCP Worker     │────▶│  Express API v2     │
│  (Claude,    │     │  (Cloudflare)   │     │  (AWS EC2)          │
│   Cursor,    │     │                  │     │                      │
│   etc.)      │◀────│  .well-known/mcp │◀────│  freellmpool (LLMs) │
└──────────────┘     └─────────────────┘     └──────────────────────┘
                           │
                      ┌────▼────┐
                      │  x402   │
                      │ Payment │
                      │ Gate    │
                      └─────────┘
```

## Tools

| Tool | Description | Price (USDC) |
|------|-------------|--------------|
| `extract_content` | Extract clean readable content from a URL. Removes ads, clutter, navigation. | 0.005 |
| `analyze_text` | Multi-faceted text analysis: summary, sentiment, entities, topics, classification, key points | 0.003 |
| `research_topic` | Multi-source research synthesis with web search, perspectives, timeline, recommendations | 0.02 |
| `compare_articles` | Side-by-side comparison of two articles/texts for similarities, differences, coverage, bias | 0.02 |

## Usage

### Connecting (any MCP client)

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "content-intelligence-api": {
      "url": "https://content-intelligence-mcp.wajih-hyder55.workers.dev"
    }
  }
}
```

### Example: Extract content

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "extract_content",
    "arguments": {
      "url": "https://example.com/article"
    }
  }
}
```

### Example: Compare two articles

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "compare_articles",
    "arguments": {
      "source_a": "https://example.com/article1",
      "source_b": "https://example.com/article2",
      "aspect": "general"
    }
  }
}
```

## Payment

This server uses **x402** — you pay per call in USDC on Base network.

- Wallet: `0x7003209BDDb2253B5Ba902211279a28fB7b39aD7`
- Network: Base (eip155:8453)
- Asset: USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)

The x402 gateway at `agent-gateway.wajih-hyder55.workers.dev` handles payment verification.

## Direct API (for developers)

If you prefer the raw REST API:

```
POST https://agent-gateway.wajih-hyder55.workers.dev/v1/extract
Content-Type: application/json
PAYMENT-SIGNATURE: <x402-payment-signature>

{"url": "https://example.com"}
```

## Self-Hosting

This project is designed to run on free tiers:

- **MCP Worker**: Cloudflare Workers (free tier)
- **x402 Gateway**: Cloudflare Workers (free tier)
- **Backend API**: AWS EC2 free tier
- **LLMs**: freellmpool (free tier, 30+ models)

### Deploy your own

1. Clone this repo
2. Deploy `src/worker-mcp.js` to Cloudflare Workers
3. Deploy `src/worker-gateway.js` as x402 payment gate
4. Set up the Express backend on any VM
5. Update the `BACKEND` URL in the Workers

## License

MIT
