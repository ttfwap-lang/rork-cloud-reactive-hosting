/**
 * Pure rail evaluation rules, decoupled from Durable Object storage and effects.
 */

export type QuietHoursConfig = {
  enabled: boolean;
  start: string;
  end: string;
  timeZone: string;
};

export type RailsConfig = {
  killSwitch: boolean;
  automationEnabled: boolean;
  quietHours: QuietHoursConfig;
  allowlist: string[];
  perChatCooldownMs: number;
};

export type RailEvaluation =
  | { allowed: true }
  | { allowed: false; code: string; reason: string; level: "error" | "warn" | "info" };

export function isWithinQuietHours(config: QuietHoursConfig, date: Date = new Date()): boolean {
  if (!config.enabled) return false;
  try {
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: config.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
    const { start, end } = config;
    return start <= end ? time >= start && time < end : time >= start || time < end;
  } catch {
    return false;
  }
}

export function isAllowlisted(allowlist: string[], chatKey: string, sender: string): boolean {
  if (allowlist.length === 0) return true;
  const normChat = chatKey.replace(/^@/, "").toLowerCase();
  const normSender = sender.replace(/^@/, "").toLowerCase();
  return allowlist.some((item) => {
    const normItem = item.replace(/^@/, "").toLowerCase();
    return item === chatKey || normItem === normSender || normItem === normChat;
  });
}

export function targetsMatch(targets: string[], chatKey: string, sender: string): boolean {
  if (targets.length === 0) return true;
  const normSender = sender.replace(/^@/, "").toLowerCase();
  const normChat = chatKey.replace(/^@/, "").toLowerCase();
  return targets.some((target) => {
    const normalized = target.replace(/^@/, "").toLowerCase();
    return normalized === normSender || normalized === normChat;
  });
}

export function checkCooldown(
  perChatCooldownMs: number,
  workflowCooldownMs: number,
  lastCompletedAt: number | null,
  now: number = Date.now(),
): boolean {
  const cooldown = Math.max(perChatCooldownMs, workflowCooldownMs);
  if (cooldown <= 0 || !lastCompletedAt) return false;
  return now - lastCompletedAt < cooldown;
}

export function checkMaxRuns(maxRunsPerChat: number, currentRunCount: number): boolean {
  if (maxRunsPerChat <= 0) return false;
  return currentRunCount >= maxRunsPerChat;
}

export function evaluateRails(params: {
  rails: RailsConfig;
  bypassLimits: boolean;
  chatKey: string;
  sender: string;
  pausedUntil: number | null;
  workflowCooldownMs: number;
  maxRunsPerChat: number;
  lastCompletedAt: number | null;
  currentRunCount: number;
  now?: number;
  date?: Date;
}): RailEvaluation {
  const { rails, bypassLimits, chatKey, sender, pausedUntil, workflowCooldownMs, maxRunsPerChat, lastCompletedAt, currentRunCount } = params;
  const now = params.now ?? Date.now();
  const date = params.date ?? new Date(now);

  if (rails.killSwitch) {
    return { allowed: false, code: "skip.kill", reason: "Message ignored — the emergency stop is engaged.", level: "error" };
  }

  if (bypassLimits) {
    return { allowed: true };
  }

  if (!rails.automationEnabled) {
    return { allowed: false, code: "skip.global", reason: "Message ignored — global automation is disabled.", level: "warn" };
  }

  if (isWithinQuietHours(rails.quietHours, date)) {
    return { allowed: false, code: "skip.quiet", reason: "Message ignored during configured quiet hours.", level: "info" };
  }

  if (pausedUntil && pausedUntil > now) {
    return { allowed: false, code: "skip.paused", reason: "Message ignored while Telegram automation is paused.", level: "warn" };
  }

  if (!isAllowlisted(rails.allowlist, chatKey, sender)) {
    return { allowed: false, code: "skip.allowlist", reason: "Message ignored because the sender is not allowlisted.", level: "info" };
  }

  if (checkCooldown(rails.perChatCooldownMs, workflowCooldownMs, lastCompletedAt, now)) {
    return { allowed: false, code: "skip.cooldown", reason: "Per-chat cooldown prevented a repeated run.", level: "info" };
  }

  if (checkMaxRuns(maxRunsPerChat, currentRunCount)) {
    return { allowed: false, code: "skip.run_limit", reason: "Workflow reached its per-chat run limit.", level: "warn" };
  }

  return { allowed: true };
}

/**
 * Validates agent patch_settings requests.
 * Specifically enforces that alertChatId is rejected worker-side so the agent cannot silence alarms.
 */
export function validateAgentSettingsPatch(patch: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  if (patch.alertChatId !== undefined) {
    return { ok: false, error: "alertChatId cannot be modified by agent tools" };
  }
  return { ok: true };
}

