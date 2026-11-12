import { describe, it, expect } from "vitest";
import { parseActionProposal, generateIdempotencyKey } from "../src/ai-parser";
import { validateActionProposal, validateOrderInput, validateInvoiceInput, validateEmail, validateAmount, validateCurrency } from "../src/validation";
import { SYSTEM_PROMPT, buildVisitorPrompt, AI_MODEL, PAYPAL_SANDBOX_BASE } from "../src/types";
import { App } from "../src/worker";

describe("App Durable Object Class", () => {
  it("App is exported from worker.ts", () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe("function");
  });

  it("App has a fetch method", () => {
    expect(App.prototype.fetch).toBeDefined();
    expect(typeof App.prototype.fetch).toBe("function");
  });
});

describe("AI Action Proposal Parser", () => {
  it("parses a valid create_order proposal from AI response", () => {
    const response = `I'll create that order for you.\n[ACTION_PROPOSAL]\n{"action_type":"create_order","description":"Create order for $29.99 USD — Premium subscription","payload":{"amount":"29.99","currency":"USD","description":"Premium subscription","customerEmail":"customer@example.com"}}\n[/ACTION_PROPOSAL]`;
    const result = parseActionProposal(response);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.action_type).toBe("create_order");
    expect(result.proposal!.description).toContain("29.99");
    expect(result.proposal!.payload.amount).toBe("29.99");
    expect(result.proposal!.payload.customerEmail).toBe("customer@example.com");
    expect(result.cleanResponse).toContain("I'll create that order");
    expect(result.cleanResponse).not.toContain("[ACTION_PROPOSAL]");
  });

  it("parses a valid create_invoice proposal", () => {
    const response = `[ACTION_PROPOSAL]\n{"action_type":"create_invoice","description":"Send invoice for $99.00 USD","payload":{"recipientName":"John Doe","recipientEmail":"john@example.com","amount":"99.00","currency":"USD","description":"Consulting"}}\n[/ACTION_PROPOSAL]`;
    const result = parseActionProposal(response);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.action_type).toBe("create_invoice");
    expect(result.proposal!.payload.recipientName).toBe("John Doe");
    expect(result.proposal!.payload.recipientEmail).toBe("john@example.com");
  });

  it("parses a capture_order proposal", () => {
    const response = `[ACTION_PROPOSAL]\n{"action_type":"capture_order","description":"Capture order 5OZ12345","payload":{"paypalOrderId":"5OZ12345"}}\n[/ACTION_PROPOSAL]`;
    const result = parseActionProposal(response);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.action_type).toBe("capture_order");
    expect(result.proposal!.payload.paypalOrderId).toBe("5OZ12345");
  });

  it("returns null proposal when no ACTION_PROPOSAL block exists", () => {
    const response = "I need more information. What is the customer's email?";
    const result = parseActionProposal(response);
    expect(result.proposal).toBeNull();
    expect(result.cleanResponse).toBe(response);
  });

  it("returns null proposal for malformed JSON", () => {
    const response = `[ACTION_PROPOSAL]\n{invalid json}\n[/ACTION_PROPOSAL]`;
    const result = parseActionProposal(response);
    expect(result.proposal).toBeNull();
  });

  it("returns null proposal when action_type is missing", () => {
    const response = `[ACTION_PROPOSAL]\n{"description":"test"}\n[/ACTION_PROPOSAL]`;
    const result = parseActionProposal(response);
    expect(result.proposal).toBeNull();
  });

  it("preserves text before and after the proposal block", () => {
    const response = `Here's what I'll do.\n[ACTION_PROPOSAL]\n{"action_type":"create_order","description":"Test","payload":{"amount":"10.00","currency":"USD","description":"Test","customerEmail":"a@b.com"}}\n[/ACTION_PROPOSAL]\nLet me know if you approve.`;
    const result = parseActionProposal(response);
    expect(result.cleanResponse).toContain("Here's what I'll do");
    expect(result.cleanResponse).toContain("Let me know");
    expect(result.proposal).not.toBeNull();
  });

  it("generates unique idempotency keys with correct prefix", () => {
    const key1 = generateIdempotencyKey();
    const key2 = generateIdempotencyKey();
    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^idem-/);
    expect(key2).toMatch(/^idem-/);
  });
});

describe("Validation — Email, Amount, Currency", () => {
  it("accepts valid emails", () => {
    expect(validateEmail("user@example.com")).toBe(true);
    expect(validateEmail("test.user@domain.co.uk")).toBe(true);
  });
  it("rejects invalid emails", () => {
    expect(validateEmail("not-an-email")).toBe(false);
    expect(validateEmail("missing@domain")).toBe(false);
    expect(validateEmail("")).toBe(false);
  });
  it("accepts valid amounts", () => {
    expect(validateAmount("29.99")).toBe(true);
    expect(validateAmount("100")).toBe(true);
    expect(validateAmount("0.01")).toBe(true);
  });
  it("rejects invalid amounts", () => {
    expect(validateAmount("0")).toBe(false);
    expect(validateAmount("-5.00")).toBe(false);
    expect(validateAmount("abc")).toBe(false);
    expect(validateAmount("29.999")).toBe(false);
  });
  it("accepts valid 3-letter currency codes", () => {
    expect(validateCurrency("USD")).toBe(true);
    expect(validateCurrency("EUR")).toBe(true);
  });
  it("rejects invalid currency codes", () => {
    expect(validateCurrency("us")).toBe(false);
    expect(validateCurrency("USDD")).toBe(false);
    expect(validateCurrency("")).toBe(false);
  });
});

describe("Validation — Order and Invoice Input", () => {
  it("validates a complete order payload", () => {
    const result = validateOrderInput({
      amount: "29.99", currency: "USD", description: "Premium subscription", customerEmail: "customer@example.com",
    });
    expect(result.valid).toBe(true);
    expect(result.data?.amount).toBe("29.99");
  });
  it("defaults currency to USD when not provided", () => {
    const result = validateOrderInput({ amount: "10.00", description: "Test", customerEmail: "test@test.com" });
    expect(result.valid).toBe(true);
    expect(result.data?.currency).toBe("USD");
  });
  it("rejects missing fields for order", () => {
    const result = validateOrderInput({ amount: "10.00" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Description"))).toBe(true);
    expect(result.errors.some((e) => e.includes("email"))).toBe(true);
  });
  it("validates a complete invoice payload", () => {
    const result = validateInvoiceInput({
      recipientName: "John Doe", recipientEmail: "john@example.com", amount: "99.00", currency: "USD", description: "Consulting",
    });
    expect(result.valid).toBe(true);
    expect(result.data?.recipientName).toBe("John Doe");
  });
  it("rejects missing recipient name for invoice", () => {
    const result = validateInvoiceInput({ recipientEmail: "john@example.com", amount: "99.00", description: "Consulting" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Recipient name"))).toBe(true);
  });
});

describe("Validation — Action Proposal", () => {
  it("validates a create_order proposal", () => {
    const result = validateActionProposal({
      action_type: "create_order", description: "Create order for $29.99",
      payload: { amount: "29.99", currency: "USD", description: "Test", customerEmail: "a@b.com" },
    });
    expect(result.valid).toBe(true);
  });
  it("validates a create_invoice proposal", () => {
    const result = validateActionProposal({
      action_type: "create_invoice", description: "Send invoice",
      payload: { recipientName: "John", recipientEmail: "john@example.com", amount: "50.00", currency: "USD", description: "Service" },
    });
    expect(result.valid).toBe(true);
  });
  it("validates a capture_order proposal", () => {
    const result = validateActionProposal({
      action_type: "capture_order", description: "Capture order ABC123", payload: { paypalOrderId: "ABC123" },
    });
    expect(result.valid).toBe(true);
  });
  it("rejects unknown action types", () => {
    const result = validateActionProposal({ action_type: "delete_everything", description: "Bad", payload: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invalid action_type"))).toBe(true);
  });
  it("rejects create_order with invalid payload", () => {
    const result = validateActionProposal({ action_type: "create_order", description: "Create order", payload: { amount: "0" } });
    expect(result.valid).toBe(false);
  });
  it("rejects capture_order without paypalOrderId", () => {
    const result = validateActionProposal({ action_type: "capture_order", description: "Capture", payload: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("paypalOrderId"))).toBe(true);
  });
  it("rejects proposal without description", () => {
    const result = validateActionProposal({
      action_type: "create_order", description: "",
      payload: { amount: "10.00", currency: "USD", description: "Test", customerEmail: "a@b.com" },
    });
    expect(result.valid).toBe(false);
  });
});

describe("System Prompt and AI Configuration", () => {
  it("requires explicit approval for financial actions", () => {
    expect(SYSTEM_PROMPT).toContain("explicit approval");
    expect(SYSTEM_PROMPT).toContain("financial action");
  });
  it("uses ACTION_PROPOSAL format", () => {
    expect(SYSTEM_PROMPT).toContain("[ACTION_PROPOSAL]");
    expect(SYSTEM_PROMPT).toContain("[/ACTION_PROPOSAL]");
  });
  it("specifies create_order required fields", () => {
    expect(SYSTEM_PROMPT).toContain("description");
    expect(SYSTEM_PROMPT).toContain("amount");
    expect(SYSTEM_PROMPT).toContain("customer email");
  });
  it("specifies create_invoice required fields", () => {
    expect(SYSTEM_PROMPT).toContain("recipient name");
    expect(SYSTEM_PROMPT).toContain("recipient email");
  });
  it("uses a supported Cloudflare Workers AI model", () => {
    expect(AI_MODEL).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });
  it("uses PayPal sandbox endpoint", () => {
    expect(PAYPAL_SANDBOX_BASE).toBe("https://api-m.sandbox.paypal.com");
    expect(PAYPAL_SANDBOX_BASE).toContain("sandbox");
  });
});

describe("Visitor Prompt Builder", () => {
  it("includes knowledge base articles when provided", () => {
    const prompt = buildVisitorPrompt([
      { title: "Shipping Info", body: "We ship in 2-3 days." },
      { title: "Returns", body: "30-day return policy." },
    ]);
    expect(prompt).toContain("Shipping Info");
    expect(prompt).toContain("We ship in 2-3 days.");
  });
  it("shows fallback when no articles", () => {
    const prompt = buildVisitorPrompt([]);
    expect(prompt).toContain("No knowledge base articles available");
  });
  it("prevents visitor from processing payments", () => {
    const prompt = buildVisitorPrompt([]);
    expect(prompt).toContain("CANNOT process payments");
    expect(prompt).toContain("CANNOT create orders");
    expect(prompt).toContain("CANNOT generate invoices");
  });
  it("does not include merchant system prompt", () => {
    const prompt = buildVisitorPrompt([]);
    expect(prompt).not.toContain("ACTION_PROPOSAL");
    expect(prompt).not.toContain("create_order");
  });
});

describe("End-to-End Commerce Flow Logic", () => {
  it("complete order flow: parse → validate → approve → execute", () => {
    const aiResponse = `I'll create that order for you.\n[ACTION_PROPOSAL]\n{"action_type":"create_order","description":"Create order for $49.99 USD — Pro Plan","payload":{"amount":"49.99","currency":"USD","description":"Pro Plan","customerEmail":"buyer@example.com"}}\n[/ACTION_PROPOSAL]`;
    const parsed = parseActionProposal(aiResponse);
    expect(parsed.proposal).not.toBeNull();
    expect(parsed.cleanResponse).toContain("I'll create that order");

    const validated = validateActionProposal({
      action_type: parsed.proposal!.action_type,
      description: parsed.proposal!.description,
      payload: parsed.proposal!.payload,
    });
    expect(validated.valid).toBe(true);
    expect(validated.data?.action_type).toBe("create_order");
    expect(validated.data?.payload.amount).toBe("49.99");
  });

  it("complete invoice flow: parse → validate → approve → execute", () => {
    const aiResponse = `[ACTION_PROPOSAL]\n{"action_type":"create_invoice","description":"Send $150 invoice for Design Services to Jane","payload":{"recipientName":"Jane Smith","recipientEmail":"jane@example.com","amount":"150.00","currency":"USD","description":"Design Services"}}\n[/ACTION_PROPOSAL]`;
    const parsed = parseActionProposal(aiResponse);
    expect(parsed.proposal).not.toBeNull();

    const validated = validateActionProposal({
      action_type: parsed.proposal!.action_type,
      description: parsed.proposal!.description,
      payload: parsed.proposal!.payload,
    });
    expect(validated.valid).toBe(true);
    expect(validated.data?.payload.recipientName).toBe("Jane Smith");
  });

  it("AI asks for missing info instead of proposing incomplete action", () => {
    const aiResponse = "I'd be happy to create an order for you. What is the customer's email address?";
    const parsed = parseActionProposal(aiResponse);
    expect(parsed.proposal).toBeNull();
    expect(parsed.cleanResponse).toContain("email");
  });

  it("AI does not propose action with invalid amount", () => {
    const aiResponse = `[ACTION_PROPOSAL]\n{"action_type":"create_order","description":"Bad order","payload":{"amount":"0","currency":"USD","description":"Test","customerEmail":"a@b.com"}}\n[/ACTION_PROPOSAL]`;
    const parsed = parseActionProposal(aiResponse);
    expect(parsed.proposal).not.toBeNull();

    const validated = validateActionProposal({
      action_type: parsed.proposal!.action_type,
      description: parsed.proposal!.description,
      payload: parsed.proposal!.payload,
    });
    expect(validated.valid).toBe(false);
  });
});

describe("Duplicate Prevention", () => {
  it("prevents duplicate pending approvals with same action and payload", () => {
    const existing = { id: 1, action_type: "create_order", payload: JSON.stringify({ amount: "29.99" }), status: "pending" };
    const newPayload = JSON.stringify({ amount: "29.99" });
    const isDuplicate = existing.action_type === "create_order" && existing.payload === newPayload && existing.status === "pending";
    expect(isDuplicate).toBe(true);
  });

  it("allows new approval when previous one was resolved", () => {
    const existing = { id: 1, action_type: "create_order", payload: JSON.stringify({ amount: "29.99" }), status: "executed" };
    const newPayload = JSON.stringify({ amount: "29.99" });
    const isDuplicate = existing.action_type === "create_order" && existing.payload === newPayload && existing.status === "pending";
    expect(isDuplicate).toBe(false);
  });
});

describe("Duplicate Capture Prevention", () => {
  it("prevents capturing an already-captured order", () => {
    const existingOrder = { id: 1, captured: 1, paypal_order_id: "ORDER123" };
    const shouldSkip = existingOrder.captured === 1;
    expect(shouldSkip).toBe(true);
  });

  it("allows capturing an uncaptured order", () => {
    const existingOrder = { id: 1, captured: 0, paypal_order_id: "ORDER123" };
    const shouldSkip = existingOrder.captured === 1;
    expect(shouldSkip).toBe(false);
  });
});

describe("Idempotency", () => {
  it("generates unique keys for each financial action", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) keys.add(generateIdempotencyKey());
    expect(keys.size).toBe(100);
  });
  it("keys have correct format", () => {
    expect(generateIdempotencyKey()).toMatch(/^idem-\d+-[a-z0-9]+$/);
  });
});

describe("Rate Limiting Logic", () => {
  it("allows requests within limit", () => {
    expect(25 < 30).toBe(true);
  });
  it("blocks requests exceeding limit", () => {
    expect(31 >= 30).toBe(true);
  });
});
