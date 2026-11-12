export interface ActionProposal {
  action_type: "create_order" | "create_invoice" | "capture_order";
  description: string;
  payload: Record<string, unknown>;
}

export interface ParsedAIResponse {
  cleanResponse: string;
  proposal: ActionProposal | null;
}

const ACTION_START = "[ACTION_PROPOSAL]";
const ACTION_END = "[/ACTION_PROPOSAL]";

export function parseActionProposal(response: string): ParsedAIResponse {
  const startIdx = response.indexOf(ACTION_START);
  if (startIdx === -1) return { cleanResponse: response.trim(), proposal: null };

  const endIdx = response.indexOf(ACTION_END, startIdx + ACTION_START.length);
  if (endIdx === -1) return { cleanResponse: response.trim(), proposal: null };

  const jsonStr = response.slice(startIdx + ACTION_START.length, endIdx).trim();
  const before = response.slice(0, startIdx).trim();
  const after = response.slice(endIdx + ACTION_END.length).trim();
  const cleanResponse = (before + (after ? "\n" + after : "")).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.action_type || !parsed.description) {
      return { cleanResponse, proposal: null };
    }
    return {
      cleanResponse,
      proposal: {
        action_type: parsed.action_type,
        description: parsed.description,
        payload: parsed.payload || {},
      },
    };
  } catch {
    return { cleanResponse, proposal: null };
  }
}

export function generateIdempotencyKey(): string {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
