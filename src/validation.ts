export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateAmount(amount: string): boolean {
  const n = parseFloat(amount);
  return !isNaN(n) && n > 0 && /^\d+(\.\d{1,2})?$/.test(amount);
}

export function validateCurrency(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency);
}

export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (input == null) return "undefined";
  return String(input).slice(0, maxLength);
}

export interface OrderInput {
  amount: string;
  currency: string;
  description: string;
  customerEmail: string;
}

export function validateOrderInput(input: Partial<OrderInput>): { valid: boolean; errors: string[]; data?: OrderInput } {
  const errors: string[] = [];
  if (!input.amount || !validateAmount(input.amount)) errors.push("Valid amount is required (e.g., 29.99)");
  if (!input.description || input.description.trim().length === 0) errors.push("Description is required");
  if (!input.customerEmail || !validateEmail(input.customerEmail)) errors.push("Valid customer email is required");
  const currency = input.currency || "USD";
  if (!validateCurrency(currency)) errors.push("Valid 3-letter currency code is required (e.g., USD)");

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    data: {
      amount: input.amount!,
      currency,
      description: input.description!.trim(),
      customerEmail: input.customerEmail!,
    },
  };
}

export interface InvoiceInput {
  recipientName: string;
  recipientEmail: string;
  amount: string;
  currency: string;
  description: string;
}

export function validateInvoiceInput(input: Partial<InvoiceInput>): { valid: boolean; errors: string[]; data?: InvoiceInput } {
  const errors: string[] = [];
  if (!input.amount || !validateAmount(input.amount)) errors.push("Valid amount is required (e.g., 99.00)");
  if (!input.description || input.description.trim().length === 0) errors.push("Description is required");
  if (!input.recipientName || input.recipientName.trim().length === 0) errors.push("Recipient name is required");
  if (!input.recipientEmail || !validateEmail(input.recipientEmail)) errors.push("Valid recipient email is required");
  const currency = input.currency || "USD";
  if (!validateCurrency(currency)) errors.push("Valid 3-letter currency code is required (e.g., USD)");

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    data: {
      amount: input.amount!,
      currency,
      description: input.description!.trim(),
      recipientName: input.recipientName!.trim(),
      recipientEmail: input.recipientEmail!,
    },
  };
}

export function validateActionProposal(proposal: { action_type: string; description: string; payload: any }): {
  valid: boolean;
  errors: string[];
  data?: { action_type: "create_order" | "create_invoice" | "capture_order"; description: string; payload: any };
} {
  const errors: string[] = [];
  const validTypes = ["create_order", "create_invoice", "capture_order"];
  if (!validTypes.includes(proposal.action_type)) {
    errors.push(`Invalid action_type: ${proposal.action_type}`);
  }
  if (!proposal.description || proposal.description.trim().length === 0) {
    errors.push("Description is required");
  }

  if (proposal.action_type === "create_order") {
    const result = validateOrderInput(proposal.payload || {});
    if (!result.valid) errors.push(...result.errors);
  } else if (proposal.action_type === "create_invoice") {
    const result = validateInvoiceInput(proposal.payload || {});
    if (!result.valid) errors.push(...result.errors);
  } else if (proposal.action_type === "capture_order") {
    if (!proposal.payload?.paypalOrderId) errors.push("paypalOrderId is required for capture_order");
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    data: {
      action_type: proposal.action_type as "create_order" | "create_invoice" | "capture_order",
      description: proposal.description.trim(),
      payload: proposal.payload,
    },
  };
}
