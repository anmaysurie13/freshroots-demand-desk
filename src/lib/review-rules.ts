// Pure review rules, shared by the server and the Reject panel so both agree on what can be saved.

export const FLAG_TYPES = ["HIGH_DEMAND", "STOCKOUT_RISK", "OVERSTOCK_RISK"] as const;
export const FINAL_ACTIONS = ["REORDER", "PAUSE_ORDER", "NO_ACTION"] as const;
export const REASON_CODES = [
  "WRONG_QUANTITY",
  "WRONG_ACTION",
  "WRONG_FLAG",
  "DATA_LOOKS_WRONG",
  "MARKET_EVENT",
  "NEW_LAUNCH_OR_DISTRIBUTOR_CHANGE",
  "OTHER",
] as const;

export const REASON_LABELS: Record<(typeof REASON_CODES)[number], string> = {
  WRONG_QUANTITY: "Wrong quantity",
  WRONG_ACTION: "Wrong action",
  WRONG_FLAG: "Wrong flag",
  DATA_LOOKS_WRONG: "Data looks wrong",
  MARKET_EVENT: "Market event",
  NEW_LAUNCH_OR_DISTRIBUTOR_CHANGE: "New launch or distributor change",
  OTHER: "Other (explain)",
};

export type FinalAction = (typeof FINAL_ACTIONS)[number];

export interface AiBasis {
  action: string;
  quantity: number;
  flagTypes: string[];
}

export interface ReviewRequest {
  outcome: "accepted" | "rejected";
  finalFlagTypes?: string[];
  finalAction?: string;
  finalQty?: number;
  reasonCode?: string;
  reasonText?: string;
}

export interface FinalDecision {
  action: FinalAction;
  qty: number;
  flagTypes: string[];
  isReversal: boolean;
  reasonCode: string | null;
  reasonText: string | null;
}

export type ReviewCheck = { ok: true; final: FinalDecision } | { ok: false; error: string };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function checkReview(ai: AiBasis, req: ReviewRequest): ReviewCheck {
  if (req.outcome === "accepted") {
    return {
      ok: true,
      final: {
        action: ai.action as FinalAction,
        qty: ai.quantity,
        flagTypes: ai.flagTypes,
        isReversal: false,
        reasonCode: null,
        reasonText: null,
      },
    };
  }
  if (req.outcome !== "rejected") return { ok: false, error: "Outcome must be accepted or rejected." };

  if (!req.reasonCode || !(REASON_CODES as readonly string[]).includes(req.reasonCode)) {
    return { ok: false, error: "A rejection needs a reason code." };
  }
  const text = (req.reasonText ?? "").trim();
  if (req.reasonCode === "OTHER" && text.length < 3) return { ok: false, error: "Explain the reason when you choose Other." };

  const flagTypes = [...new Set(req.finalFlagTypes ?? ai.flagTypes)];
  if (!flagTypes.every((f) => (FLAG_TYPES as readonly string[]).includes(f))) return { ok: false, error: "Unknown flag type." };

  const action = req.finalAction as FinalAction;
  if (!(FINAL_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: "Choose REORDER, PAUSE_ORDER or NO_ACTION." };

  const qty = req.finalQty;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0) return { ok: false, error: "Quantity must be a whole number of 0 or more." };
  if (action === "REORDER" && qty <= 0) return { ok: false, error: "A reorder needs a quantity above 0." };
  if (action !== "REORDER" && qty !== 0) return { ok: false, error: "Quantity must be 0 unless the action is REORDER." };

  const changed = action !== ai.action || qty !== ai.quantity || !sameSet(flagTypes, ai.flagTypes);
  if (!changed) return { ok: false, error: "Change the flag, action or quantity before rejecting. Nothing differs from the AI decision." };

  return {
    ok: true,
    final: {
      action,
      qty,
      flagTypes,
      isReversal: action !== ai.action || qty !== ai.quantity,
      reasonCode: req.reasonCode,
      reasonText: text || null,
    },
  };
}
