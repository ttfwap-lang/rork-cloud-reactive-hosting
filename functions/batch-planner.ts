/**
 * Pure natural language batch planner and Cartesian expansion engine.
 * Converts plain English requests into concrete, expanded batch execution plans.
 */

import type { WorkflowActionType } from "./engine";

export type BatchPlanItem = {
  id?: string;
  target: string;
  actionType: WorkflowActionType;
  payload: {
    text?: string;
    buttonTarget?: string;
    reaction?: string;
    messageId?: string;
  };
  description: string;
};

export type BatchPlan = {
  name: string;
  summary: string;
  totalItems: number;
  totalActions: number;
  estimatedSeconds: number;
  items: BatchPlanItem[];
};

export const ZODIAC_SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer",
  "Leo", "Virgo", "Libra", "Scorpio",
  "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];

/**
 * Expands targets and commands/items into sequential batch items.
 */
export function expandBatchPlan(options: {
  name: string;
  targets: string[];
  initialCommands?: string[];
  subItems?: string[];
  actionsPerItem?: number;
  minGapMs?: number;
  perMinuteCap?: number;
}): BatchPlan {
  const {
    name,
    targets,
    initialCommands = [],
    subItems = [],
    actionsPerItem = 1,
    minGapMs = 1500,
    perMinuteCap = 20,
  } = options;

  const items: BatchPlanItem[] = [];

  for (const target of targets) {
    // 1. Initial command(s) per target if specified (e.g. /start)
    for (const cmd of initialCommands) {
      items.push({
        target,
        actionType: "sendText",
        payload: { text: cmd },
        description: `Send "${cmd}" to ${target}`,
      });
    }

    // 2. Sub-items for target (e.g. 12 horoscope signs)
    for (const sub of subItems) {
      items.push({
        target,
        actionType: "sendText",
        payload: { text: sub },
        description: `Send "${sub}" to ${target}`,
      });
    }
  }

  // If no initialCommands and no subItems, but targets given, add a default probe
  if (items.length === 0 && targets.length > 0) {
    for (const target of targets) {
      items.push({
        target,
        actionType: "sendText",
        payload: { text: "/start" },
        description: `Send "/start" to ${target}`,
      });
    }
  }

  const totalItems = items.length;
  const totalActions = totalItems * actionsPerItem;

  // Pacing arithmetic: interval is max(minGapMs, 60_000 / perMinuteCap)
  const slotGapSeconds = Math.max(minGapMs / 1000, 60 / perMinuteCap);
  const estimatedSeconds = Math.ceil(totalActions * slotGapSeconds);

  let summary = `${targets.length} bot${targets.length === 1 ? "" : "s"}`;
  if (subItems.length > 0) {
    summary += ` × ${subItems.length} items = ${totalItems} items, ${totalActions} actions`;
  } else {
    summary += ` = ${totalItems} items, ${totalActions} actions`;
  }

  return {
    name,
    summary,
    totalItems,
    totalActions,
    estimatedSeconds,
    items,
  };
}

/**
 * Natural language parser turning plain English instructions into an expanded batch plan.
 */
export function parseNaturalLanguagePlan(prompt: string, options?: { minGapMs?: number; perMinuteCap?: number }): BatchPlan {
  const text = prompt.trim();
  const lower = text.toLowerCase();

  // Extract all @mentions or target IDs
  const targetMatches = text.match(/@[a-zA-Z0-9_]{3,32}/g) || [];
  const targets = Array.from(new Set(targetMatches));

  // If no @targets found in text, look for common default names
  if (targets.length === 0) {
    if (lower.includes("joe") || lower.includes("joefortune")) {
      targets.push("@joefortune");
    } else {
      targets.push("@target_bot");
    }
  }

  // Check for horoscope / zodiac sign mention
  const hasZodiac = lower.includes("sign") || lower.includes("zodiac") || lower.includes("horoscope") || lower.includes("aries");

  // Check for specific commands
  const initialCommands: string[] = [];
  const slashMatches = text.match(/\/[a-zA-Z0-9_]+/g);
  if (slashMatches) {
    for (const cmd of slashMatches) {
      if (!initialCommands.includes(cmd)) initialCommands.push(cmd);
    }
  } else if (lower.includes("start")) {
    initialCommands.push("/start");
  }

  const subItems: string[] = [];
  if (hasZodiac) {
    subItems.push(...ZODIAC_SIGNS);
  }

  // Determine actions per item (e.g. send + button or check)
  let actionsPerItem = 1;
  if (lower.includes("2 actions") || (initialCommands.length > 0 && subItems.length > 0)) {
    // Each target gets initial command + subitems
    actionsPerItem = 1;
  }

  const name = targets.length > 1
    ? `Batch Run for ${targets.length} bots (${targets.join(", ")})`
    : `Batch Run for ${targets[0]}`;

  return expandBatchPlan({
    name,
    targets,
    initialCommands,
    subItems,
    actionsPerItem,
    minGapMs: options?.minGapMs ?? 1500,
    perMinuteCap: options?.perMinuteCap ?? 20,
  });
}
