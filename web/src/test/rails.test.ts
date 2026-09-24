import { describe, expect, it } from "vitest";

import {
  checkCooldown,
  checkMaxRuns,
  evaluateRails,
  isAllowlisted,
  isWithinQuietHours,
  targetsMatch,
  validateAgentSettingsPatch,
  type QuietHoursConfig,
  type RailsConfig,
} from "../../../functions/rails";

describe("isWithinQuietHours", () => {
  it("returns false if quiet hours are disabled", () => {
    const config: QuietHoursConfig = {
      enabled: false,
      start: "22:00",
      end: "08:00",
      timeZone: "UTC",
    };
    expect(isWithinQuietHours(config, new Date("2026-09-23T23:00:00Z"))).toBe(false);
  });

  it("handles same-day quiet window (e.g. 13:00 to 15:00)", () => {
    const config: QuietHoursConfig = {
      enabled: true,
      start: "13:00",
      end: "15:00",
      timeZone: "UTC",
    };
    expect(isWithinQuietHours(config, new Date("2026-09-23T14:00:00Z"))).toBe(true);
    expect(isWithinQuietHours(config, new Date("2026-09-23T12:59:00Z"))).toBe(false);
    expect(isWithinQuietHours(config, new Date("2026-09-23T15:00:00Z"))).toBe(false);
  });

  it("handles overnight wrap-around window (e.g. 22:00 to 07:00)", () => {
    const config: QuietHoursConfig = {
      enabled: true,
      start: "22:00",
      end: "07:00",
      timeZone: "UTC",
    };
    expect(isWithinQuietHours(config, new Date("2026-09-23T23:30:00Z"))).toBe(true);
    expect(isWithinQuietHours(config, new Date("2026-09-23T04:00:00Z"))).toBe(true);
    expect(isWithinQuietHours(config, new Date("2026-09-23T12:00:00Z"))).toBe(false);
  });
});

describe("isAllowlisted", () => {
  it("allows everything if allowlist is empty", () => {
    expect(isAllowlisted([], "12345", "user1")).toBe(true);
  });

  it("matches chatKey or sender case-insensitively with @ stripping", () => {
    const list = ["@Alice", "987654"];
    expect(isAllowlisted(list, "987654", "bob")).toBe(true);
    expect(isAllowlisted(list, "111", "alice")).toBe(true);
    expect(isAllowlisted(list, "111", "@alice")).toBe(true);
    expect(isAllowlisted(list, "111", "charlie")).toBe(false);
  });
});

describe("targetsMatch", () => {
  it("matches all if targets list is empty", () => {
    expect(targetsMatch([], "chat1", "sender1")).toBe(true);
  });

  it("matches target against sender or chatKey case-insensitively", () => {
    const targets = ["@BotUser", "chat_group"];
    expect(targetsMatch(targets, "123", "botuser")).toBe(true);
    expect(targetsMatch(targets, "chat_group", "human")).toBe(true);
    expect(targetsMatch(targets, "other_chat", "other_sender")).toBe(false);
  });
});

describe("checkCooldown and checkMaxRuns", () => {
  it("returns true when within cooldown period", () => {
    const now = 1_000_000;
    expect(checkCooldown(10_000, 0, now - 5_000, now)).toBe(true);
    expect(checkCooldown(10_000, 0, now - 15_000, now)).toBe(false);
    expect(checkCooldown(0, 20_000, now - 15_000, now)).toBe(true);
  });

  it("returns true when currentRunCount reaches maxRunsPerChat", () => {
    expect(checkMaxRuns(5, 5)).toBe(true);
    expect(checkMaxRuns(5, 6)).toBe(true);
    expect(checkMaxRuns(5, 4)).toBe(false);
    expect(checkMaxRuns(0, 100)).toBe(false); // 0 means unlimited
  });
});

describe("evaluateRails", () => {
  const defaultRails: RailsConfig = {
    killSwitch: false,
    automationEnabled: true,
    quietHours: { enabled: false, start: "22:00", end: "08:00", timeZone: "UTC" },
    allowlist: [],
    perChatCooldownMs: 0,
  };

  it("fails on killSwitch", () => {
    const res = evaluateRails({
      rails: { ...defaultRails, killSwitch: true },
      bypassLimits: false,
      chatKey: "123",
      sender: "test",
      pausedUntil: null,
      workflowCooldownMs: 0,
      maxRunsPerChat: 0,
      lastCompletedAt: null,
      currentRunCount: 0,
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.code).toBe("skip.kill");
    }
  });

  it("bypasses other limits when bypassLimits is true", () => {
    const res = evaluateRails({
      rails: { ...defaultRails, automationEnabled: false, allowlist: ["only_me"] },
      bypassLimits: true,
      chatKey: "123",
      sender: "not_me",
      pausedUntil: Date.now() + 100_000,
      workflowCooldownMs: 10_000,
      maxRunsPerChat: 1,
      lastCompletedAt: Date.now(),
      currentRunCount: 5,
    });
    expect(res.allowed).toBe(true);
  });

  it("blocks when global automation is disabled", () => {
    const res = evaluateRails({
      rails: { ...defaultRails, automationEnabled: false },
      bypassLimits: false,
      chatKey: "123",
      sender: "test",
      pausedUntil: null,
      workflowCooldownMs: 0,
      maxRunsPerChat: 0,
      lastCompletedAt: null,
      currentRunCount: 0,
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.code).toBe("skip.global");
    }
  });

  it("allows when all conditions are clean", () => {
    const res = evaluateRails({
      rails: defaultRails,
      bypassLimits: false,
      chatKey: "123",
      sender: "test",
      pausedUntil: null,
      workflowCooldownMs: 0,
      maxRunsPerChat: 0,
      lastCompletedAt: null,
      currentRunCount: 0,
    });
    expect(res.allowed).toBe(true);
  });
});

describe("validateAgentSettingsPatch", () => {
  it("rejects alertChatId modification with error", () => {
    const res = validateAgentSettingsPatch({ alertChatId: "@my_channel" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("alertChatId cannot be modified by agent tools");
    }
  });

  it("accepts other safety settings modifications", () => {
    const res = validateAgentSettingsPatch({ killSwitch: true, automationEnabled: false, perMinuteCap: 10 });
    expect(res.ok).toBe(true);
  });
});

