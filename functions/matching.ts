/**
 * Pure trigger-matching logic, kept apart from the Durable Object so it can be
 * exercised directly. Nothing here touches storage, the network or the clock,
 * which is what makes a match reproducible: the same step and the same message
 * always produce the same verdict.
 */

export type TriggerMode = "exact" | "contains" | "starts" | "ends" | "regex";
export type ConditionOperator = TriggerMode | "is" | "isNot";

export type MatchResult = { matched: boolean; captures: Record<string, string> };

/** The parts of a condition that decide whether it matches. */
export type MatchableCondition = {
  operator: ConditionOperator;
  value: string;
  caseSensitive: boolean;
  negate: boolean;
};

/** The parts of a step that decide whether it matches. */
export type MatchableStep = {
  trigger: string;
  mode: TriggerMode;
  caseSensitive: boolean;
  conditionLogic: "and" | "or";
};

/** A condition paired with the message field value it was resolved against. */
export type ResolvedCondition = { condition: MatchableCondition; value: string };

const EMPTY: MatchResult = { matched: false, captures: {} };

/**
 * Compares one value against one expectation. Regular expressions may capture,
 * by position and by name; every other operator matches without capturing.
 *
 * An invalid regular expression fails closed rather than throwing, so a typo in
 * one step can never take the whole message pipeline down.
 */
export function compare(value: string, expected: string, operator: ConditionOperator, caseSensitive: boolean): MatchResult {
  const haystack = caseSensitive ? value : value.toLowerCase();
  const needle = caseSensitive ? expected : expected.toLowerCase();

  if (operator === "regex") {
    try {
      const match = new RegExp(expected, caseSensitive ? "" : "i").exec(value);
      if (!match) return { matched: false, captures: {} };
      const captures: Record<string, string> = {};
      match.forEach((capture, index) => {
        if (index > 0 && capture !== undefined) captures[String(index)] = capture;
      });
      for (const [name, capture] of Object.entries(match.groups ?? {})) {
        if (capture !== undefined) captures[name] = capture;
      }
      return { matched: true, captures };
    } catch {
      return { matched: false, captures: {} };
    }
  }

  const matched = operator === "exact" || operator === "is"
    ? haystack.trim() === needle.trim()
    : operator === "isNot"
      ? haystack.trim() !== needle.trim()
      : operator === "contains"
        ? haystack.includes(needle)
        : operator === "starts"
          ? haystack.startsWith(needle)
          : operator === "ends"
            ? haystack.endsWith(needle)
            : false;

  return { matched, captures: {} };
}

/**
 * Decides whether a step fires for a message. The trigger is always evaluated;
 * extra conditions are combined with it under the step's own AND/OR rule, so a
 * single OR condition can carry the step even when the trigger itself missed.
 *
 * Captures are collected only from the parts that actually matched, and only
 * when the step as a whole matched, so a failed run never leaks a half-filled
 * variable into a reply.
 */
export function matchesStep(step: MatchableStep, text: string, conditions: ResolvedCondition[]): MatchResult {
  const primary = compare(text, step.trigger, step.mode, step.caseSensitive);
  const results = [primary, ...conditions.map(({ condition, value }) => {
    const result = compare(value, condition.value, condition.operator, condition.caseSensitive);
    return condition.negate ? { matched: !result.matched, captures: {} } : result;
  })];

  const matched = step.conditionLogic === "or"
    ? results.some((result) => result.matched)
    : results.every((result) => result.matched);

  const captures = matched
    ? Object.assign({}, ...results.filter((result) => result.matched).map((result) => result.captures)) as Record<string, string>
    : {};

  return { matched, captures };
}

/**
 * Fills `{name}` placeholders from captured values. An unknown placeholder
 * becomes empty rather than being left visible, so a missing capture can never
 * send literal braces to a real conversation.
 */
export function substitute(template: string, variables: Record<string, string>, maxChars: number): string {
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => variables[key] ?? "").slice(0, maxChars);
}

export { EMPTY as EMPTY_MATCH };
