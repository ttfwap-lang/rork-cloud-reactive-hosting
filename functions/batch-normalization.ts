export type WorkflowActionType =
  | "sendText"
  | "pressButton"
  | "react"
  | "markRead"
  | "forward"
  | "end";

export type NormalizedBatchActionPayload = {
  actionType: WorkflowActionType;
  text?: string;
  buttonTarget?: string;
  reaction?: string;
  messageId?: string | null;
  target?: string;
  fromChatKey?: string;
  idempotencyKey?: string;
};

/**
 * Pure payload-normalization helper for batch execution.
 * Inspects nested `item.payload.*` first (planner format), then falls back to legacy top-level fields.
 */
export function normalizeBatchActionPayload(
  rawItem: Record<string, unknown>,
  actionType: WorkflowActionType,
  itemId?: string,
): NormalizedBatchActionPayload {
  const nested =
    rawItem && typeof rawItem.payload === "object" && rawItem.payload !== null
      ? (rawItem.payload as Record<string, unknown>)
      : {};

  // For text/reply (sendText):
  const rawText = nested.text ?? rawItem.text ?? nested.reply ?? rawItem.reply;
  const text = typeof rawText === "string" && rawText !== "" ? rawText : undefined;

  // For buttonTarget (pressButton):
  const rawButton = nested.buttonTarget ?? rawItem.buttonTarget;
  const buttonTarget = typeof rawButton === "string" && rawButton !== "" ? rawButton : undefined;

  // For reaction (react):
  const rawReaction = nested.reaction ?? rawItem.reaction;
  const reaction = typeof rawReaction === "string" && rawReaction !== "" ? rawReaction : undefined;

  // For forward target / source:
  const rawTarget = nested.target ?? rawItem.target ?? nested.toChatKey ?? rawItem.toChatKey ?? nested.toPeer ?? rawItem.toPeer;
  const target = typeof rawTarget === "string" && rawTarget !== "" ? rawTarget : undefined;

  const rawFromChatKey = nested.fromChatKey ?? rawItem.fromChatKey ?? nested.source ?? rawItem.source ?? nested.fromPeer ?? rawItem.fromPeer;
  const fromChatKey = typeof rawFromChatKey === "string" && rawFromChatKey !== "" ? rawFromChatKey : undefined;

  // For messageId:
  const rawMsgId = nested.messageId ?? rawItem.messageId;
  const messageId = rawMsgId !== undefined && rawMsgId !== null ? String(rawMsgId) : null;

  return {
    actionType,
    text,
    buttonTarget,
    reaction,
    target,
    fromChatKey,
    messageId,
    idempotencyKey: itemId,
  };
}
