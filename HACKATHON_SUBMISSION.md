# PayPal AI Hackathon 2026 — Submission Pack

**Project:** HelpPuff Commerce — AI Commerce Assistant  
**Source:** https://github.com/Qera-AI-Labs/helppuff-commerce-ai  
**Status:** Source implemented; Cloudflare deployment and live PayPal Sandbox tests must be verified before submission.  
**Licence:** MIT

## Devpost project description (draft)

HelpPuff Commerce is a Cloudflare-native AI commerce assistant that helps a small merchant move from a natural-language request to a proposed PayPal order or invoice. The merchant can review and approve a structured action before PayPal Sandbox executes it. The application includes a dashboard for orders, invoices, approvals and audit history, plus a knowledge-powered website visitor widget.

The merchant assistant uses Cloudflare Workers AI to interpret requests and produce structured proposals. A Worker and SQLite-backed Durable Object manage routing, state, approvals and PayPal API calls. PayPal Sandbox Orders v2 and Invoicing APIs provide the commerce operations. No real-money payment is used in the demo.

The distinctive workflow is **conversation → structured proposal → explicit human approval → PayPal Sandbox action → verified result**, with safeguards against duplicate financial actions.

**AI tools used:** T-REX AI for initial coding/iterations; ChatGPT for audit and targeted source repairs; Cloudflare Workers AI for application inference. List any other tools actually used and state their roles accurately.

## Demo video script (aim for 2:20–2:45, under 3 minutes)

- **0:00–0:20:** Show title, explain the challenge for merchants: turning chat requests into safe payment actions.
- **0:20–0:45:** Show Cloudflare-hosted merchant dashboard, AI Assistant and knowledge base.
- **0:45–1:15:** Ask AI to create a USD Sandbox order. Show captured details and the generated pending action.
- **1:15–1:35:** Review the proposed amount/recipient and explicitly approve it.
- **1:35–2:10:** Open the *actual* PayPal Sandbox buyer checkout link; complete buyer approval and return to app.
- **2:10–2:30:** Perform approved capture and verify the payment status against PayPal; show the order in the dashboard.
- **2:30–2:45:** Show GitHub code and architecture, with a brief closing.

**Do not describe unverified steps as demonstrated.** If the live Sandbox sequence does not work, fix it or clearly disclose the limitation.

## Final release checklist

- [ ] Cloudflare deployment succeeds using `wrangler.prod.json`.
- [ ] Secret `MERCHANT_TOKEN` configured in Cloudflare.
- [ ] `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are *Sandbox* values.
- [ ] Worker `AI` and Durable Object `APP` bindings present.
- [ ] `GET /api/health` returns success and expected binding/configuration flags.
- [ ] Merchant sign-in works; unauthenticated merchant API fails closed.
- [ ] Workers AI returns a genuine response; AI action proposal appears.
- [ ] Merchant approves and Sandbox creates order; checkout URL is real.
- [ ] Sandbox buyer approval and capture succeed; stored status is verified.
- [ ] Invoice action can be tested in Sandbox if included in the demo.
- [ ] Public GitHub source/licence visible, with no committed secrets.
- [ ] YouTube video is public and under 3 minutes.
- [ ] Devpost submission includes project description, code, video, and functional live URL or reproducible instructions.

## Deployment notes

Cloudflare Workers Builds can connect directly to the `main` branch. Configure the build/install command using the platform UI and use **`npx wrangler deploy --config wrangler.prod.json`** as the deploy command. This project does **not** need GitHub Actions.

Create only a separate Cloudflare Worker for this Qera-AI-Labs project. Use the Cloudflare dashboard's secure Variables and Secrets UI; **never paste secret values into GitHub**. Register the PayPal webhook only after the Worker URL is known, then set `PAYPAL_WEBHOOK_ID` and enable relevant PayPal Sandbox webhook events.

Deployment/testing must occur before claiming a completed live product.
