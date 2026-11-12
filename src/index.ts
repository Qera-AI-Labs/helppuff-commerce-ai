import { DurableObject } from "cloudflare:workers";
import { Env, SYSTEM_PROMPT, AI_MODEL, ChatMessage, buildVisitorPrompt } from "./types";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
import {
  getPayPalAccessToken,
  createPayPalOrder,
  capturePayPalOrder,
  getPayPalOrderStatus,
  createPayPalInvoice,
  getPayPalInvoiceStatus,
  verifyWebhookSignature,
} from "./paypal";
import { parseActionProposal, generateIdempotencyKey } from "./ai-parser";
import {
  validateOrderInput,
  validateInvoiceInput,
  validateActionProposal,
  sanitizeString,
} from "./validation";

function checkMerchantAuth(env: Env, request: Request): boolean {
  if (!env.MERCHANT_TOKEN) return false;
  const auth = request.headers.get("Authorization") || "";
  const cookieMatch = request.headers.get("Cookie")?.match(/merchant_token=([^;]+)/);
  const token = auth.replace("Bearer ", "") || cookieMatch?.[1] || "";
  return token === env.MERCHANT_TOKEN;
}

function jsonResponse(data: unknown, status: number = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

/** The public, unauthenticated widget does not send merchant credentials. */
function publicCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

export class App extends DurableObject<Env> {
  private dbInitialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private initDB() {
    if (this.dbInitialized) return;
    this.dbInitialized = true;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS knowledge (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT DEFAULT '', created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000))`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, paypal_order_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', amount TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', description TEXT NOT NULL, customer_email TEXT NOT NULL, approve_url TEXT NOT NULL, captured INTEGER NOT NULL DEFAULT 0, capture_id TEXT, idempotency_key TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000))`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, paypal_invoice_id TEXT NOT NULL, invoice_number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'SENT', amount TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', recipient_email TEXT NOT NULL, recipient_name TEXT NOT NULL, items TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000))`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, action_type TEXT NOT NULL, description TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', idempotency_key TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), resolved_at INTEGER)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS chat_history (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, session_id TEXT NOT NULL DEFAULT 'merchant', created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000))`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS visitor_chats (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000))`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, details TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000))`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rate_limits (ip TEXT NOT NULL, ts INTEGER NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000))`);
  }

  private auditLog(action: string, details: string, ip: string) {
    this.ctx.storage.sql.exec(`INSERT INTO audit_logs (action, details, ip) VALUES (?, ?, ?)`, action, details, ip);
  }

  private rateLimit(ip: string): boolean {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec(`SELECT ts FROM rate_limits WHERE ip = ? AND ts > ?`, ip, now - RATE_LIMIT_WINDOW_MS).toArray();
    if (rows.length >= RATE_LIMIT_MAX) return false;
    this.ctx.storage.sql.exec(`INSERT INTO rate_limits (ip, ts) VALUES (?, ?)`, ip, now);
    this.ctx.storage.sql.exec(`DELETE FROM rate_limits WHERE ts < ?`, now - RATE_LIMIT_WINDOW_MS * 2);
    return true;
  }

  private getClientIP(request: Request): string {
    return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  }

  async fetch(request: Request): Promise<Response> {
    try {
      this.initDB();
      const url = new URL(request.url);
      const path = url.pathname;

      if (path.startsWith("/api/")) return this.handleApi(path, request, url);

      if (this.env.ASSETS) {
        return this.env.ASSETS.fetch(request);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Internal server error";
      return jsonResponse({ error: msg }, 500);
    }
  }

  private async handleApi(path: string, request: Request, url: URL): Promise<Response> {
    const method = request.method;
    const ip = this.getClientIP(request);

    if (method === "OPTIONS" && path === "/api/visitor/chat") {
      return new Response(null, { status: 204, headers: publicCorsHeaders() });
    }
    if (method === "OPTIONS") return new Response(null, { status: 204 });

    if (path === "/api/health") return jsonResponse({
      status: "ok",
      timestamp: Date.now(),
      bindings: {
        ai: !!this.env.AI,
        assets: !!this.env.ASSETS,
        paypal: !!(this.env.PAYPAL_CLIENT_ID && this.env.PAYPAL_CLIENT_SECRET),
        merchantToken: !!this.env.MERCHANT_TOKEN,
      },
    });

    if (path === "/api/auth/login" && method === "POST") {
      if (!this.env.MERCHANT_TOKEN) return jsonResponse({ error: "Authentication not configured. Set MERCHANT_TOKEN secret." }, 503);
      const { token } = await request.json() as { token: string };
      if (token === this.env.MERCHANT_TOKEN) return jsonResponse({ authenticated: true });
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    if (path === "/api/auth/status" && method === "GET") {
      const needsAuth = !!this.env.MERCHANT_TOKEN;
      if (!needsAuth) {
        return jsonResponse({
          needsAuth: false,
          authenticated: false,
          error: "MERCHANT_TOKEN is not set. Dashboard access is blocked until it is configured as a Cloudflare secret.",
        });
      }
      const authenticated = checkMerchantAuth(this.env, request);
      return jsonResponse({ needsAuth, authenticated });
    }

    if (path === "/api/paypal/status" && method === "GET") {
      return jsonResponse({ configured: !!(this.env.PAYPAL_CLIENT_ID && this.env.PAYPAL_CLIENT_SECRET), mode: "sandbox" });
    }

    if (path === "/api/paypal/webhook" && method === "POST") {
      return this.handleWebhook(request, ip);
    }

    if (path === "/api/visitor/chat" && method === "POST") {
      return this.handleVisitorChat(request, ip);
    }

    if (!checkMerchantAuth(this.env, request)) return jsonResponse({ error: "Unauthorized" }, 401);

    if (path === "/api/chat" && method === "POST") return this.handleChat(request, ip);
    if (path === "/api/chat/history" && method === "GET") return this.handleChatHistory();
    if (path === "/api/chat/history" && method === "DELETE") return this.handleClearChat();
    if (path === "/api/knowledge" && method === "GET") return this.handleListKnowledge();
    if (path === "/api/knowledge" && method === "POST") return this.handleCreateKnowledge(request, ip);
    if (path.startsWith("/api/knowledge/") && method === "DELETE") return this.handleDeleteKnowledge(path, ip);
    if (path === "/api/approvals" && method === "GET") return this.handleListApprovals();
    if (path === "/api/approvals" && method === "POST") return this.handleCreateApproval(request, ip);
    if (path.match(/^\/api\/approvals\/\d+\/approve$/) && method === "POST") return this.handleApprove(path, request, ip);
    if (path.match(/^\/api\/approvals\/\d+\/reject$/) && method === "POST") return this.handleReject(path, ip);
    if (path === "/api/orders" && method === "GET") return this.handleListOrders();
    if (path.match(/^\/api\/orders\/\d+\/verify$/) && method === "GET") return this.handleVerifyOrder(path);
    if (path === "/api/invoices" && method === "GET") return this.handleListInvoices();
    if (path.match(/^\/api\/invoices\/\d+\/verify$/) && method === "GET") return this.handleVerifyInvoice(path);
    if (path === "/api/dashboard" && method === "GET") return this.handleDashboard();
    if (path === "/api/audit-logs" && method === "GET") return this.handleAuditLogs();

    return jsonResponse({ error: "Not found" }, 404);
  }

  private async handleChat(request: Request, ip: string): Promise<Response> {
    if (!this.rateLimit(ip)) return jsonResponse({ error: "Rate limit exceeded" }, 429);
    const { message } = await request.json() as { message: string };
    if (!message || message.trim().length === 0) return jsonResponse({ error: "Message is required" }, 400);
    const sanitized = sanitizeString(message, 4000);

    this.ctx.storage.sql.exec(`INSERT INTO chat_history (role, content, session_id) VALUES (?, ?, ?)`, "user", sanitized, "merchant");

    const historyRows = this.ctx.storage.sql.exec(`SELECT role, content FROM chat_history WHERE session_id = 'merchant' ORDER BY id DESC LIMIT 10`).toArray().reverse();
    const knowledgeRows = this.ctx.storage.sql.exec(`SELECT title, body FROM knowledge ORDER BY id DESC LIMIT 20`).toArray();
    const knowledgeContext = knowledgeRows.length > 0 ? "\n\nKnowledge Base Articles:\n" + knowledgeRows.map((r) => `### ${r.title}\n${r.body}`).join("\n\n") : "";

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT + knowledgeContext },
      ...historyRows.map((r) => ({ role: r.role as string, content: r.content as string })),
    ];

    try {
      if (!this.env.AI) {
        return jsonResponse({ error: "Workers AI binding not configured" }, 503);
      }
      const result = await this.env.AI!.run(AI_MODEL, { messages, max_tokens: 1024 });
      let responseText = (result as any).response || (result as any).content || "";
      const { cleanResponse, proposal } = parseActionProposal(responseText);
      responseText = cleanResponse;

      let newApprovalId: number | null = null;
      if (proposal) {
        const validation = validateActionProposal(proposal);
        if (validation.valid && validation.data) {
          const existing = this.ctx.storage.sql.exec(`SELECT id FROM approvals WHERE action_type = ? AND payload = ? AND status = 'pending'`, validation.data.action_type, JSON.stringify(validation.data.payload)).toArray();
          if (existing.length === 0) {
            this.ctx.storage.sql.exec(`INSERT INTO approvals (action_type, description, payload, status, idempotency_key) VALUES (?, ?, ?, 'pending', ?)`, validation.data.action_type, validation.data.description, JSON.stringify(validation.data.payload), generateIdempotencyKey());
            newApprovalId = this.ctx.storage.sql.exec(`SELECT last_insert_rowid() as id`).one().id as number;
            this.auditLog("approval_created", `Action: ${validation.data.action_type}, Desc: ${validation.data.description}`, ip);
          }
        }
      }

      this.ctx.storage.sql.exec(`INSERT INTO chat_history (role, content, session_id) VALUES (?, ?, ?)`, "assistant", responseText, "merchant");
      const pendingApprovals = this.ctx.storage.sql.exec(`SELECT id, action_type, description FROM approvals WHERE status = 'pending' ORDER BY id DESC LIMIT 10`).toArray();

      return jsonResponse({
        response: responseText,
        newApprovalId,
        pendingApprovals: pendingApprovals.map((r) => ({ id: r.id as number, actionType: r.action_type as string, description: r.description as string })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "AI inference failed";
      this.auditLog("ai_error", msg, ip);
      return jsonResponse({ error: "AI inference failed", details: msg }, 503);
    }
  }

  private handleChatHistory(): Response {
    const rows = this.ctx.storage.sql.exec(`SELECT id, role, content, created_at FROM chat_history WHERE session_id = 'merchant' ORDER BY id ASC LIMIT 100`).toArray();
    return jsonResponse(rows);
  }

  private handleClearChat(): Response {
    this.ctx.storage.sql.exec(`DELETE FROM chat_history WHERE session_id = 'merchant'`);
    return jsonResponse({ ok: true });
  }

  private async handleVisitorChat(request: Request, ip: string): Promise<Response> {
    if (!this.rateLimit(ip)) return jsonResponse({ error: "Rate limit exceeded" }, 429, publicCorsHeaders());
    const { message, sessionId } = await request.json() as { message: string; sessionId: string };
    if (!message || message.trim().length === 0) return jsonResponse({ error: "Message is required" }, 400, publicCorsHeaders());
    if (!sessionId) return jsonResponse({ error: "sessionId is required" }, 400, publicCorsHeaders());
    const sanitized = sanitizeString(message, 2000);
    const safeSessionId = sanitizeString(sessionId, 100);

    this.ctx.storage.sql.exec(`INSERT INTO visitor_chats (session_id, role, content) VALUES (?, ?, ?)`, safeSessionId, "user", sanitized);
    const historyRows = this.ctx.storage.sql.exec(`SELECT role, content FROM visitor_chats WHERE session_id = ? ORDER BY id DESC LIMIT 8`, safeSessionId).toArray().reverse();
    const knowledgeRows = this.ctx.storage.sql.exec(`SELECT title, body FROM knowledge ORDER BY id DESC LIMIT 20`).toArray();

    const messages: ChatMessage[] = [
      { role: "system", content: buildVisitorPrompt(knowledgeRows.map((r) => ({ title: r.title as string, body: r.body as string }))) },
      ...historyRows.map((r) => ({ role: r.role as string, content: r.content as string })),
    ];

    try {
      if (!this.env.AI) {
        return jsonResponse({ error: "Workers AI binding not configured" }, 503, publicCorsHeaders());
      }
          const result = await this.env.AI!.run(AI_MODEL, { messages, max_tokens: 512 });
      const responseText = (result as any).response || (result as any).content || "";
      this.ctx.storage.sql.exec(`INSERT INTO visitor_chats (session_id, role, content) VALUES (?, ?, ?)`, safeSessionId, "assistant", responseText);
      return jsonResponse({ response: responseText }, 200, publicCorsHeaders());
    } catch (error) {
      const msg = error instanceof Error ? error.message : "AI inference failed";
      return jsonResponse({ error: "AI inference failed", details: msg }, 503, publicCorsHeaders());
    }
  }

  private handleListKnowledge(): Response {
    const rows = this.ctx.storage.sql.exec(`SELECT id, title, body, tags, created_at FROM knowledge ORDER BY id DESC`).toArray();
    return jsonResponse(rows);
  }

  private async handleCreateKnowledge(request: Request, ip: string): Promise<Response> {
    const { title, body, tags } = await request.json() as { title: string; body: string; tags?: string };
    if (!title || !body) return jsonResponse({ error: "Title and body are required" }, 400);
    this.ctx.storage.sql.exec(`INSERT INTO knowledge (title, body, tags) VALUES (?, ?, ?)`, sanitizeString(title, 200), sanitizeString(body, 10000), sanitizeString(tags || "", 200));
    this.auditLog("knowledge_created", title, ip);
    return jsonResponse({ ok: true });
  }

  private handleDeleteKnowledge(path: string, ip: string): Response {
    const id = path.split("/")[3];
    this.ctx.storage.sql.exec(`DELETE FROM knowledge WHERE id = ?`, id);
    this.auditLog("knowledge_deleted", `ID: ${id}`, ip);
    return jsonResponse({ ok: true });
  }

  private handleListApprovals(): Response {
    const rows = this.ctx.storage.sql.exec(`SELECT id, action_type, description, payload, status, created_at, resolved_at FROM approvals ORDER BY id DESC`).toArray();
    return jsonResponse(rows);
  }

  private async handleCreateApproval(request: Request, ip: string): Promise<Response> {
    const { action_type, description, payload } = await request.json() as { action_type: string; description: string; payload: string };
    if (!action_type || !description || !payload) return jsonResponse({ error: "action_type, description, and payload are required" }, 400);
    let parsedPayload: unknown;
    try { parsedPayload = typeof payload === "string" ? JSON.parse(payload) : payload; }
    catch { return jsonResponse({ error: "Invalid approval payload" }, 400); }
    const validation = validateActionProposal({ action_type, description, payload: parsedPayload });
    if (!validation.valid || !validation.data) return jsonResponse({ error: validation.errors.join(", ") }, 400);
    this.ctx.storage.sql.exec(`INSERT INTO approvals (action_type, description, payload, status, idempotency_key) VALUES (?, ?, ?, 'pending', ?)`, validation.data.action_type, validation.data.description, JSON.stringify(validation.data.payload), generateIdempotencyKey());
    const id = this.ctx.storage.sql.exec(`SELECT last_insert_rowid() as id`).one().id as number;
    this.auditLog("approval_created_manual", `Action: ${action_type}`, ip);
    return jsonResponse({ id, ok: true });
  }

  private async handleApprove(path: string, request: Request, ip: string): Promise<Response> {
    const id = path.split("/")[3];
    const row = this.ctx.storage.sql.exec(`SELECT id, action_type, description, payload, status, idempotency_key FROM approvals WHERE id = ?`, id).toArray();
    if (row.length === 0) return jsonResponse({ error: "Approval not found" }, 404);
    const approvalRow = row[0];
    if (approvalRow.status !== "pending") return jsonResponse({ error: "Approval already resolved or in progress" }, 400);

    this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'executing' WHERE id = ? AND status = 'pending'`, id);
    // Check SQLite's affected-row count, not the new status: a competing caller
    // could otherwise see 'executing' and perform the same payment operation.
    const claim = this.ctx.storage.sql.exec(`SELECT changes() AS affected`).one() as { affected: number };
    if (claim.affected !== 1) {
      return jsonResponse({ error: "Approval was already claimed by another request" }, 409);
    }

    const actionType = approvalRow.action_type as string;
    const payload = JSON.parse(approvalRow.payload as string);
    const idempotencyKey = approvalRow.idempotency_key as string | null;
    const requestUrl = request.url;

    try {
      let result: any;
      if (actionType === "create_order") {
        const validation = validateOrderInput(payload);
        if (!validation.valid) {
          this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'failed', resolved_at = ? WHERE id = ?`, Date.now(), id);
          return jsonResponse({ error: validation.errors.join(", ") }, 400);
        }
        result = await this.executeCreateOrder(validation.data!, idempotencyKey, requestUrl);
      } else if (actionType === "create_invoice") {
        const validation = validateInvoiceInput(payload);
        if (!validation.valid) {
          this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'failed', resolved_at = ? WHERE id = ?`, Date.now(), id);
          return jsonResponse({ error: validation.errors.join(", ") }, 400);
        }
        result = await this.executeCreateInvoice(validation.data!, idempotencyKey);
      } else if (actionType === "capture_order") {
        if (!payload.paypalOrderId) {
          this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'failed', resolved_at = ? WHERE id = ?`, Date.now(), id);
          return jsonResponse({ error: "paypalOrderId is required" }, 400);
        }
        result = await this.executeCaptureOrder(payload.paypalOrderId, idempotencyKey);
      } else {
        this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'failed', resolved_at = ? WHERE id = ?`, Date.now(), id);
        return jsonResponse({ error: `Unknown action type: ${actionType}` }, 400);
      }

      this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'executed', resolved_at = ? WHERE id = ?`, Date.now(), id);
      this.auditLog("approval_executed", `Action: ${actionType}, ID: ${id}`, ip);
      return jsonResponse({ ok: true, result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Execution failed";
      if (msg.includes("ETIMEDOUT") || msg.includes("timeout") || msg.includes("429") || msg.includes("503")) {
        this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'reconciliation_required', resolved_at = ? WHERE id = ?`, Date.now(), id);
        this.auditLog("approval_reconciliation", `Action: ${actionType}, ID: ${id}, Error: ${msg}`, ip);
        return jsonResponse({ error: `Execution uncertain — requires reconciliation: ${msg}`, status: "reconciliation_required" }, 502);
      }
      this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'failed', resolved_at = ? WHERE id = ?`, Date.now(), id);
      this.auditLog("approval_failed", `Action: ${actionType}, ID: ${id}, Error: ${msg}`, ip);
      return jsonResponse({ error: msg }, 500);
    }
  }

  private handleReject(path: string, ip: string): Response {
    const id = path.split("/")[3];
    this.ctx.storage.sql.exec(`UPDATE approvals SET status = 'rejected', resolved_at = ? WHERE id = ? AND status = 'pending'`, Date.now(), id);
    this.auditLog("approval_rejected", `ID: ${id}`, ip);
    return jsonResponse({ ok: true });
  }

  private handleListOrders(): Response {
    const rows = this.ctx.storage.sql.exec(`SELECT id, paypal_order_id, status, amount, currency, description, customer_email, approve_url, captured, capture_id, created_at FROM orders ORDER BY id DESC`).toArray();
    return jsonResponse(rows);
  }

  private async handleVerifyOrder(path: string): Promise<Response> {
    const localId = path.split("/")[3];
    const row = this.ctx.storage.sql.exec(`SELECT paypal_order_id FROM orders WHERE id = ?`, localId).toArray();
    if (row.length === 0) return jsonResponse({ error: "Order not found" }, 404);
    const paypalOrderId = row[0].paypal_order_id as string;
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) return jsonResponse({ error: "PayPal credentials not configured" }, 500);
    try {
      const token = await getPayPalAccessToken(this.env.PAYPAL_CLIENT_ID, this.env.PAYPAL_CLIENT_SECRET);
      const status = await getPayPalOrderStatus(token, paypalOrderId);
      this.ctx.storage.sql.exec(`UPDATE orders SET status = ?, captured = ? WHERE id = ?`, status.status, status.status === "COMPLETED" ? 1 : 0, localId);
      this.auditLog("order_verified", `PayPal ID: ${paypalOrderId}, Status: ${status.status}`, "");
      return jsonResponse({ ok: true, paypalOrderId, status: status.status });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "PayPal verification failed";
      return jsonResponse({ error: msg }, 502);
    }
  }

  private handleListInvoices(): Response {
    const rows = this.ctx.storage.sql.exec(`SELECT id, paypal_invoice_id, invoice_number, status, amount, currency, recipient_email, recipient_name, items, created_at FROM invoices ORDER BY id DESC`).toArray();
    return jsonResponse(rows);
  }

  private async handleVerifyInvoice(path: string): Promise<Response> {
    const localId = path.split("/")[3];
    const row = this.ctx.storage.sql.exec(`SELECT paypal_invoice_id FROM invoices WHERE id = ?`, localId).toArray();
    if (row.length === 0) return jsonResponse({ error: "Invoice not found" }, 404);
    const paypalInvoiceId = row[0].paypal_invoice_id as string;
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) return jsonResponse({ error: "PayPal credentials not configured" }, 500);
    try {
      const token = await getPayPalAccessToken(this.env.PAYPAL_CLIENT_ID, this.env.PAYPAL_CLIENT_SECRET);
      const status = await getPayPalInvoiceStatus(token, paypalInvoiceId);
      this.ctx.storage.sql.exec(`UPDATE invoices SET status = ? WHERE id = ?`, status.status, localId);
      this.auditLog("invoice_verified", `PayPal ID: ${paypalInvoiceId}, Status: ${status.status}`, "");
      return jsonResponse({ ok: true, paypalInvoiceId, status: status.status });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "PayPal verification failed";
      return jsonResponse({ error: msg }, 502);
    }
  }

  private handleDashboard(): Response {
    const orderCount = this.ctx.storage.sql.exec(`SELECT COUNT(*) as c FROM orders`).one().c as number;
    const invoiceCount = this.ctx.storage.sql.exec(`SELECT COUNT(*) as c FROM invoices`).one().c as number;
    const knowledgeCount = this.ctx.storage.sql.exec(`SELECT COUNT(*) as c FROM knowledge`).one().c as number;
    const pendingApprovals = this.ctx.storage.sql.exec(`SELECT COUNT(*) as c FROM approvals WHERE status = 'pending'`).one().c as number;
    const capturedOrders = this.ctx.storage.sql.exec(`SELECT COUNT(*) as c FROM orders WHERE captured = 1`).one().c as number;
    const totalRevenue = this.ctx.storage.sql.exec(`SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total FROM orders WHERE captured = 1`).one().total as number;
    return jsonResponse({ orders: orderCount, invoices: invoiceCount, knowledge: knowledgeCount, pendingApprovals, capturedOrders, totalRevenue: totalRevenue.toFixed(2) });
  }

  private handleAuditLogs(): Response {
    const rows = this.ctx.storage.sql.exec(`SELECT id, action, details, ip, created_at FROM audit_logs ORDER BY id DESC LIMIT 100`).toArray();
    return jsonResponse(rows);
  }

  private async handleWebhook(request: Request, ip: string): Promise<Response> {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) return jsonResponse({ error: "PayPal not configured" }, 500);
    if (!this.env.PAYPAL_WEBHOOK_ID) return jsonResponse({ error: "Webhook verification not configured" }, 500);
    const rawBody = await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    try {
      const token = await getPayPalAccessToken(this.env.PAYPAL_CLIENT_ID, this.env.PAYPAL_CLIENT_SECRET);
      const verified = await verifyWebhookSignature(token, this.env.PAYPAL_WEBHOOK_ID, headers, rawBody);
      if (!verified) { this.auditLog("webhook_rejected", "Signature verification failed", ip); return jsonResponse({ error: "Webhook verification failed" }, 401); }
      const event = JSON.parse(rawBody) as { id: string; event_type: string; resource: { id: string; status?: string; supplementary_data?: { related_ids?: { order_id?: string } }; order_id?: string } };
      const existingEvent = this.ctx.storage.sql.exec(`SELECT id FROM webhook_events WHERE id = ?`, event.id).toArray();
      if (existingEvent.length > 0) {
        return jsonResponse({ ok: true, message: "Event already processed" });
      }

      if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
        const orderId = event.resource.id;
        this.ctx.storage.sql.exec(`UPDATE orders SET status = ? WHERE paypal_order_id = ?`, event.resource.status || "APPROVED", orderId);
        this.auditLog("webhook_order_update", `Order: ${orderId}, Status: ${event.resource.status}`, ip);
      } else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        const captureId = event.resource.id;
        const resource = event.resource as any;
        const orderId = resource?.supplementary_data?.related_ids?.order_id || resource?.order_id || "";
        if (orderId) {
          this.ctx.storage.sql.exec(`UPDATE orders SET status = 'COMPLETED', captured = 1, capture_id = ? WHERE paypal_order_id = ?`, captureId, orderId);
          this.auditLog("webhook_capture_completed", `Order: ${orderId}, Capture: ${captureId}, Status: COMPLETED`, ip);
        } else {
          this.auditLog("webhook_capture_no_order_id", `Capture: ${captureId} — could not map to order ID`, ip);
          return jsonResponse({ error: "Capture order ID unavailable; retry/reconcile event" }, 503);
        }
      } else if (event.event_type === "INVOICING.INVOICE.PAID") {
        const invoiceId = event.resource.id;
        this.ctx.storage.sql.exec(`UPDATE invoices SET status = 'PAID' WHERE paypal_invoice_id = ?`, invoiceId);
        this.auditLog("webhook_invoice_paid", `Invoice: ${invoiceId}`, ip);
      }

      this.ctx.storage.sql.exec(`INSERT INTO webhook_events (id, event_type) VALUES (?, ?)`, event.id, event.event_type);
      return jsonResponse({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Webhook processing failed";
      this.auditLog("webhook_error", msg, ip);
      return jsonResponse({ error: msg }, 500);
    }
  }

  private async executeCreateOrder(payload: { amount: string; currency: string; description: string; customerEmail: string; }, idempotencyKey?: string, requestUrl?: string): Promise<any> {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) throw new Error("PayPal credentials not configured");
    const token = await getPayPalAccessToken(this.env.PAYPAL_CLIENT_ID, this.env.PAYPAL_CLIENT_SECRET);
    let returnUrl: string | undefined;
    let cancelUrl: string | undefined;
    if (requestUrl) {
      try {
        const origin = new URL(requestUrl).origin;
        returnUrl = `${origin}/?page=orders`;
        cancelUrl = `${origin}/?page=orders&cancelled=1`;
      } catch {}
    }
    const result = await createPayPalOrder(token, payload, idempotencyKey || undefined, returnUrl, cancelUrl);
    this.ctx.storage.sql.exec(`INSERT INTO orders (paypal_order_id, status, amount, currency, description, customer_email, approve_url, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, result.id, result.status, payload.amount, payload.currency, payload.description, payload.customerEmail, result.approveUrl, idempotencyKey || null);
    return { orderId: result.id, status: result.status, approveUrl: result.approveUrl };
  }

  private async executeCreateInvoice(payload: { recipientName: string; recipientEmail: string; amount: string; currency: string; description: string; }, idempotencyKey?: string): Promise<any> {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) throw new Error("PayPal credentials not configured");
    const token = await getPayPalAccessToken(this.env.PAYPAL_CLIENT_ID, this.env.PAYPAL_CLIENT_SECRET);
    const invoiceNumber = `HP-${(idempotencyKey || generateIdempotencyKey()).replace(/[^a-zA-Z0-9]/g, "").slice(0, 26)}`;
    const result = await createPayPalInvoice(token, { recipientName: payload.recipientName, recipientEmail: payload.recipientEmail, amount: payload.amount, currency: payload.currency, description: payload.description, invoiceNumber }, idempotencyKey);
    this.ctx.storage.sql.exec(`INSERT INTO invoices (paypal_invoice_id, invoice_number, status, amount, currency, recipient_email, recipient_name, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, result.id, result.invoiceNumber, result.status, payload.amount, payload.currency, payload.recipientEmail, payload.recipientName, JSON.stringify([{ description: payload.description, amount: payload.amount }]));
    return { invoiceId: result.id, invoiceNumber: result.invoiceNumber, status: result.status };
  }

  private async executeCaptureOrder(paypalOrderId: string, idempotencyKey?: string): Promise<any> {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) throw new Error("PayPal credentials not configured");
    const existing = this.ctx.storage.sql.exec(`SELECT id, captured FROM orders WHERE paypal_order_id = ?`, paypalOrderId).toArray();
    if (existing.length > 0 && existing[0].captured === 1) {
      return { status: "COMPLETED", orderId: paypalOrderId, message: "Order already captured" };
    }
    const token = await getPayPalAccessToken(this.env.PAYPAL_CLIENT_ID, this.env.PAYPAL_CLIENT_SECRET);
    const result = await capturePayPalOrder(token, paypalOrderId, idempotencyKey || undefined);
    if (result.status !== "COMPLETED" && result.status !== "PENDING") {
      throw new Error(`Capture did not complete. PayPal status: ${result.status}`);
    }
    const isCompleted = result.status === "COMPLETED";
    this.ctx.storage.sql.exec(`UPDATE orders SET captured = ?, status = ?, capture_id = ? WHERE paypal_order_id = ?`, isCompleted ? 1 : 0, result.status, result.captureId || null, paypalOrderId);
    return { status: result.status, orderId: result.id, captureId: result.captureId };
  }
}


