<?php

declare(strict_types=1);

namespace ReplyFlow\Agent;

/**
 * Pure replay decision planner for orphan recovery after child-process crash/restart.
 *
 * Given pending tool intents without a corresponding tool.result, decides:
 * - 'reissue': re-run the tool action
 * - 'skip': action already landed on Telegram, proceed to next step
 * - 'abandon': failed repeatedly or unsafe to retry
 */
final class ReplayPlanner
{
    public const DECISION_REISSUE = 'reissue';
    public const DECISION_SKIP = 'skip';
    public const DECISION_ABANDON = 'abandon';

    /** Replay is strictly allowed only once to prevent infinite crash loops. */
    public const MAX_REPLAY_ATTEMPTS = 1;
    public const SAVED_MESSAGES_KEY = 'saved';

    /**
     * Decides action for a single pending tool intent.
     *
     * @param array{tool: string, arguments?: array, callId?: string, turnId?: string} $intent
     * @param int $attemptCount Number of previous attempts recorded for this turn/intent
     * @param list<array> $recentHistory Recent messages in the target chat
     * @param list<array>|null $savedMessagesHistory Recent messages in Saved Messages (if checking forward_to_saved separately)
     * @return self::DECISION_*
     */
    public function plan(
        array $intent,
        int $attemptCount,
        array $recentHistory = [],
        ?array $savedMessagesHistory = null,
    ): string {
        // 1. Crash loop protection: replay strictly once.
        if ($attemptCount >= self::MAX_REPLAY_ATTEMPTS) {
            return self::DECISION_ABANDON;
        }

        $tool = (string) ($intent['tool'] ?? '');
        $args = (array) ($intent['arguments'] ?? []);

        // 2. press_button is re-issued unconditionally: getBotCallbackAnswer leaves no message trace.
        if ($tool === 'press_button') {
            return self::DECISION_REISSUE;
        }

        // 3. Read-only inspection tools are always safe to re-run.
        if ($tool === 'read_history') {
            return self::DECISION_REISSUE;
        }

        // 4. Idempotent actions
        if ($tool === 'mark_read') {
            return self::DECISION_REISSUE;
        }

        // 5. Verifiable actions: verify against recent history
        if ($tool === 'send_text') {
            $expectedText = (string) ($args['text'] ?? '');
            if ($this->hasRecentOutgoingMessageWithText($recentHistory, $expectedText)) {
                return self::DECISION_SKIP;
            }

            return self::DECISION_REISSUE;
        }

        if ($tool === 'react') {
            $expectedEmoji = (string) ($args['emoji'] ?? '');
            $messageId = (string) ($args['messageId'] ?? '');
            if ($this->hasReactionOnMessage($recentHistory, $messageId, $expectedEmoji)) {
                return self::DECISION_SKIP;
            }

            return self::DECISION_REISSUE;
        }

        if ($tool === 'forward_to_saved') {
            $messageId = (string) ($args['messageId'] ?? '');
            $saved = $savedMessagesHistory ?? $recentHistory;
            if ($this->hasForwardInSavedMessages($saved, $messageId)) {
                return self::DECISION_SKIP;
            }

            return self::DECISION_REISSUE;
        }

        // Any unrecognized non-idempotent tool without verifiable trace is abandoned.
        return self::DECISION_ABANDON;
    }

    /**
     * Resolves the target chat whose history proves or disproves tool execution.
     */
    public function targetChatForTool(string $tool, array $intent): string
    {
        if ($tool === 'forward_to_saved') {
            return self::SAVED_MESSAGES_KEY;
        }

        return (string) ($intent['chatKey'] ?? ($intent['arguments']['chat'] ?? ''));
    }

    /**
     * Plans replay decisions for all pending tool intents in folded state.
     *
     * @param list<array> $pendingIntents
     * @param array<string, int> $turnAttempts turnId => count
     * @param array<string, list<array>> $chatHistories chatKey => history
     * @param list<array>|null $savedMessagesHistory Saved Messages history override
     * @return array<string, array{decision: string, intent: array}>
     */
    public function planAll(
        array $pendingIntents,
        array $turnAttempts,
        array $chatHistories = [],
        ?array $savedMessagesHistory = null,
    ): array {
        $decisions = [];
        $savedHistory = $savedMessagesHistory
            ?? $chatHistories[self::SAVED_MESSAGES_KEY]
            ?? $chatHistories['me']
            ?? $chatHistories['saved_messages']
            ?? null;

        foreach ($pendingIntents as $intent) {
            $callId = (string) ($intent['callId'] ?? uniqid('call_', true));
            $turnId = (string) ($intent['turnId'] ?? '');
            $tool = (string) ($intent['tool'] ?? '');

            // Choose verification history by tool-specific target, not always by chatKey
            $targetChat = $this->targetChatForTool($tool, $intent);
            $history = $targetChat === self::SAVED_MESSAGES_KEY
                ? ($savedHistory ?? [])
                : ($chatHistories[$targetChat] ?? []);

            $attempts = $turnAttempts[$turnId] ?? 0;

            $decision = $this->plan($intent, $attempts, $history, $savedHistory);
            $decisions[$callId] = [
                'decision' => $decision,
                'intent' => $intent,
            ];
        }

        return $decisions;
    }

    private function hasRecentOutgoingMessageWithText(array $history, string $text): bool
    {
        if ($text === '') {
            return false;
        }

        foreach ($history as $msg) {
            $isOutgoing = ($msg['out'] ?? false) === true || ($msg['direction'] ?? '') === 'outgoing';
            $msgText = (string) ($msg['text'] ?? ($msg['message'] ?? ''));
            if ($isOutgoing && $msgText === $text) {
                return true;
            }
        }

        return false;
    }

    private function hasReactionOnMessage(array $history, string $messageId, string $emoji): bool
    {
        if ($messageId === '' || $emoji === '') {
            return false;
        }

        foreach ($history as $msg) {
            $msgId = (string) ($msg['id'] ?? ($msg['messageId'] ?? ''));
            if ($msgId === $messageId) {
                $reactions = (array) ($msg['reactions'] ?? []);
                foreach ($reactions as $r) {
                    if (($r['emoji'] ?? $r['emoticon'] ?? '') === $emoji && ($r['isSelf'] ?? false) === true) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private function hasForwardInSavedMessages(array $savedHistory, string $originalMessageId): bool
    {
        if ($originalMessageId === '') {
            return false;
        }

        foreach ($savedHistory as $msg) {
            $fwdFromId = (string) ($msg['fwdFromId'] ?? ($msg['fwdInfo']['fromId'] ?? ''));
            $fwdMsgId = (string) ($msg['fwdMsgId'] ?? ($msg['fwdInfo']['channelPost'] ?? ''));
            if ($fwdMsgId === $originalMessageId) {
                return true;
            }
        }

        return false;
    }
}
