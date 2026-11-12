# HelpPuff Commerce

Open-source AI Commerce Assistant for the PayPal AI Hackathon, built on Cloudflare Workers.

## Overview

HelpPuff Commerce is an AI-powered commerce assistant that combines:

- **AI Chatbot** — Powered by Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- **PayPal Sandbox Integration** — Order creation (CAPTURE flow), checkout, invoice generation, and payment verification
- **Approval Workflow** — All financial actions require explicit user approval before execution
- **Knowledge Base** — Store articles and FAQs for the AI assistant to reference
- **Dashboard** — Track orders, invoices, revenue, pending approvals, and audit logs
- **Embeddable Visitor Widget** — Customer-facing chat widget for any website
- **Security** — Merchant authentication, rate limiting, audit logs, webhook verification

Inspired by [HelpPuff](https://github.com/knowtific/helppuff) and PayPal agent-commerce patterns. This repository implements its own application code; it is not an upstream HelpPuff fork or a direct use of the PayPal Agent Toolkit.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Cloudflare Worker              │
│  ┌─────────────────────────────────────────────┐ │
│  │          Durable Object (class App)         │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐ │ │
│  │  │ AI Chat  │  │ PayPal   │  │ Knowledge│ │ │
│  │  │ (Workers │  │ API      │  │ Base     │ │ │
│  │  │  AI)     │  │ (Sandbox)│  │ (SQLite) │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘ │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐ │ │
│  │  │ Orders   │  │ Invoices │  │ Audit    │ │ │
│  │  │ (SQLite) │  │ (SQLite) │  │ Logs     │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘ │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │           Static Assets (public/)           │ │
│  │  HTML + CSS + JS (no build step required)   │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Worker default handler → Durable Object** — The Worker entry point (`src/worker.ts`) exports a default `fetch` handler routing `/api/*` requests to the `App` Durable Object via the `APP` binding. The Worker serves static assets using the `ASSETS` binding.
- **SQLite-backed Durable Object** — The `App` DO uses SQLite storage with a `new_sqlite_classes` migration in `wrangler.prod.json`. Both Wrangler configurations declare the same bindings. A local preview uses these standard Cloudflare bindings.
- **Workers AI binding** — Both dev and prod configs declare `"ai": { "binding": "AI" }`. The DO calls `this.env.AI.run()` for inference.
- **No build step** — Frontend is plain HTML/CSS/JS, no JSX or bundler needed
- **PayPal Sandbox** — All transactions use PayPal's sandbox environment for safe testing
- **Secrets in Cloudflare** — PayPal credentials stored as Worker secrets, never in source code
- **CAPTURE Flow** — Orders use `intent: "CAPTURE"` with `/v2/checkout/orders/{id}/capture`

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A [Cloudflare account](https://dash.cloudflare.com/)
- A [PayPal Developer account](https://developer.paypal.com/) with Sandbox credentials

### Installation

```bash
git clone https://github.com/Qera-AI-Labs/helppuff-commerce-ai.git
cd helppuff-commerce
npm install
```

### Configure Secrets

Get your Sandbox API credentials from the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox):

```bash
wrangler secret put PAYPAL_CLIENT_ID --config wrangler.json      # Sandbox client ID
wrangler secret put PAYPAL_CLIENT_SECRET --config wrangler.json   # Sandbox client secret
wrangler secret put PAYPAL_WEBHOOK_ID --config wrangler.json      # Webhook ID for signature verification
wrangler secret put MERCHANT_TOKEN --config wrangler.json         # Token for merchant dashboard auth
```

For local development, create a `.dev.vars` file (see `.dev.vars.example`):

```
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
PAYPAL_WEBHOOK_ID=your_webhook_id
MERCHANT_TOKEN=your_secret_merchant_token
```

### Local Development

```bash
npm run dev
```

### Deploy

```bash
npm run deploy
```

The Wrangler config (`wrangler.prod.json`) includes:
- `APP` Durable Object binding (class `App`)
- SQLite migration (`new_sqlite_classes: ["App"]`)
- `AI` Workers AI binding
- `ASSETS` static asset binding

Deployment is handled through Cloudflare's GitHub integration. Connect your repository in the Cloudflare dashboard (Workers & Pages → Create → Connect to Git) and push to `main` to trigger production deployment. No GitHub Actions CI workflow is needed.

## Usage

### AI Assistant (Merchant)

1. Navigate to the **AI Assistant** tab
2. Ask the assistant to create an order or invoice (e.g., "Create a $29.99 order for Premium subscription for customer@example.com")
3. The AI collects all required information and proposes an action
4. The proposal appears in **Approvals** as a pending item
5. Review the details and click **Approve & Execute** to run the PayPal API call
6. The order is created in PayPal Sandbox with an approve URL for the buyer
7. Check the result in **Orders** or **Invoices**
8. Use **Verify** to check PayPal status, and **Capture** to capture approved payments

### Visitor Chat Widget

Embed the customer-facing chat widget on any website:

```html
<script src="https://your-worker.workers.dev/widget.js"></script>
```

The widget connects to the knowledge base and provides AI-powered customer support. It cannot process payments or access merchant data.

### Knowledge Base

Add articles, FAQs, and documentation that the AI assistant references when answering questions from both merchants and visitors.

### Payment Verification

Use the refresh button on any order or invoice to verify its current PayPal Sandbox status.

### Audit Logs

All financial actions, approvals, and security events are logged with timestamps and IP addresses.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | — | Merchant login |
| `GET` | `/api/auth/status` | — | Check auth requirements |
| `POST` | `/api/chat` | Merchant | Send a message to the AI assistant |
| `GET` | `/api/chat/history` | Merchant | Retrieve chat history |
| `DELETE` | `/api/chat/history` | Merchant | Clear chat history |
| `POST` | `/api/visitor/chat` | — | Visitor chat (public) |
| `GET` | `/api/dashboard` | Merchant | Dashboard statistics |
| `GET` | `/api/orders` | Merchant | List all orders |
| `GET` | `/api/orders/:id/verify` | Merchant | Verify PayPal order status |
| `GET` | `/api/invoices` | Merchant | List all invoices |
| `GET` | `/api/invoices/:id/verify` | Merchant | Verify PayPal invoice status |
| `GET` | `/api/approvals` | Merchant | List all approvals |
| `POST` | `/api/approvals` | Merchant | Create a pending approval |
| `POST` | `/api/approvals/:id/approve` | Merchant | Approve and execute a pending action |
| `POST` | `/api/approvals/:id/reject` | Merchant | Reject a pending action |
| `GET` | `/api/knowledge` | Merchant | List knowledge base articles |
| `POST` | `/api/knowledge` | Merchant | Create a knowledge base article |
| `DELETE` | `/api/knowledge/:id` | Merchant | Delete a knowledge base article |
| `GET` | `/api/audit-logs` | Merchant | View audit logs |
| `GET` | `/api/paypal/status` | — | Check PayPal configuration status |
| `POST` | `/api/paypal/webhook` | — | PayPal webhook receiver |
| `GET` | `/api/health` | — | Health check |

## Testing

```bash
npm test
```

Tests cover:
- AI action proposal parsing and validation
- Email, amount, and currency validation
- Order and invoice payload validation
- PayPal CAPTURE flow endpoint correctness
- Webhook verification logic
- Idempotency key generation
- Approval workflow (pending → executed/rejected)
- Duplicate prevention logic
- Dashboard statistics calculation
- Status badge mapping
- Token caching logic

## Tech Stack

- **Runtime**: Cloudflare Workers (Durable Objects)
- **AI**: Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- **Payments**: PayPal Sandbox REST API v2 (CAPTURE flow)
- **Backend**: Cloudflare Workers (Durable Objects, native Request/Response)
- **Storage**: SQLite (via Durable Object storage)
- **Frontend**: Vanilla HTML/CSS/JS (no framework, no build step)
- **Testing**: Vitest

## Security

- PayPal credentials stored as [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) — never in source code
- Merchant dashboard protected by `MERCHANT_TOKEN` secret
- All financial actions require explicit approval
- Rate limiting: 30 requests/minute per IP
- Audit logs for all financial and security events
- PayPal webhook signature verification
- Input validation on all API endpoints
- Visitor chat is isolated from merchant data

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

## Acknowledgments

- [HelpPuff](https://github.com/knowtific/helppuff) — Original OSS foundation (MIT License)
- [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) — PayPal integration patterns
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) — AI inference platform

## OSS License Compliance

HelpPuff Commerce is inspired by the [HelpPuff](https://github.com/knowtific/helppuff) project (MIT License). No source code from HelpPuff is directly reused; the architecture and design patterns are reimplemented. The PayPal integration follows patterns from the [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit). All third-party dependencies retain their original licenses.

## Verification status (release candidate)

Source audit and static checks are **not** a substitute for a deployed integration test.
Before submitting, run `npm ci`, `npm run typecheck`, `npm test` and `npx wrangler deploy --dry-run --config wrangler.json`. Then configure the Worker secrets, deploy from `main` through Cloudflare and verify a Sandbox order, approval, buyer checkout and capture. Do not submit claims of a passed end-to-end test until the real transaction has completed.

The application is intentionally locked without `MERCHANT_TOKEN`. This is an application-specific secret you create in Cloudflare. Do not use a GitHub/Cloudflare/PayPal account token as its value.
