import { describe, expect, it } from "vitest";

import { computeNextStep, NEVER_EXPIRES } from "../../../functions/step-logic";

describe("computeNextStep", () => {
  it("advances linearly to next step when loopTo is null", () => {
    const decision = computeNextStep({
      stepIndex: 0,
      totalSteps: 3,
      actionType: "sendText",
      loopTo: null,
      maxLoops: 10,
      timeoutMs: 60_000,
      currentLoopCount: 0,
      bypassLimits: false,
      now: 10_000,
    });
    expect(decision.outcome).toBe("advance");
    if (decision.outcome === "advance") {
      expect(decision.nextIndex).toBe(1);
      expect(decision.loopCount).toBe(0);
      expect(decision.expiresAt).toBe(70_000);
    }
  });

  it("sets NEVER_EXPIRES for bypassLimits", () => {
    const decision = computeNextStep({
      stepIndex: 1,
      totalSteps: 4,
      actionType: "sendText",
      loopTo: null,
      maxLoops: 10,
      timeoutMs: 60_000,
      currentLoopCount: 0,
      bypassLimits: true,
      now: 10_000,
    });
    expect(decision.outcome).toBe("advance");
    if (decision.outcome === "advance") {
      expect(decision.expiresAt).toBe(NEVER_EXPIRES);
    }
  });

  it("loops back to specified index and increments loopCount", () => {
    const decision = computeNextStep({
      stepIndex: 2,
      totalSteps: 3,
      actionType: "pressButton",
      loopTo: 0,
      maxLoops: 5,
      timeoutMs: 30_000,
      currentLoopCount: 2,
      bypassLimits: false,
      now: 5_000,
    });
    expect(decision.outcome).toBe("advance");
    if (decision.outcome === "advance") {
      expect(decision.nextIndex).toBe(0);
      expect(decision.loopCount).toBe(3);
      expect(decision.expiresAt).toBe(35_000);
    }
  });

  it("stops at loop limit when loopCount > maxLoops", () => {
    const decision = computeNextStep({
      stepIndex: 2,
      totalSteps: 3,
      actionType: "pressButton",
      loopTo: 0,
      maxLoops: 5,
      timeoutMs: 30_000,
      currentLoopCount: 5, // next will be 6 > 5
      bypassLimits: false,
      now: 5_000,
    });
    expect(decision.outcome).toBe("loop_limit");
  });

  it("completes workflow on end action", () => {
    const decision = computeNextStep({
      stepIndex: 1,
      totalSteps: 5,
      actionType: "end",
      loopTo: null,
      maxLoops: 5,
      timeoutMs: 30_000,
      currentLoopCount: 0,
      bypassLimits: false,
      now: 5_000,
    });
    expect(decision.outcome).toBe("complete");
  });

  it("completes workflow when reaching last step without loop", () => {
    const decision = computeNextStep({
      stepIndex: 2,
      totalSteps: 3,
      actionType: "sendText",
      loopTo: null,
      maxLoops: 5,
      timeoutMs: 30_000,
      currentLoopCount: 0,
      bypassLimits: false,
      now: 5_000,
    });
    expect(decision.outcome).toBe("complete");
  });
});
