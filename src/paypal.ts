import { PAYPAL_SANDBOX_BASE } from "./types";

export interface PayPalTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export function clearTokenCache(): void {
  cachedToken = null;
}

export async function getPayPalAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal auth failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as PayPalTokenResponse;
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

export interface CreateOrderInput {
  amount: string;
  currency: string;
  description: string;
  customerEmail: string;
}

export interface PayPalOrderResult {
  id: string;
  status: string;
  approveUrl: string;
}

export async function createPayPalOrder(
  token: string,
  input: CreateOrderInput,
  idempotencyKey?: string,
  returnUrl?: string,
  cancelUrl?: string
): Promise<PayPalOrderResult> {
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        description: input.description,
        amount: {
          currency_code: input.currency,
          value: input.amount,
        },
      },
    ],
    application_context: {
      brand_name: "HelpPuff Commerce",
      user_action: "PAY_NOW",
      shipping_preference: "NO_SHIPPING",
      return_url: returnUrl || "https://helppuff-commerce.workers.dev/orders",
      cancel_url: cancelUrl || "https://helppuff-commerce.workers.dev/orders",
    },
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["PayPal-Request-Id"] = idempotencyKey;
  }

  const res = await fetch(`${PAYPAL_SANDBOX_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal order creation failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: string;
    links: { rel: string; href: string }[];
  };
  const approveLink = data.links?.find((l) => l.rel === "approve")?.href || "";
  return {
    id: data.id,
    status: data.status,
    approveUrl: approveLink,
  };
}

export async function capturePayPalOrder(
  token: string,
  orderId: string,
  idempotencyKey?: string
): Promise<{ status: string; id: string; captureId?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["PayPal-Request-Id"] = idempotencyKey;
  }

  const res = await fetch(
    `${PAYPAL_SANDBOX_BASE}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal capture failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: string;
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{ id: string; status: string }>;
      };
    }>;
  };
  const captureId = data.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  const captureStatus = data.purchase_units?.[0]?.payments?.captures?.[0]?.status;
  if (!captureId || !captureStatus) {
    throw new Error("PayPal capture response lacked a verifiable capture resource");
  }
  const finalStatus = captureStatus;
  if (finalStatus !== "COMPLETED" && finalStatus !== "PENDING") {
    throw new Error(`PayPal capture returned non-success status: ${finalStatus}`);
  }
  return { status: finalStatus, id: orderId, captureId };
}

export async function getPayPalOrderStatus(
  token: string,
  orderId: string
): Promise<{ id: string; status: string }> {
  const res = await fetch(`${PAYPAL_SANDBOX_BASE}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal order lookup failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { id: string; status: string };
  return { id: data.id, status: data.status };
}

export interface CreateInvoiceInput {
  recipientName: string;
  recipientEmail: string;
  amount: string;
  currency: string;
  description: string;
  invoiceNumber: string;
}

export async function createPayPalInvoice(
  token: string,
  input: CreateInvoiceInput,
  idempotencyKey?: string,
): Promise<{ id: string; status: string; invoiceNumber: string }> {
  const draftBody = {
    detail: {
      invoice_number: input.invoiceNumber,
      currency_code: input.currency,
      note: input.description,
      terms_and_conditions: "Payment due within 30 days.",
    },
    invoicer: {
      name: { business_name: "HelpPuff Commerce" },
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: input.recipientEmail,
        },
        name: {
          given_name: input.recipientName,
        },
      },
    ],
    items: [
      {
        name: input.description,
        quantity: "1",
        unit_amount: {
          currency_code: input.currency,
          value: input.amount,
        },
      },
    ],
  };

  const draftRes = await fetch(`${PAYPAL_SANDBOX_BASE}/v2/invoicing/invoices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "PayPal-Request-Id": `${idempotencyKey}-draft` } : {}),
    },
    body: JSON.stringify(draftBody),
  });

  if (!draftRes.ok) {
    const err = await draftRes.text();
    throw new Error(`PayPal invoice draft failed (${draftRes.status}): ${err}`);
  }

  const draftData = (await draftRes.json()) as { id: string };
  const invoiceId = draftData.id;

  const sendRes = await fetch(
    `${PAYPAL_SANDBOX_BASE}/v2/invoicing/invoices/${invoiceId}/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "PayPal-Request-Id": `${idempotencyKey}-send` } : {}),
      },
      body: JSON.stringify({}),
    }
  );

  if (!sendRes.ok) {
    const err = await sendRes.text();
    throw new Error(`PayPal invoice send failed (${sendRes.status}): ${err}`);
  }

  // PayPal's send endpoint often responds with 204 No Content.
  // A successful send must not be classified as failed due to JSON parsing.
  const sendData = (await sendRes.text()).trim();
  const parsedStatus = sendData ? (JSON.parse(sendData) as { status?: string }).status : undefined;
  return {
    id: invoiceId,
    status: parsedStatus || "SENT",
    invoiceNumber: input.invoiceNumber,
  };
}

export async function getPayPalInvoiceStatus(
  token: string,
  invoiceId: string
): Promise<{ id: string; status: string }> {
  const res = await fetch(
    `${PAYPAL_SANDBOX_BASE}/v2/invoicing/invoices/${invoiceId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal invoice lookup failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { id: string; status: string };
  return { id: data.id, status: data.status };
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource: {
    id: string;
    status?: string;
    order_id?: string;
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
}

export async function verifyWebhookSignature(
  token: string,
  webhookId: string,
  headers: Record<string, string>,
  rawBody: string,
): Promise<boolean> {
  const verifyBody = {
    auth_algo: headers["paypal-auth-algo"] || "",
    cert_url: headers["paypal-cert-url"] || "",
    transmission_id: headers["paypal-transmission-id"] || "",
    transmission_sig: headers["paypal-transmission-sig"] || "",
    transmission_time: headers["paypal-transmission-time"] || "",
    webhook_id: webhookId,
    webhook_event: JSON.parse(rawBody),
  };

  const res = await fetch(`${PAYPAL_SANDBOX_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(verifyBody),
  });

  if (!res.ok) return false;

  const data = (await res.json()) as { verification_status: string };
  return data.verification_status === "SUCCESS";
}
