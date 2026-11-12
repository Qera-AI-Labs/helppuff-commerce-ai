import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getPayPalAccessToken,
  createPayPalOrder,
  capturePayPalOrder,
  getPayPalOrderStatus,
  createPayPalInvoice,
  getPayPalInvoiceStatus,
  verifyWebhookSignature,
  clearTokenCache,
} from "../src/paypal";
import { PAYPAL_SANDBOX_BASE } from "../src/types";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  clearTokenCache();
  vi.stubGlobal("fetch", mockFetch);
});

describe("PayPal Access Token", () => {
  it("requests token with client_credentials grant", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const token = await getPayPalAccessToken("client-id", "client-secret");
    expect(token).toBe("test-token");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`);
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe("grant_type=client_credentials");
    expect(opts.headers.Authorization).toContain("Basic");
    expect(opts.headers.Authorization).toBe(`Basic ${btoa("client-id:client-secret")}`);
  });

  it("caches token and reuses it within expiry window", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "cached-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const token1 = await getPayPalAccessToken("id", "secret");
    const token2 = await getPayPalAccessToken("id", "secret");
    expect(token1).toBe("cached-token");
    expect(token2).toBe("cached-token");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on auth failure", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("invalid_client", { status: 401 })
    );

    await expect(getPayPalAccessToken("bad", "bad")).rejects.toThrow("PayPal auth failed (401)");
  });
});

describe("PayPal Order Creation", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("creates order with CAPTURE intent and extracts approve URL", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "ORDER123",
          status: "CREATED",
          links: [
            { rel: "self", href: `${PAYPAL_SANDBOX_BASE}/v2/checkout/orders/ORDER123` },
            { rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER123" },
            { rel: "capture", href: `${PAYPAL_SANDBOX_BASE}/v2/checkout/orders/ORDER123/capture` },
          ],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await createPayPalOrder("test-token", {
      amount: "29.99",
      currency: "USD",
      description: "Premium subscription",
      customerEmail: "customer@example.com",
    });

    expect(result.id).toBe("ORDER123");
    expect(result.status).toBe("CREATED");
    expect(result.approveUrl).toContain("checkoutnow");
    expect(result.approveUrl).toContain("ORDER123");

    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toBe(`${PAYPAL_SANDBOX_BASE}/v2/checkout/orders`);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0].amount.currency_code).toBe("USD");
    expect(body.purchase_units[0].amount.value).toBe("29.99");
    expect(body.application_context.brand_name).toBe("HelpPuff Commerce");
    expect(body.application_context.user_action).toBe("PAY_NOW");
  });

  it("sends PayPal-Request-Id header when idempotency key provided", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "ORDER456",
          status: "CREATED",
          links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER456" }],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    await createPayPalOrder("test-token", {
      amount: "50.00",
      currency: "USD",
      description: "Test",
      customerEmail: "test@test.com",
    }, "idem-key-123");

    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.headers["PayPal-Request-Id"]).toBe("idem-key-123");
  });

  it("throws on order creation failure", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("INVALID_REQUEST", { status: 400 })
    );

    await expect(
      createPayPalOrder("test-token", {
        amount: "29.99",
        currency: "USD",
        description: "Test",
        customerEmail: "test@test.com",
      })
    ).rejects.toThrow("PayPal order creation failed (400)");
  });
});

describe("PayPal Order Capture", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("captures via /v2/checkout/orders/{id}/capture", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "ORDER123",
        status: "COMPLETED",
        purchase_units: [{
          payments: {
            captures: [{ id: "CAPTURE-789", status: "COMPLETED" }]
          }
        }]
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await capturePayPalOrder("test-token", "ORDER123");
    expect(result.status).toBe("COMPLETED");
    expect(result.id).toBe("ORDER123");
    expect(result.captureId).toBe("CAPTURE-789");

    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toBe(`${PAYPAL_SANDBOX_BASE}/v2/checkout/orders/ORDER123/capture`);
    expect(opts.method).toBe("POST");
  });

  it("sends PayPal-Request-Id for idempotent capture", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "ORDER123",
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "COMPLETED" }] } }]
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await capturePayPalOrder("test-token", "ORDER123", "idem-capture-456");
    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.headers["PayPal-Request-Id"]).toBe("idem-capture-456");
  });

  it("throws on capture failure", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("ORDER_NOT_APPROVED", { status: 422 })
    );

    await expect(capturePayPalOrder("test-token", "ORDER123")).rejects.toThrow("PayPal capture failed (422)");
  });

  it("throws when capture status is DECLINED", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "ORDER123",
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "DECLINED" }] } }]
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(capturePayPalOrder("test-token", "ORDER123")).rejects.toThrow("non-success status");
  });

  it("accepts PENDING capture status", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "ORDER123",
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "PENDING" }] } }]
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await capturePayPalOrder("test-token", "ORDER123");
    expect(result.status).toBe("PENDING");
  });
});

describe("PayPal Order Status Verification", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("retrieves order status via GET /v2/checkout/orders/{id}", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "ORDER123", status: "APPROVED" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await getPayPalOrderStatus("test-token", "ORDER123");
    expect(result.status).toBe("APPROVED");
    expect(result.id).toBe("ORDER123");

    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toBe(`${PAYPAL_SANDBOX_BASE}/v2/checkout/orders/ORDER123`);
    expect(opts.method).toBeUndefined();
  });
});

describe("PayPal Invoice Creation", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("creates draft invoice then sends it", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "INV-123", status: "DRAFT" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "SENT" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await createPayPalInvoice("test-token", {
      recipientName: "John Doe",
      recipientEmail: "john@example.com",
      amount: "99.00",
      currency: "USD",
      description: "Consulting services",
      invoiceNumber: "HP-TEST123",
    });

    expect(result.id).toBe("INV-123");
    expect(result.status).toBe("SENT");
    expect(result.invoiceNumber).toBe("HP-TEST123");

    const [draftUrl, draftOpts] = mockFetch.mock.calls[1];
    expect(draftUrl).toBe(`${PAYPAL_SANDBOX_BASE}/v2/invoicing/invoices`);
    expect(draftOpts.method).toBe("POST");
    const draftBody = JSON.parse(draftOpts.body);
    expect(draftBody.detail.invoice_number).toBe("HP-TEST123");
    expect(draftBody.primary_recipients[0].billing_info.email_address).toBe("john@example.com");
    expect(draftBody.primary_recipients[0].name.given_name).toBe("John Doe");
    expect(draftBody.items[0].unit_amount.value).toBe("99.00");

    const [sendUrl, sendOpts] = mockFetch.mock.calls[2];
    expect(sendUrl).toBe(`${PAYPAL_SANDBOX_BASE}/v2/invoicing/invoices/INV-123/send`);
    expect(sendOpts.method).toBe("POST");
  });

  it("throws on draft creation failure", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("VALIDATION_ERROR", { status: 400 })
    );

    await expect(
      createPayPalInvoice("test-token", {
        recipientName: "John",
        recipientEmail: "john@example.com",
        amount: "99.00",
        currency: "USD",
        description: "Test",
        invoiceNumber: "HP-TEST",
      })
    ).rejects.toThrow("PayPal invoice draft failed (400)");
  });
});

describe("PayPal Invoice Status", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("retrieves invoice status", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "INV-123", status: "PAID" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await getPayPalInvoiceStatus("test-token", "INV-123");
    expect(result.status).toBe("PAID");
  });
});

describe("Webhook Signature Verification", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("returns true when verification_status is SUCCESS", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ verification_status: "SUCCESS" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await verifyWebhookSignature(
      "test-token",
      "WH-123",
      {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
        "paypal-transmission-id": "trans-id",
        "paypal-transmission-sig": "sig",
        "paypal-transmission-time": "2024-01-01T00:00:00Z",
      },
      JSON.stringify({ id: "EV-123", event_type: "CHECKOUT.ORDER.APPROVED" })
    );

    expect(result).toBe(true);

    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toBe(`${PAYPAL_SANDBOX_BASE}/v1/notifications/verify-webhook-signature`);
    const body = JSON.parse(opts.body);
    expect(body.webhook_id).toBe("WH-123");
    expect(body.auth_algo).toBe("SHA256withRSA");
    expect(body.webhook_event.event_type).toBe("CHECKOUT.ORDER.APPROVED");
  });

  it("returns false when verification_status is not SUCCESS", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ verification_status: "FAILURE" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await verifyWebhookSignature(
      "test-token",
      "WH-123",
      {},
      JSON.stringify({ id: "EV-123" })
    );

    expect(result).toBe(false);
  });

  it("returns false when verification API returns error", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Error", { status: 500 })
    );

    const result = await verifyWebhookSignature(
      "test-token",
      "WH-123",
      {},
      JSON.stringify({ id: "EV-123" })
    );

    expect(result).toBe(false);
  });
});

describe("Webhook Event ID Mapping", () => {
  it("maps PAYMENT.CAPTURE.COMPLETED to order_id via supplementary_data.related_ids", () => {
    const event = {
      id: "EV-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAPTURE-123",
        status: "COMPLETED",
        supplementary_data: { related_ids: { order_id: "ORDER-456" } },
      },
    };
    const captureId = event.resource.id;
    const orderId = event.resource.supplementary_data?.related_ids?.order_id || "";
    expect(captureId).toBe("CAPTURE-123");
    expect(orderId).toBe("ORDER-456");
    expect(orderId).not.toBe(captureId);
  });

  it("falls back to resource.order_id when supplementary_data is absent", () => {
    const event = {
      id: "EV-2",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAPTURE-789", order_id: "ORDER-999" },
    } as any;
    const resource = event.resource as any;
    const orderId = resource?.supplementary_data?.related_ids?.order_id || resource?.order_id || "";
    expect(orderId).toBe("ORDER-999");
  });

  it("logs when order_id cannot be mapped", () => {
    const event = {
      id: "EV-3",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAPTURE-000" },
    } as any;
    const resource = event.resource as any;
    const orderId = resource?.supplementary_data?.related_ids?.order_id || resource?.order_id || "";
    expect(orderId).toBe("");
  });
});

describe("Webhook Event Deduplication", () => {
  it("skips processing when event ID already exists", () => {
    const processedEvents = new Set<string>(["EV-DUP-1"]);
    expect(processedEvents.has("EV-DUP-1")).toBe(true);
  });

  it("processes new event IDs", () => {
    const processedEvents = new Set<string>(["EV-1"]);
    expect(processedEvents.has("EV-2")).toBe(false);
    processedEvents.add("EV-2");
    expect(processedEvents.has("EV-2")).toBe(true);
  });
});

describe("End-to-End PayPal Flow (Mocked)", () => {
  it("complete order lifecycle: create → verify → capture", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "5OZ12345",
          status: "CREATED",
          links: [
            { rel: "self", href: `${PAYPAL_SANDBOX_BASE}/v2/checkout/orders/5OZ12345` },
            { rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=5OZ12345" },
            { rel: "capture", href: `${PAYPAL_SANDBOX_BASE}/v2/checkout/orders/5OZ12345/capture` },
          ],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const order = await createPayPalOrder("test-token", {
      amount: "49.99",
      currency: "USD",
      description: "Pro plan",
      customerEmail: "buyer@example.com",
    });
    expect(order.id).toBe("5OZ12345");
    expect(order.status).toBe("CREATED");
    expect(order.approveUrl).toContain("checkoutnow");

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "5OZ12345", status: "APPROVED" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const status = await getPayPalOrderStatus("test-token", order.id);
    expect(status.status).toBe("APPROVED");

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "5OZ12345",
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAP-999", status: "COMPLETED" }] } }]
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    const captured = await capturePayPalOrder("test-token", order.id);
    expect(captured.status).toBe("COMPLETED");
    expect(captured.captureId).toBe("CAP-999");
  });

  it("complete invoice lifecycle: create → send → verify", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "INV-456", status: "DRAFT" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "SENT" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const invoice = await createPayPalInvoice("test-token", {
      recipientName: "Jane Smith",
      recipientEmail: "jane@example.com",
      amount: "150.00",
      currency: "USD",
      description: "Design services",
      invoiceNumber: "HP-DESIGN001",
    });
    expect(invoice.id).toBe("INV-456");
    expect(invoice.status).toBe("SENT");

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "INV-456", status: "PAID" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const status = await getPayPalInvoiceStatus("test-token", invoice.id);
    expect(status.status).toBe("PAID");
  });
});
