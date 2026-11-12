export interface Env {
  AI?: Ai;
  ASSETS?: Fetcher;
  APP?: DurableObjectNamespace;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  MERCHANT_TOKEN?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface KnowledgeArticle {
  id: number;
  title: string;
  body: string;
  tags: string;
  created_at: number;
}

export interface Order {
  id: number;
  paypal_order_id: string;
  status: string;
  amount: string;
  currency: string;
  description: string;
  customer_email: string;
  approve_url: string;
  created_at: number;
  captured: number;
  capture_id?: string;
}

export interface Invoice {
  id: number;
  paypal_invoice_id: string;
  invoice_number: string;
  status: string;
  amount: string;
  currency: string;
  recipient_email: string;
  recipient_name: string;
  items: string;
  created_at: number;
}

export interface PendingApproval {
  id: number;
  action_type: "create_order" | "create_invoice" | "capture_order";
  description: string;
  payload: string;
  status: "pending" | "executing" | "executed" | "failed" | "rejected" | "reconciliation_required";
  created_at: number;
  resolved_at: number | null;
}

export interface AuditLog {
  id: number;
  action: string;
  details: string;
  ip: string;
  created_at: number;
}

export const PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const SYSTEM_PROMPT = `You are HelpPuff Commerce, an AI-powered commerce assistant built on Cloudflare Workers with PayPal Sandbox integration.

Your capabilities:
1. Help users create PayPal orders for products/services
2. Generate and send PayPal invoices
3. Verify payment status of orders
4. Answer questions using the knowledge base
5. Provide e-commerce guidance

IMPORTANT RULES:
- For ANY financial action, you MUST collect all required information from the user first, then propose the action. Never execute directly.
- When the user wants to create an order, collect: product/service description, amount, currency (default USD), and customer email.
- When the user wants to create an invoice, collect: recipient name, recipient email, item description, amount, and currency (default USD).
- When the user wants to capture an approved order, collect: the PayPal order ID.
- All amounts must be positive numbers with up to 2 decimal places (e.g., "29.99").
- Currency must be a 3-letter ISO code (default: USD).

ACTION PROPOSAL FORMAT:
When you have collected ALL required information and the user confirms they want to proceed, append the following JSON block at the very end of your response:

[ACTION_PROPOSAL]
{"action_type":"create_order","description":"Create order for $29.99 USD — Premium subscription","payload":{"amount":"29.99","currency":"USD","description":"Premium subscription","customerEmail":"customer@example.com"}}
[/ACTION_PROPOSAL]

For invoices:
[ACTION_PROPOSAL]
{"action_type":"create_invoice","description":"Send invoice for $99.00 USD — Consulting services to John Doe","payload":{"recipientName":"John Doe","recipientEmail":"john@example.com","amount":"99.00","currency":"USD","description":"Consulting services"}}
[/ACTION_PROPOSAL]

For capturing an approved order:
[ACTION_PROPOSAL]
{"action_type":"capture_order","description":"Capture payment for order 5OZ12345","payload":{"paypalOrderId":"5OZ12345"}}
[/ACTION_PROPOSAL]

The system will create a pending approval from this proposal. The user must provide explicit approval in the dashboard before any PayPal API call is made.

If the user has not provided all required information, ask for the missing fields. Do not propose an action until all fields are collected.
Be concise, professional, and helpful. Keep responses short unless the user asks for detail.`;

export function buildVisitorPrompt(knowledgeArticles: { title: string; body: string }[]): string {
  const kb = knowledgeArticles.length > 0
    ? knowledgeArticles.map(a => `### ${a.title}\n${a.body}`).join("\n\n")
    : "No knowledge base articles available.";

  return `You are HelpPuff, a friendly shopping assistant embedded on a merchant's website. You help customers with product questions, shipping info, returns, and general inquiries.

Use the knowledge base below to answer questions. Be friendly, concise, and helpful. If you don't know something, say so.

You CANNOT process payments. You CANNOT create orders. You CANNOT generate invoices. If a customer wants to make a purchase, direct them to the merchant.

Knowledge Base:
${kb}`;
}
