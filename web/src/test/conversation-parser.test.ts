import { describe, expect, it } from "vitest";
import {
  parseTelegramJson,
  parseTelegramHtml,
  parseMtprotoHistory,
  distilConversation,
} from "../../../functions/conversation-parser";

describe("parseTelegramJson", () => {
  it("parses Telegram Desktop JSON export with string and formatted text", () => {
    const json = JSON.stringify({
      name: "Support Chat",
      type: "personal_chat",
      id: 123456,
      messages: [
        { id: 1, type: "message", from: "Customer", from_id: "user1", text: "Hello" },
        { id: 2, type: "message", from: "Me", from_id: "user2", text: ["Hi ", { type: "bold", text: "there!" }] },
        { id: 3, type: "service", text: "User joined" },
      ],
    });

    const parsed = parseTelegramJson(json, "Me");
    expect(parsed.chatName).toBe("Support Chat");
    expect(parsed.messages.length).toBe(2);
    expect(parsed.messages[0].sender).toBe("Customer");
    expect(parsed.messages[0].isOwner).toBe(false);
    expect(parsed.messages[0].text).toBe("Hello");
    expect(parsed.messages[1].sender).toBe("Me");
    expect(parsed.messages[1].isOwner).toBe(true);
    expect(parsed.messages[1].text).toBe("Hi there!");
  });
});

describe("parseTelegramHtml", () => {
  it("parses Telegram Desktop HTML export correctly", () => {
    const html = `
<!DOCTYPE html>
<html>
<body>
<div class="page_header"><div class="text bold">Customer Inquiries</div></div>
<div class="message default clearfix" id="message10">
  <div class="from_name">User1</div>
  <div class="text">What are your hours?</div>
  <div class="date details" title="22.09.2026 10:00:00">10:00</div>
</div>
<div class="message default clearfix" id="message11">
  <div class="from_name">Admin</div>
  <div class="text">We are open 9am to 5pm.<br>See you!</div>
  <div class="date details" title="22.09.2026 10:01:00">10:01</div>
</div>
</body>
</html>`;

    const parsed = parseTelegramHtml(html, "Admin");
    expect(parsed.chatName).toBe("Customer Inquiries");
    expect(parsed.messages.length).toBe(2);
    expect(parsed.messages[0].sender).toBe("User1");
    expect(parsed.messages[0].isOwner).toBe(false);
    expect(parsed.messages[0].text).toBe("What are your hours?");
    expect(parsed.messages[1].sender).toBe("Admin");
    expect(parsed.messages[1].isOwner).toBe(true);
    expect(parsed.messages[1].text).toBe("We are open 9am to 5pm.\nSee you!");
  });
});

describe("parseMtprotoHistory", () => {
  it("converts MTProto history messages into parsed conversation", () => {
    const raw = [
      { id: 101, date: 1720000000, out: false, text: "help", fromId: "user99" },
      { id: 102, date: 1720000005, out: true, text: "How can I help you?", replyToMsgId: 101 },
    ];

    const parsed = parseMtprotoHistory(raw, "@mybot");
    expect(parsed.chatName).toBe("@mybot");
    expect(parsed.messages.length).toBe(2);
    expect(parsed.messages[0].isOwner).toBe(false);
    expect(parsed.messages[1].isOwner).toBe(true);
    expect(parsed.messages[1].text).toBe("How can I help you?");
  });
});

describe("distilConversation", () => {
  it("collapses turns and extracts interaction patterns without raw bulk history", () => {
    const conversation = {
      chatName: "Sales",
      messages: [
        { id: 1, sender: "UserA", isOwner: false, text: "price?" },
        { id: 2, sender: "Owner", isOwner: true, text: "$10 / month" },
        { id: 3, sender: "UserB", isOwner: false, text: "price?" },
        { id: 4, sender: "Owner", isOwner: true, text: "$10 / month" },
        { id: 5, sender: "UserC", isOwner: false, text: "hello" },
        { id: 6, sender: "Owner", isOwner: true, text: "welcome!" },
      ],
    };

    const distilled = distilConversation(conversation);
    expect(distilled.chatName).toBe("Sales");
    expect(distilled.totalMessages).toBe(6);
    expect(distilled.exchangeCount).toBe(3);
    expect(distilled.patterns.length).toBe(2);

    // Most frequent pattern first
    expect(distilled.patterns[0].trigger).toBe("price?");
    expect(distilled.patterns[0].reply).toBe("$10 / month");
    expect(distilled.patterns[0].occurrences).toBe(2);

    expect(distilled.patterns[1].trigger).toBe("hello");
    expect(distilled.patterns[1].reply).toBe("welcome!");
    expect(distilled.patterns[1].occurrences).toBe(1);
  });
});
