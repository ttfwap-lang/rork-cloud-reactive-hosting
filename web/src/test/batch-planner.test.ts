import { describe, expect, it } from "vitest";
import {
  expandBatchPlan,
  parseNaturalLanguagePlan,
  ZODIAC_SIGNS,
} from "../../../functions/batch-planner";

describe("expandBatchPlan", () => {
  it("expands 3 bots × 12 signs = 36 items exactly", () => {
    const targets = ["@astro1", "@astro2", "@astro3"];
    const plan = expandBatchPlan({
      name: "Zodiac Signs Run",
      targets,
      subItems: ZODIAC_SIGNS,
      minGapMs: 1500,
      perMinuteCap: 20,
    });

    expect(plan.totalItems).toBe(36);
    expect(plan.totalActions).toBe(36);
    expect(plan.items.length).toBe(36);
    expect(plan.summary).toContain("3 bots × 12 items = 36 items");

    // First target should have Aries through Pisces
    expect(plan.items[0].target).toBe("@astro1");
    expect(plan.items[0].payload.text).toBe("Aries");
    expect(plan.items[11].target).toBe("@astro1");
    expect(plan.items[11].payload.text).toBe("Pisces");

    // Second target starts at index 12
    expect(plan.items[12].target).toBe("@astro2");
    expect(plan.items[12].payload.text).toBe("Aries");

    // Duration estimation under 20/min cap (3s per slot -> 36 * 3 = 108s)
    expect(plan.estimatedSeconds).toBe(108);
  });

  it("handles initial commands plus sub-items", () => {
    const plan = expandBatchPlan({
      name: "Init and signs",
      targets: ["@astro1"],
      initialCommands: ["/start"],
      subItems: ["Aries", "Taurus"],
    });

    expect(plan.totalItems).toBe(3);
    expect(plan.items[0].payload.text).toBe("/start");
    expect(plan.items[1].payload.text).toBe("Aries");
    expect(plan.items[2].payload.text).toBe("Taurus");
  });
});

describe("parseNaturalLanguagePlan", () => {
  it("parses plain English with 3 bots and zodiac signs", () => {
    const prompt = "Send /start and all horoscope signs to @astro1, @astro2, and @astro3";
    const plan = parseNaturalLanguagePlan(prompt, { minGapMs: 1500, perMinuteCap: 20 });

    expect(plan.items.length).toBe(39); // 3 bots * (1 /start + 12 signs) = 39 items
    expect(plan.summary).toContain("3 bots");
    expect(plan.items[0].target).toBe("@astro1");
    expect(plan.items[0].payload.text).toBe("/start");
    expect(plan.items[1].payload.text).toBe("Aries");
  });

  it("parses single bot target with commands", () => {
    const prompt = "Run /daily and /status on @mybot";
    const plan = parseNaturalLanguagePlan(prompt);

    expect(plan.items.length).toBe(2);
    expect(plan.items[0].target).toBe("@mybot");
    expect(plan.items[0].payload.text).toBe("/daily");
    expect(plan.items[1].payload.text).toBe("/status");
  });
});
