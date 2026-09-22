/**
 * Pure workflow step-advancement and looping logic.
 */

export const NEVER_EXPIRES = 8_640_000_000_000;

export type StepAdvancementInput = {
  stepIndex: number;
  totalSteps: number;
  actionType: string;
  loopTo: number | null;
  maxLoops: number;
  timeoutMs: number;
  currentLoopCount: number;
  bypassLimits: boolean;
  now?: number;
};

export type StepAdvancementDecision =
  | {
      outcome: "advance";
      nextIndex: number;
      loopCount: number;
      expiresAt: number;
    }
  | {
      outcome: "loop_limit";
      reason: string;
    }
  | {
      outcome: "complete";
      reason: string;
    };

export function computeNextStep(input: StepAdvancementInput): StepAdvancementDecision {
  const {
    stepIndex,
    totalSteps,
    actionType,
    loopTo,
    maxLoops,
    timeoutMs,
    currentLoopCount,
    bypassLimits,
  } = input;
  const now = input.now ?? Date.now();

  const nextIndex = loopTo !== null ? loopTo : stepIndex + 1;
  const loopCount = loopTo !== null ? currentLoopCount + 1 : 0;

  if (loopTo !== null && loopCount > maxLoops) {
    return {
      outcome: "loop_limit",
      reason: "Workflow stopped at its maximum loop count.",
    };
  }

  if (nextIndex < totalSteps && actionType !== "end") {
    const expiresAt = bypassLimits ? NEVER_EXPIRES : now + timeoutMs;
    return {
      outcome: "advance",
      nextIndex,
      loopCount,
      expiresAt,
    };
  }

  return {
    outcome: "complete",
    reason: "Workflow completed.",
  };
}
