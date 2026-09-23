import { describe, expect, it } from "vitest";
import {
  expandBatchPlan,
  parseNaturalLanguagePlan,
  ZODIAC_SIGNS,
} from "../../../functions/batch-planner";
import { normalizeBatchActionPayload } from "../../../functions/batch-normalization";

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

describe("normalizeBatchActionPayload", () => {
  it("normalizes planner-shaped nested payload for sendText", () => {
    const plannerItem = {
      id: "item-1",
      target: "@astro1",
      actionType: "sendText",
      payload: {
        text: "Aries Horoscope",
      },
      description: "Send Aries Horoscope to @astro1",
    };

    const action = normalizeBatchActionPayload(plannerItem, "sendText", "item-1");
    expect(action.actionType).toBe("sendText");
    expect(action.text).toBe("Aries Horoscope");
    expect(action.idempotencyKey).toBe("item-1");
  });

  it("normalizes legacy top-level payload for sendText", () => {
    const legacyItem = {
      id: "item-2",
      target: "@astro2",
      actionType: "sendText",
      text: "Legacy Aries",
    };

    const action = normalizeBatchActionPayload(legacyItem, "sendText", "item-2");
    expect(action.actionType).toBe("sendText");
    expect(action.text).toBe("Legacy Aries");
    expect(action.idempotencyKey).toBe("item-2");
  });

  it("prioritizes nested payload over top-level payload when both are present", () => {
    const mixedItem = {
      id: "item-3",
      text: "Top-level text",
      payload: {
        text: "Nested text",
      },
    };

    const action = normalizeBatchActionPayload(mixedItem, "sendText", "item-3");
    expect(action.text).toBe("Nested text");
  });

  it("normalizes forward action with source and target fields", () => {
    const plannerForward = {
      id: "item-4",
      target: "@saved",
      actionType: "forward",
      payload: {
        messageId: "9988",
        fromChatKey: "@astro1",
        target: "@saved",
      },
    };

    const action = normalizeBatchActionPayload(plannerForward, "forward", "item-4");
    expect(action.actionType).toBe("forward");
    expect(action.messageId).toBe("9988");
    expect(action.fromChatKey).toBe("@astro1");
    expect(action.target).toBe("@saved");
  });

  it("normalizes pressButton and react with messageId", () => {
    const buttonItem = {
      payload: { buttonTarget: "Row 1, Col 1" },
    };
    const buttonAction = normalizeBatchActionPayload(buttonItem, "pressButton");
    expect(buttonAction.actionType).toBe("pressButton");
    expect(buttonAction.buttonTarget).toBe("Row 1, Col 1");

    const reactItem = {
      reaction: "👍",
      messageId: 456,
    };
    const reactAction = normalizeBatchActionPayload(reactItem, "react");
    expect(reactAction.actionType).toBe("react");
    expect(reactAction.reaction).toBe("👍");
    expect(reactAction.messageId).toBe("456");
  });
});

