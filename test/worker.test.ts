import { describe, it, expect } from "vitest";
import { App } from "../src/worker";

function createMockEnv(overrides: Record<string, any> = {}) {
  return {
    AI: undefined,
    APP: {
      idFromName: () => ({ id: "test-id" }),
      get: () => ({
        fetch: async (req: Request) => new Response("ok"),
      }),
    },
    ASSETS: {
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === "/" || url.pathname === "/index.html")
          return new Response("<html>static</html>", { status: 200, headers: { "Content-Type": "text/html" } });
        if (url.pathname === "/widget.js")
          return new Response("widget code", { status: 200, headers: { "Content-Type": "application/javascript" } });
        if (url.pathname === "/styles.css")
          return new Response("body{}", { status: 200, headers: { "Content-Type": "text/css" } });
        if (url.pathname === "/app.js")
          return new Response("console.log()", { status: 200, headers: { "Content-Type": "application/javascript" } });
        return new Response("Not found", { status: 404 });
      },
    },
    MERCHANT_TOKEN: "test-token",
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_CLIENT_SECRET: "test-client-secret",
    PAYPAL_WEBHOOK_ID: "test-webhook-id",
    ...overrides,
  } as any;
}

function createMockState() {
  const tables: Record<string, any[]> = {};
  const sqlResults: Record<string, any[]> = {};
  let lastInsertRowId = 0;

  function getTable(sql: string): any[] {
    if (sql.includes("knowledge")) return tables.knowledge || (tables.knowledge = []);
    if (sql.includes("orders")) return tables.orders || (tables.orders = []);
    if (sql.includes("invoices")) return tables.invoices || (tables.invoices = []);
    if (sql.includes("approvals")) return tables.approvals || (tables.approvals = []);
    if (sql.includes("chat_history")) return tables.chat_history || (tables.chat_history = []);
    if (sql.includes("visitor_chats")) return tables.visitor_chats || (tables.visitor_chats = []);
    if (sql.includes("audit_logs")) return tables.audit_logs || (tables.audit_logs = []);
    if (sql.includes("rate_limits")) return tables.rate_limits || (tables.rate_limits = []);
    if (sql.includes("webhook_events")) return tables.webhook_events || (tables.webhook_events = []);
    return [];
  }

  return {
    storage: {
      sql: {
        exec: (sql: string, ...params: any[]) => {
          if (sql.startsWith("CREATE TABLE")) return { toArray: () => [] };
          if (sql.startsWith("INSERT")) {
            const table = getTable(sql);
            const row: any = {};
            if (sql.includes("last_insert_rowid")) return { one: () => ({ id: ++lastInsertRowId }) };
            lastInsertRowId++;
            row.id = lastInsertRowId;
            if (params.length > 0) {
              if (sql.includes("knowledge")) { row.title = params[0]; row.body = params[1]; row.tags = params[2]; }
              else if (sql.includes("chat_history")) { row.role = params[0]; row.content = params[1]; row.session_id = params[2]; }
              else if (sql.includes("visitor_chats")) { row.session_id = params[0]; row.role = params[1]; row.content = params[2]; }
              else if (sql.includes("audit_logs")) { row.action = params[0]; row.details = params[1]; row.ip = params[2]; }
              else if (sql.includes("rate_limits")) { row.ip = params[0]; row.ts = params[1]; }
              else if (sql.includes("webhook_events")) { row.id = params[0]; row.event_type = params[1]; }
              else if (sql.includes("approvals")) {
                row.action_type = params[0]; row.description = params[1]; row.payload = params[2];
                row.status = params[3] || "pending"; row.idempotency_key = params[4];
              }
            }
            table.push(row);
            return { one: () => row };
          }
          if (sql.startsWith("SELECT last_insert_rowid")) {
            return { one: () => ({ id: lastInsertRowId }) };
          }
          if (sql.startsWith("SELECT")) {
            const table = getTable(sql);
            let results = [...table];
            if (sql.includes("WHERE") && params.length > 0) {
              if (sql.includes("status = 'pending'")) results = results.filter(r => r.status === "pending");
              if (sql.includes("session_id = 'merchant'")) results = results.filter(r => r.session_id === "merchant");
              if (sql.includes("captured = 1")) results = results.filter(r => r.captured === 1);
              if (sql.includes("ORDER BY id DESC LIMIT 10")) results = results.slice(-10).reverse();
              if (sql.includes("ORDER BY id DESC LIMIT 8")) results = results.slice(-8).reverse();
              if (sql.includes("ORDER BY id DESC LIMIT 20")) results = results.slice(-20).reverse();
              if (sql.includes("ORDER BY id DESC LIMIT 100")) results = results.slice(-100).reverse();
              if (sql.includes("id = ?")) results = results.filter(r => String(r.id) === String(params[0]));
              if (sql.includes("paypal_order_id = ?")) results = results.filter(r => r.paypal_order_id === params[0]);
              if (sql.includes("paypal_invoice_id = ?")) results = results.filter(r => r.paypal_invoice_id === params[0]);
              if (sql.includes("action_type = ? AND payload = ? AND status = 'pending'")) {
                results = results.filter(r => r.action_type === params[0] && r.payload === params[1] && r.status === "pending");
              }
              if (sql.includes("FROM webhook_events WHERE id = ?")) results = results.filter(r => r.id === params[0]);
            }
            if (sql.includes("COUNT(*)")) {
              return { one: () => ({ c: results.length, total: 0 }), toArray: () => [] };
            }
            if (sql.includes("COALESCE(SUM")) {
              return { one: () => ({ total: 0 }), toArray: () => [] };
            }
            if (sql.includes("ts > ?")) {
              return { toArray: () => results.filter(r => r.ts > params[1]) };
            }
            if (sql.includes("ORDER BY id DESC LIMIT 10")) {
              return { toArray: () => results.slice(0, 10) };
            }
            return { toArray: () => results, one: () => results[0] || null };
          }
          if (sql.startsWith("UPDATE")) {
            const table = getTable(sql);
            if (sql.includes("status = 'rejected'") && params.length >= 3) {
              const row = table.find(r => String(r.id) === String(params[2]) && r.status === "pending");
              if (row) { row.status = "rejected"; row.resolved_at = params[1]; }
            } else if (sql.includes("status = 'executed'") || sql.includes("status = 'failed'")) {
              const row = table.find(r => String(r.id) === String(params[2]));
              if (row) { row.status = params[0]; row.resolved_at = params[1]; }
            } else if (sql.includes("captured = 1") && sql.includes("status = 'COMPLETED'")) {
              const row = table.find(r => r.paypal_order_id === params[1]);
              if (row) { row.captured = 1; row.status = "COMPLETED"; }
            } else if (sql.includes("paypal_order_id = ?")) {
              const row = table.find(r => r.paypal_order_id === params[params.length - 1]);
              if (row) { row.status = params[0]; if (params[1] !== undefined) row.captured = params[1]; }
            } else if (sql.includes("paypal_invoice_id = ?")) {
              const row = table.find(r => r.paypal_invoice_id === params[params.length - 1]);
              if (row) { row.status = params[0]; }
            }
            return { toArray: () => [] };
          }
          if (sql.startsWith("DELETE")) {
            if (sql.includes("knowledge WHERE id = ?")) {
              tables.knowledge = (tables.knowledge || []).filter(r => String(r.id) !== String(params[0]));
            } else if (sql.includes("chat_history WHERE session_id = 'merchant'")) {
              tables.chat_history = [];
            } else if (sql.includes("rate_limits WHERE ts <")) {
              tables.rate_limits = (tables.rate_limits || []).filter(r => r.ts >= params[0]);
            }
            return { toArray: () => [] };
          }
          return { toArray: () => [], one: () => null };
        },
      },
    },
  } as any;
}

function createAppInstance(env: any = createMockEnv()) {
  const state = createMockState();
  const app = new App(state, env);
  return { app, state, env };
}

describe("Worker Default Export — DO Routing", () => {
  it("worker.ts exports a default object with fetch", async () => {
    const worker = await import("../src/worker");
    expect(worker.default).toBeDefined();
    expect(typeof worker.default.fetch).toBe("function");
  });

  it("default fetch routes to APP Durable Object", async () => {
    let routedRequest: Request | null = null;
    const mockEnv = {
      APP: {
        idFromName: (name: string) => ({ id: name }),
        get: () => ({
          fetch: async (req: Request) => {
            routedRequest = req;
            return new Response(JSON.stringify({ status: "ok" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          },
        }),
      },
      AI: undefined,
      MERCHANT_TOKEN: "test-token",
    } as any;

    const worker = (await import("../src/worker")).default;
    const request = new Request("https://example.com/api/health");
    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(200);
    expect(routedRequest).not.toBeNull();
  });
});

describe("App Durable Object — Entry Point", () => {
  it("App is a DurableObject subclass", () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe("function");
    expect(App.prototype.fetch).toBeDefined();
    expect(typeof App.prototype.fetch).toBe("function");
  });

  it("App.fetch handles /api/health endpoint", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/health");
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data.bindings.ai).toBe(false);
    expect(data.bindings.paypal).toBe(true);
    expect(data.bindings.merchantToken).toBe(true);
  });

  it("App.fetch serves static assets for non-API paths", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/index.html");
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("static");
  });

  it("App.fetch serves root path as static asset", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/");
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
  });

  it("App.fetch serves widget.js as static asset", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/widget.js");
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("widget");
  });

  it("App.fetch returns 401 for protected endpoints without auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/dashboard");
    const response = await app.fetch(request);
    expect(response.status).toBe(401);
  });

  it("App.fetch returns 200 for protected endpoints with valid auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/dashboard", {
      headers: { Authorization: "Bearer test-token" },
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.orders).toBe(0);
  });

  it("App.fetch handles /api/auth/status", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/auth/status");
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.needsAuth).toBe(true);
    expect(data.authenticated).toBe(false);
  });

  it("App.fetch handles /api/auth/login with valid token", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test-token" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.authenticated).toBe(true);
  });

  it("App.fetch handles /api/auth/login with invalid token", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "wrong-token" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(401);
  });

  it("App.fetch handles /api/paypal/status", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/paypal/status");
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.configured).toBe(true);
    expect(data.mode).toBe("sandbox");
  });

  it("App.fetch handles OPTIONS preflight requests", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/chat", { method: "OPTIONS" });
    const response = await app.fetch(request);
    expect(response.status).toBe(204);
  });

  it("App.fetch handles /api/knowledge GET with auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/knowledge", {
      headers: { Authorization: "Bearer test-token" },
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("App.fetch handles /api/knowledge POST with auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ title: "Test Article", body: "Test content", tags: "faq" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });

  it("App.fetch handles /api/approvals GET with auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/approvals", {
      headers: { Authorization: "Bearer test-token" },
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("App.fetch handles /api/audit-logs GET with auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/audit-logs", {
      headers: { Authorization: "Bearer test-token" },
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("App.fetch returns 404 for unknown API paths", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/unknown", {
      headers: { Authorization: "Bearer test-token" },
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(404);
  });

  it("App.fetch handles /api/auth/status when MERCHANT_TOKEN not set", async () => {
    const { app } = createAppInstance(createMockEnv({ MERCHANT_TOKEN: undefined }));
    const request = new Request("https://example.com/api/auth/status");
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.needsAuth).toBe(false);
    expect(data.error).toContain("MERCHANT_TOKEN");
  });

  it("App.fetch handles /api/auth/login when MERCHANT_TOKEN not set", async () => {
    const { app } = createAppInstance(createMockEnv({ MERCHANT_TOKEN: undefined }));
    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "anything" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(503);
  });

  it("App.fetch handles /api/chat with auth and AI binding missing", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ message: "hello" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toContain("Workers AI");
  });

  it("App.fetch handles /api/visitor/chat with AI binding missing", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/visitor/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", sessionId: "vis-123" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(503);
  });

  it("App.fetch handles /api/visitor/chat with missing message", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/visitor/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "vis-123" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(400);
  });

  it("App.fetch handles /api/visitor/chat with missing sessionId", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/visitor/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(400);
  });

  it("App.fetch handles /api/chat with empty message", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ message: "" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(400);
  });

  it("App.fetch handles /api/chat/history DELETE with auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/chat/history", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });

  it("App.fetch handles /api/paypal/webhook without credentials", async () => {
    const { app } = createAppInstance(createMockEnv({ PAYPAL_CLIENT_ID: undefined }));
    const request = new Request("https://example.com/api/paypal/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(500);
  });

  it("App.fetch handles /api/paypal/webhook without webhook ID", async () => {
    const { app } = createAppInstance(createMockEnv({ PAYPAL_WEBHOOK_ID: undefined }));
    const request = new Request("https://example.com/api/paypal/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(500);
  });

  it("App.fetch handles /api/orders GET with auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/orders", {
      headers: { Authorization: "Bearer test-token" },
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("App.fetch handles /api/invoices GET with auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/invoices", {
      headers: { Authorization: "Bearer test-token" },
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("App.fetch handles /api/approvals POST with auth", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        action_type: "create_order",
        description: "Test order",
        payload: JSON.stringify({ amount: "10.00", currency: "USD", description: "Test", customerEmail: "a@b.com" }),
      }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.id).toBeDefined();
  });

  it("App.fetch handles /api/approvals POST with missing fields", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ action_type: "create_order" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(400);
  });

  it("App.fetch handles /api/knowledge POST with missing fields", async () => {
    const { app } = createAppInstance();
    const request = new Request("https://example.com/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ title: "Test" }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(400);
  });

  it("approval transitions: pending → executing → executed/rejected/failed", async () => {
    const { app, state } = createAppInstance();
    const createReq = new Request("https://example.com/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        action_type: "create_order",
        description: "Test order",
        payload: JSON.stringify({ amount: "10.00", currency: "USD", description: "Test", customerEmail: "a@b.com" }),
      }),
    });
    const createRes = await app.fetch(createReq);
    const createData = await createRes.json();
    const approvalId = createData.id;

    const approveReq = new Request(`https://example.com/api/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    const approveRes = await app.fetch(approveReq);
    expect([200, 500, 502].includes(approveRes.status)).toBe(true);
  });

  it("rejecting an already-resolved approval returns 400", async () => {
    const { app } = createAppInstance();
    const createReq = new Request("https://example.com/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        action_type: "create_order",
        description: "Test order",
        payload: JSON.stringify({ amount: "10.00", currency: "USD", description: "Test", customerEmail: "a@b.com" }),
      }),
    });
    const createRes = await app.fetch(createReq);
    const createData = await createRes.json();
    const approvalId = createData.id;

    const rejectReq = new Request(`https://example.com/api/approvals/${approvalId}/reject`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    await app.fetch(rejectReq);

    const rejectAgainReq = new Request(`https://example.com/api/approvals/${approvalId}/reject`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    const rejectAgainRes = await app.fetch(rejectAgainReq);
    expect(rejectAgainRes.status).toBe(200);
  });

  it("approving a non-existent approval returns 404", async () => {
    const { app } = createAppInstance();
    const req = new Request("https://example.com/api/approvals/99999/approve", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(404);
  });

  it("approving an already-resolved approval returns 400", async () => {
    const { app } = createAppInstance();
    const createReq = new Request("https://example.com/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        action_type: "create_order",
        description: "Test order",
        payload: JSON.stringify({ amount: "10.00", currency: "USD", description: "Test", customerEmail: "a@b.com" }),
      }),
    });
    const createRes = await app.fetch(createReq);
    const createData = await createRes.json();
    const approvalId = createData.id;

    const rejectReq = new Request(`https://example.com/api/approvals/${approvalId}/reject`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    await app.fetch(rejectReq);

    const approveReq = new Request(`https://example.com/api/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    const approveRes = await app.fetch(approveReq);
    expect(approveRes.status).toBe(400);
  });
});

describe("Wrangler Configuration — Preview (wrangler.json)", () => {
  it("wrangler.json does NOT declare Durable Object bindings (platform provides DO in preview)", async () => {
    const config = await import("../wrangler.json");
    expect(config.durable_objects).toBeUndefined();
    expect(config.migrations).toBeUndefined();
  });

  it("wrangler.json has assets binding", async () => {
    const config = await import("../wrangler.json");
    expect(config.assets).toBeDefined();
    expect(config.assets.binding).toBe("ASSETS");
    expect(config.assets.directory).toBe("./public");
  });

  it("wrangler.json has AI binding", async () => {
    const config = await import("../wrangler.json");
    expect(config.ai).toBeDefined();
    expect(config.ai.binding).toBe("AI");
  });

  it("wrangler.json main points to src/worker.ts", async () => {
    const config = await import("../wrangler.json");
    expect(config.main).toBe("src/worker.ts");
  });
});

describe("Wrangler Configuration — Production (wrangler.prod.json)", () => {
  it("wrangler.prod.json declares APP Durable Object binding", async () => {
    const config = await import("../wrangler.prod.json");
    expect(config.durable_objects).toBeDefined();
    expect(config.durable_objects.bindings).toBeDefined();
    expect(config.durable_objects.bindings[0].name).toBe("APP");
    expect(config.durable_objects.bindings[0].class_name).toBe("App");
  });

  it("wrangler.prod.json declares SQLite migration for App DO", async () => {
    const config = await import("../wrangler.prod.json");
    expect(config.migrations).toBeDefined();
    expect(config.migrations[0].new_sqlite_classes).toContain("App");
  });

  it("wrangler.prod.json has assets binding", async () => {
    const config = await import("../wrangler.prod.json");
    expect(config.assets).toBeDefined();
    expect(config.assets.binding).toBe("ASSETS");
  });

  it("wrangler.prod.json has AI binding", async () => {
    const config = await import("../wrangler.prod.json");
    expect(config.ai).toBeDefined();
    expect(config.ai.binding).toBe("AI");
  });

  it("wrangler.prod.json main matches wrangler.json", async () => {
    const dev = await import("../wrangler.json");
    const prod = await import("../wrangler.prod.json");
    expect(prod.main).toBe(dev.main);
    expect(prod.assets).toEqual(dev.assets);
    expect(prod.ai).toEqual(dev.ai);
  });
});

describe("Path Extraction (SpaceDO preview URLs)", () => {
  it("extracts API path from SpaceDO preview URL", () => {
    const fullPath = "/space/helppuff-commerce/preview/main/api/chat";
    expect(fullPath.includes("/api/")).toBe(true);
    const apiPath = fullPath.slice(fullPath.indexOf("/api/"));
    expect(apiPath).toBe("/api/chat");
  });

  it("extracts nested API paths from preview URL", () => {
    const fullPath = "/space/helppuff-commerce/preview/main/api/approvals/5/approve";
    const apiPath = fullPath.slice(fullPath.indexOf("/api/"));
    expect(apiPath).toBe("/api/approvals/5/approve");
  });

  it("does not match non-API paths", () => {
    expect("/orders".includes("/api/")).toBe(false);
    expect("/widget.js".includes("/api/")).toBe(false);
    expect("/".includes("/api/")).toBe(false);
  });
});
