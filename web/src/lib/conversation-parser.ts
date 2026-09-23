/**
 * Pure conversation parser and local distiller for Telegram exports and MTProto history.
 * Zero external dependencies.
 */

export type ParsedMessage = {
  id: string | number;
  sender: string;
  isOwner: boolean;
  text: string;
  date?: string | number;
  replyToId?: string | number | null;
};

export type ParsedConversation = {
  chatName: string;
  messages: ParsedMessage[];
};

export type InteractionPattern = {
  trigger: string;
  reply: string;
  occurrences: number;
  sampleContext?: string;
};

export type DistilledSummary = {
  chatName: string;
  totalMessages: number;
  exchangeCount: number;
  patterns: InteractionPattern[];
  uniqueSpeakers: string[];
};

/**
 * Parses a Telegram Desktop JSON export (`result.json`).
 */
export function parseTelegramJson(jsonContent: string, ownerHint?: string): ParsedConversation {
  const data = JSON.parse(jsonContent) as {
    name?: string;
    messages?: Array<{
      id?: number;
      type?: string;
      date?: string;
      from?: string;
      from_id?: string;
      text?: string | Array<string | { text?: string }>;
      reply_to_message_id?: number;
    }>;
  };

  const chatName = data.name ?? "Telegram Export";
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  const messages: ParsedMessage[] = [];

  const normalizedHint = ownerHint?.trim().toLowerCase();

  for (const m of rawMessages) {
    if (m.type && m.type !== "message") continue;

    let text = "";
    if (typeof m.text === "string") {
      text = m.text;
    } else if (Array.isArray(m.text)) {
      text = m.text.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("");
    }
    text = text.trim();
    if (!text) continue;

    const sender = m.from ?? m.from_id ?? "Unknown";
    const senderId = m.from_id ?? "";
    const isOwner = normalizedHint
      ? sender.toLowerCase() === normalizedHint || senderId.toLowerCase() === normalizedHint
      : false;

    messages.push({
      id: m.id ?? messages.length + 1,
      sender,
      isOwner,
      text,
      date: m.date,
      replyToId: m.reply_to_message_id ?? null,
    });
  }

  // If no owner was matched by hint, attempt heuristic: sender with replies or highest frequency
  if (normalizedHint === undefined || !messages.some((m) => m.isOwner)) {
    inferOwner(messages);
  }

  return { chatName, messages };
}

/**
 * Parses a Telegram Desktop HTML export (`messages.html`).
 */
export function parseTelegramHtml(htmlContent: string, ownerHint?: string): ParsedConversation {
  const messages: ParsedMessage[] = [];
  const normalizedHint = ownerHint?.trim().toLowerCase();

  // Extract title if present
  const titleMatch = /<div class="page_header">[\s\S]*?<div class="text bold">([\s\S]*?)<\/div>/i.exec(htmlContent);
  const chatName = titleMatch ? stripHtml(titleMatch[1]).trim() : "Telegram HTML Export";

  // Regex to match message blocks
  const msgBlockRegex = /<div class="message\s+([^"]*)"\s+id="message(\d+)">([\s\S]*?)(?=<div class="message|\s*<\/div>\s*<\/div>\s*<\/body>|$)/gi;

  let currentSender = "Unknown";
  let match: RegExpExecArray | null;

  while ((match = msgBlockRegex.exec(htmlContent)) !== null) {
    const classes = match[1];
    const id = match[2];
    const body = match[3];

    if (classes.includes("service")) continue;

    // Check for from_name
    const senderMatch = /<div class="from_name">([\s\S]*?)<\/div>/i.exec(body);
    if (senderMatch) {
      currentSender = stripHtml(senderMatch[1]).trim();
    }

    // Check for text
    const textMatch = /<div class="text">([\s\S]*?)<\/div>/i.exec(body);
    if (!textMatch) continue;

    const text = stripHtml(textMatch[1]).trim();
    if (!text) continue;

    // Date
    const dateMatch = /<div class="date[^"]*"\s+title="([^"]+)"/i.exec(body);
    const date = dateMatch ? dateMatch[1] : undefined;

    const isOwner = normalizedHint ? currentSender.toLowerCase() === normalizedHint : false;

    messages.push({
      id: Number(id) || id,
      sender: currentSender,
      isOwner,
      text,
      date,
    });
  }

  if (normalizedHint === undefined || !messages.some((m) => m.isOwner)) {
    inferOwner(messages);
  }

  return { chatName, messages };
}

/**
 * Parses MTProto history messages array.
 */
export function parseMtprotoHistory(
  rawMessages: Array<{
    id: number;
    date: number;
    out: boolean;
    text: string;
    fromId?: string;
    replyToMsgId?: number | null;
  }>,
  chatName = "MTProto Live History",
): ParsedConversation {
  const messages: ParsedMessage[] = [];

  for (const m of rawMessages) {
    const text = (m.text || "").trim();
    if (!text) continue;

    messages.push({
      id: m.id,
      sender: m.out ? "Owner" : m.fromId || "User",
      isOwner: m.out,
      text,
      date: m.date,
      replyToId: m.replyToMsgId,
    });
  }

  return { chatName, messages };
}

/**
 * Distils raw conversation into interaction patterns.
 * Never exposes raw bulk history; aggregates into triggers, replies, and counts.
 */
export function distilConversation(
  conversation: ParsedConversation,
  maxPatterns = 15,
): DistilledSummary {
  const { messages, chatName } = conversation;
  const uniqueSpeakers = Array.from(new Set(messages.map((m) => m.sender)));

  if (messages.length === 0) {
    return {
      chatName,
      totalMessages: 0,
      exchangeCount: 0,
      patterns: [],
      uniqueSpeakers: [],
    };
  }

  // Turn aggregation: collapse consecutive messages from the same sender
  type Turn = { sender: string; isOwner: boolean; text: string };
  const turns: Turn[] = [];

  for (const msg of messages) {
    const lastTurn = turns[turns.length - 1];
    if (lastTurn && lastTurn.sender === msg.sender) {
      lastTurn.text += `\n${msg.text}`;
    } else {
      turns.push({ sender: msg.sender, isOwner: msg.isOwner, text: msg.text });
    }
  }

  // Identify exchanges: non-owner turn followed by owner turn
  const patternMap = new Map<string, { trigger: string; reply: string; count: number; sampleContext?: string }>();
  let exchangeCount = 0;

  for (let i = 0; i < turns.length - 1; i++) {
    const current = turns[i];
    const next = turns[i + 1];

    if (!current.isOwner && next.isOwner) {
      exchangeCount++;
      const normTrigger = current.text.trim();
      const normReply = next.text.trim();

      // Normalize key by lowercased first line or full text
      const key = `${normTrigger.toLowerCase()} -> ${normReply.toLowerCase()}`;
      const existing = patternMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        patternMap.set(key, {
          trigger: normTrigger,
          reply: normReply,
          count: 1,
          sampleContext: `User: ${normTrigger} | Owner: ${normReply}`,
        });
      }
    }
  }

  // Sort by occurrence count descending, then take up to maxPatterns
  const patterns: InteractionPattern[] = Array.from(patternMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, maxPatterns)
    .map((p) => ({
      trigger: p.trigger,
      reply: p.reply,
      occurrences: p.count,
      sampleContext: p.sampleContext,
    }));

  return {
    chatName,
    totalMessages: messages.length,
    exchangeCount,
    patterns,
    uniqueSpeakers,
  };
}

/** Helper to strip HTML tags and decode basic entities */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Inactive heuristic when owner hint is omitted */
function inferOwner(messages: ParsedMessage[]): void {
  // If there are exactly two speakers, the one that speaks second or less frequently could be owner,
  // or simply the second speaker in an exchange.
  const speakerCounts = new Map<string, number>();
  for (const m of messages) {
    speakerCounts.set(m.sender, (speakerCounts.get(m.sender) ?? 0) + 1);
  }
  const speakers = Array.from(speakerCounts.keys());
  if (speakers.length >= 2) {
    // Pick the second speaker encountered as candidate owner
    const secondSpeaker = messages.find((m) => m.sender !== messages[0].sender)?.sender;
    if (secondSpeaker) {
      for (const m of messages) {
        if (m.sender === secondSpeaker) m.isOwner = true;
      }
    }
  }
}
