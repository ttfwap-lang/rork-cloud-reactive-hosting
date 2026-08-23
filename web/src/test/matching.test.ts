import { describe, expect, it } from "vitest";

import {
  compare,
  matchesStep,
  substitute,
  type MatchableCondition,
  type MatchableStep,
  type ResolvedCondition,
} from "../../../functions/matching";

const step = (overrides: Partial<MatchableStep> = {}): MatchableStep => ({
  trigger: "hello",
  mode: "contains",
  caseSensitive: false,
  conditionLogic: "and",
  ...overrides,
});

const condition = (overrides: Partial<MatchableCondition> = {}): MatchableCondition => ({
  operator: "is",
  value: "true",
  caseSensitive: false,
  negate: false,
  ...overrides,
});

const on = (value: string, overrides: Partial<MatchableCondition> = {}): ResolvedCondition => ({
  condition: condition(overrides),
  value,
});

describe("compare", () => {
  it("matches an exact trigger only when the whole message is that trigger", () => {
    expect(compare("balance", "balance", "exact", false).matched).toBe(true);
    expect(compare("my balance", "balance", "exact", false).matched).toBe(false);
  });

  it("ignores surrounding whitespace on exact matches", () => {
    expect(compare("  balance  ", "balance", "exact", false).matched).toBe(true);
  });

  it("matches a substring for contains, but not a message that lacks it", () => {
    expect(compare("what is my balance?", "balance", "contains", false).matched).toBe(true);
    expect(compare("what is my total?", "balance", "contains", false).matched).toBe(false);
  });

  it("anchors starts and ends to the right edge of the message", () => {
    expect(compare("/spin now", "/spin", "starts", false).matched).toBe(true);
    expect(compare("now /spin", "/spin", "starts", false).matched).toBe(false);
    expect(compare("now /spin", "/spin", "ends", false).matched).toBe(true);
    expect(compare("/spin now", "/spin", "ends", false).matched).toBe(false);
  });

  it("folds case by default and respects it when asked", () => {
    expect(compare("BALANCE", "balance", "exact", false).matched).toBe(true);
    expect(compare("BALANCE", "balance", "exact", true).matched).toBe(false);
  });

  it("treats isNot as the inverse of is", () => {
    expect(compare("incoming", "outgoing", "isNot", false).matched).toBe(true);
    expect(compare("incoming", "incoming", "isNot", false).matched).toBe(false);
  });

  it("captures regex groups by position", () => {
    const result = compare("you won 250 coins", "won (\\d+) coins", "regex", false);
    expect(result.matched).toBe(true);
    expect(result.captures["1"]).toBe("250");
  });

  it("captures named regex groups under their name", () => {
    const result = compare("you won 250 coins", "won (?<amount>\\d+)", "regex", false);
    expect(result.matched).toBe(true);
    expect(result.captures.amount).toBe("250");
  });

  it("fails closed on an invalid regular expression instead of throwing", () => {
    expect(() => compare("anything", "([unclosed", "regex", false)).not.toThrow();
    expect(compare("anything", "([unclosed", "regex", false).matched).toBe(false);
  });

  it("captures nothing for non-regex operators", () => {
    expect(compare("hello there", "hello", "contains", false).captures).toEqual({});
  });
});

describe("matchesStep", () => {
  it("fires when the trigger matches and there are no extra conditions", () => {
    expect(matchesStep(step(), "well hello there", []).matched).toBe(true);
  });

  it("does not fire when the trigger misses", () => {
    expect(matchesStep(step(), "goodbye", []).matched).toBe(false);
  });

  it("requires every condition under and-logic", () => {
    const conditions = [on("true"), on("false")];
    expect(matchesStep(step(), "hello", conditions).matched).toBe(false);
    expect(matchesStep(step(), "hello", [on("true"), on("true")]).matched).toBe(true);
  });

  it("accepts a single satisfied condition under or-logic", () => {
    const conditions = [on("false"), on("true")];
    expect(matchesStep(step({ conditionLogic: "or" }), "hello", conditions).matched).toBe(true);
  });

  it("can fire under or-logic even when the trigger itself missed", () => {
    expect(matchesStep(step({ conditionLogic: "or" }), "goodbye", [on("true")]).matched).toBe(true);
  });

  it("does not fire under or-logic when the trigger and every condition miss", () => {
    expect(matchesStep(step({ conditionLogic: "or" }), "goodbye", [on("false")]).matched).toBe(false);
  });

  it("inverts a negated condition", () => {
    expect(matchesStep(step(), "hello", [on("false", { negate: true })]).matched).toBe(true);
    expect(matchesStep(step(), "hello", [on("true", { negate: true })]).matched).toBe(false);
  });

  it("carries captures out of a matched regex trigger", () => {
    const result = matchesStep(step({ trigger: "won (\\d+)", mode: "regex" }), "you won 250", []);
    expect(result.captures["1"]).toBe("250");
  });

  it("returns no captures at all when the step did not match", () => {
    const result = matchesStep(
      step({ trigger: "won (\\d+)", mode: "regex" }),
      "you won 250",
      [on("false")],
    );
    expect(result.matched).toBe(false);
    expect(result.captures).toEqual({});
  });
});

describe("substitute", () => {
  it("fills a placeholder from the captured values", () => {
    expect(substitute("You won {amount}!", { amount: "250" }, 4096)).toBe("You won 250!");
  });

  it("empties an unknown placeholder rather than leaving braces visible", () => {
    expect(substitute("You won {missing}!", {}, 4096)).toBe("You won !");
  });

  it("fills several placeholders in one template", () => {
    expect(substitute("{a} then {b}", { a: "one", b: "two" }, 4096)).toBe("one then two");
  });

  it("truncates to the reply ceiling so an oversized reply is never sent", () => {
    expect(substitute("{long}", { long: "x".repeat(50) }, 10)).toHaveLength(10);
  });

  it("leaves a template with no placeholders untouched", () => {
    expect(substitute("plain reply", { a: "one" }, 4096)).toBe("plain reply");
  });
});
