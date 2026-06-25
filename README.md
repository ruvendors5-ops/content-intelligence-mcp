# Content Intelligence MCP Server v2.1.0

A **pay-per-call** MCP server for content intelligence — extract, analyze, research, compare, monitor, and brief. Powered by **freellmpool** (30+ free LLMs) with **x402** payment (USDC on Base) or **subscription** plans.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│   AI Agent   │────▶│  Gateway Worker  │────▶│  Express API v2.1   │
│  (Claude,    │     │  (x402 + Subs)   │     │  (AWS EC2)          │
│   Cursor,    │     │                  │     │                      │
│   etc.)      │◀────│  MCP Worker      │◀────│  freellmpool (LLMs) │
└──────────────┘     └──────────────────┘     └──────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  x402 or    │
                    │  Subscribe  │
                    └─────────────┘
```

## Tools (9 Total)

| # | Tool | Description | Per-Call Price |
|---|------|-------------|----------------|
| 1 | `extract_content` | Extract clean readable content from a URL | 0.005 USDC |
| 2 | `analyze_text` | Multi-faceted analysis: summary, sentiment, entities, topics, classification | 0.003 USDC |
| 3 | `research_topic` | Multi-source research synthesis with web search, perspectives, timeline | 0.02 USDC |
| 4 | `compare_articles` | Side-by-side comparison: similarities, differences, coverage, bias | 0.01 USDC |
| 5 | `extract_structured` | Extract structured JSON from a URL (custom schema supported) | 0.008 USDC |
| 6 | `sentiment_over_time` | Sentiment trend analysis across multiple sources (URLs or text) | 0.008 USDC |
| 7 | `competitor_intel` | Competitive intelligence between two companies (web search + analysis) | 0.025 USDC |
| 8 | `monitor_page` | Page content extraction with SHA-256 hash for change detection | 0.005 USDC |
| 9 | `daily_brief` | Multi-source briefing in executive, bullet, or detailed format | 0.015 USDC |

## Subscription Plans

Instead of paying per call, subscribe for predictable pricing:

| Plan | Price | Calls | Effective Rate |
|------|-------|-------|----------------|
| Monthly | $5 USDC | 200 | $0.025/call |
| Yearly | $50 USDC | 3,000 | $0.017/call |

Use subscription via `X-Subscription-Token` header in requests.

## Payment

- **Network:** Base (eip155:8453)
- **Asset:** USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Wallet:** `0x7003209BDDb2253B5Ba902211279a28fB7b39aD7`
- **Scheme:** x402 (per-call) or Subscription (pre-paid)

## Quick Start for Agents

```json
{
  "mcpServers": {
    "content-intelligence-api": {
      "url": "https://content-intelligence-mcp.wajih-hyder55.workers.dev"
    }
  }
}
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/extract` | Extract content from URL |
| `POST /v1/analyze` | Analyze text |
| `POST /v1/research` | Research topic |
| `POST /v1/compare` | Compare two sources |
| `POST /v1/extract-structured` | Structured extraction |
| `POST /v1/sentiment-over-time` | Sentiment trends |
| `POST /v1/competitor-intel` | Competitive analysis |
| `POST /v1/monitor` | Page monitoring |
| `POST /v1/brief` | Generate briefing |
| `POST /v1/subscribe` | Create subscription ($5/$50) |
| `GET /v1/auth/pricing` | Get pricing info |
| `POST /v1/auth/validate` | Validate subscription token |
| `GET /health` | API health + version info |

## Deployment

- **Backend:** AWS EC2 (Ubuntu) with PM2, Node.js 22, freellmpool
- **Workers:** Cloudflare Workers (gateway + MCP)
- **Payment:** x402.org facilitator for on-chain verification

## License

MIT
