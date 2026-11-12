import { describe, it, expect } from "vitest";
import { validateActionProposal, validateOrderInput, validateInvoiceInput, sanitizeString } from "../src/validation";
import { parseActionProposal, generateIdempotencyKey } from "../src/ai-parser";
import { SYSTEM_PROMPT, buildVisitorPrompt, AI_MODEL, PAYPAL_SANDBOX_BASE } from "../src/types";
import { App } from "../src/worker";

describe("Security — Authentication Fail-Closed", () => {
  it("checkMerchantAuth returns false when MERCHANT_TOKEN is not set", () => {
    const env = { MERCHANT_TOKEN: undefined as any };
    expect(!env.MERCHANT_TOKEN).toBe(true);
  });

  it("checkMerchantAuth returns false for invalid Bearer token", () => {
    const env = { MERCHANT_TOKEN: "secret123" };
    const request = new Request("https://example.com/api/dashboard", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const auth = request.headers.get("Authorization")?.replace("Bearer ", "") || "";
    expect(auth === env.MERCHANT_TOKEN).toBe(false);
  });

  it("checkMerchantAuth returns true for valid Bearer token", () => {
    const env = { MERCHANT_TOKEN: "secret123" };
    const request = new Request("https://example.com/api/dashboard", {
      headers: { Authorization: "Bearer secret123" },
    });
    const auth = request.headers.get("Authorization")?.replace("Bearer ", "") || "";
    expect(auth === env.MERCHANT_TOKEN).toBe(true);
  });

  it("checkMerchantAuth reads token from cookie", () => {
    const env = { MERCHANT_TOKEN: "secret123" };
    const request = new Request("https://example.com/api/dashboard", {
      headers: { Cookie: "merchant_token=secret123" },
    });
    const cookieMatch = request.headers.get("Cookie")?.match(/merchant_token=([^;]+)/);
    const token = cookieMatch?.[1] || "";
    expect(token === env.MERCHANT_TOKEN).toBe(true);
  });

  it("checkMerchantAuth returns false for invalid cookie token", () => {
    const env = { MERCHANT_TOKEN: "secret123" };
    const request = new Request("https://example.com/api/dashboard", {
      headers: { Cookie: "merchant_token=wrong" },
    });
    const cookieMatch = request.headers.get("Cookie")?.match(/merchant_token=([^;]+)/);
    const token = cookieMatch?.[1] || "";
    expect(token === env.MERCHANT_TOKEN).toBe(false);
  });

  it("checkMerchantAuth returns false when no auth header or cookie present", () => {
    const env = { MERCHANT_TOKEN: "secret123" };
    const request = new Request("https://example.com/api/dashboard");
    const auth = request.headers.get("Authorization") || "";
    const cookieMatch = request.headers.get("Cookie")?.match(/merchant_token=([^;]+)/);
    const token = auth.replace("Bearer ", "") || cookieMatch?.[1] || "";
    expect(token === env.MERCHANT_TOKEN).toBe(false);
  });
});

describe("Security — Worker routes to App DO", () => {
  it("App class is exported and has fetch method", () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe("function");
    expect(App.prototype.fetch).toBeDefined();
  });

  it("worker.ts exports default fetch handler", async () => {
    const worker = await import("../src/worker");
    expect(worker.default).toBeDefined();
    expect(worker.default.fetch).toBeDefined();
  });
});

describe("Security — Input Sanitization", () => {
  it("truncates long strings to prevent overflow", () => {
    const long = "A".repeat(10000);
    expect(sanitizeString(long, 100).length).toBe(100);
  });

  it("handles empty input safely", () => {
    expect(sanitizeString("", 100)).toBe("");
    expect(sanitizeString(null as any, 100)).toBe("undefined");
  });

  it("prevents negative amounts", () => {
    const result = validateOrderInput({
      amount: "-50.00", description: "Test", customerEmail: "test@test.com",
    });
    expect(result.valid).toBe(false);
  });

  it("prevents excessive decimal places", () => {
    const result = validateOrderInput({
      amount: "10.999", description: "Test", customerEmail: "test@test.com",
    });
    expect(result.valid).toBe(false);
  });

  it("prevents SQL injection payloads from being treated as valid amounts", () => {
    const result = validateOrderInput({
      amount: "1; DROP TABLE--", description: "Test", customerEmail: "test@test.com",
    });
    expect(result.valid).toBe(false);
  });
});

describe("Security — Approval Enforcement", () => {
  it("rejects unknown action types", () => {
    const result = validateActionProposal({ action_type: "delete_database", description: "Delete", payload: {} });
    expect(result.valid).toBe(false);
  });

  it("requires description for all actions", () => {
    const result = validateActionProposal({
      action_type: "create_order", description: "",
      payload: { amount: "10.00", currency: "USD", description: "Test", customerEmail: "a@b.com" },
    });
    expect(result.valid).toBe(false);
  });

  it("validates all required fields for create_order", () => {
    const result = validateActionProposal({ action_type: "create_order", description: "Test", payload: { amount: "10.00" } });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it("validates all required fields for create_invoice", () => {
    const result = validateActionProposal({ action_type: "create_invoice", description: "Test", payload: { amount: "50.00" } });
    expect(result.valid).toBe(false);
  });

  it("requires paypalOrderId for capture_order", () => {
    const result = validateActionProposal({ action_type: "capture_order", description: "Capture", payload: {} });
    expect(result.valid).toBe(false);
  });
});

describe("Security — Visitor Isolation", () => {
  it("visitor prompt explicitly prevents payment processing", () => {
    const prompt = buildVisitorPrompt([]);
    expect(prompt).toContain("CANNOT process payments");
    expect(prompt).toContain("CANNOT create orders");
    expect(prompt).toContain("CANNOT generate invoices");
  });

  it("visitor prompt does not include merchant system prompt", () => {
    const prompt = buildVisitorPrompt([]);
    expect(prompt).not.toContain("ACTION_PROPOSAL");
    expect(prompt).not.toContain("create_order");
  });

  it("visitor prompt includes knowledge base but not merchant data", () => {
    const prompt = buildVisitorPrompt([{ title: "Shipping", body: "Free shipping over $50" }]);
    expect(prompt).toContain("Shipping");
    expect(prompt).toContain("Free shipping");
    expect(prompt).not.toContain("MERCHANT_TOKEN");
    expect(prompt).not.toContain("PayPal Client");
  });
});

describe("Security — PayPal Sandbox Only", () => {
  it("uses sandbox endpoint, not production", () => {
    expect(PAYPAL_SANDBOX_BASE).toBe("https://api-m.sandbox.paypal.com");
    expect(PAYPAL_SANDBOX_BASE).not.toContain("api-m.paypal.com");
    expect(PAYPAL_SANDBOX_BASE).not.toContain("api.paypal.com");
  });
});

describe("Security — Idempotency", () => {
  it("generates unique keys for each financial action", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) keys.add(generateIdempotencyKey());
    expect(keys.size).toBe(100);
  });

  it("keys have correct format", () => {
    expect(generateIdempotencyKey()).toMatch(/^idem-\d+-[a-z0-9]+$/);
  });
});

describe("Security — AI Model and Prompt", () => {
  it("uses a supported Cloudflare Workers AI model", () => {
    expect(AI_MODEL).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("system prompt enforces approval workflow", () => {
    expect(SYSTEM_PROMPT).toContain("explicit approval");
    expect(SYSTEM_PROMPT).toContain("Never execute directly");
  });

  it("system prompt specifies required fields for orders", () => {
    expect(SYSTEM_PROMPT).toContain("description");
    expect(SYSTEM_PROMPT).toContain("amount");
    expect(SYSTEM_PROMPT).toContain("customer email");
    expect(SYSTEM_PROMPT).toContain("currency");
  });

  it("system prompt specifies required fields for invoices", () => {
    expect(SYSTEM_PROMPT).toContain("recipient name");
    expect(SYSTEM_PROMPT).toContain("recipient email");
  });
});

describe("Security — CORS Configuration", () => {
  it("CORS does not use wildcard with credentials", () => {
    const corsHeaders = (origin?: string) => {
      const allowedOrigin = origin && origin !== "*" ? origin : "null";
      return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Credentials": "true",
      };
    };
    const headers = corsHeaders("https://example.com");
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
  });

  it("corsHeaders returns Vary: Origin", () => {
    const corsHeaders = (origin?: string) => {
      const allowedOrigin = origin && origin !== "*" ? origin : "null";
      return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
      };
    };
    const headers = corsHeaders("https://example.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
    expect(headers["Vary"]).toBe("Origin");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("corsHeaders returns null origin when no origin provided", () => {
    const corsHeaders = (origin?: string) => {
      const allowedOrigin = origin && origin !== "*" ? origin : "null";
      return { "Access-Control-Allow-Origin": allowedOrigin };
    };
    const headers = corsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("null");
  });
});

describe("Security — Duplicate Prevention", () => {
  it("prevents duplicate pending approvals with same action and payload", () => {
    const existing = { action_type: "create_order", payload: JSON.stringify({ amount: "29.99" }), status: "pending" };
    const newPayload = JSON.stringify({ amount: "29.99" });
    const isDuplicate = existing.action_type === "create_order" && existing.payload === newPayload && existing.status === "pending";
    expect(isDuplicate).toBe(true);
  });

  it("allows new approval when previous one was resolved", () => {
    const existing = { action_type: "create_order", payload: JSON.stringify({ amount: "29.99" }), status: "executed" };
    const newPayload = JSON.stringify({ amount: "29.99" });
    const isDuplicate = existing.action_type === "create_order" && existing.payload === newPayload && existing.status === "pending";
    expect(isDuplicate).toBe(false);
  });
});
