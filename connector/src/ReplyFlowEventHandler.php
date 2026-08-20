<?php

declare(strict_types=1);

namespace ReplyFlow;

use danog\MadelineProto\EventHandler\Attributes\Handler;
use danog\MadelineProto\EventHandler\Message;
use danog\MadelineProto\SimpleEventHandler;
use Throwable;

/**
 * Forwards every message the personal account can see to the control plane.
 *
 * Both directions are reported: incoming messages drive bot-to-bot flows, and
 * outgoing messages let the owner start a flow by typing the trigger themselves.
 */
final class ReplyFlowEventHandler extends SimpleEventHandler
{
    /** Sender id => is-a-bot, memoised so each peer is resolved at most once per process. */
    private array $botCache = [];

    /** Errors are never reported into a Telegram chat: they can contain message text. */
    public function getReportPeers(): array
    {
        return [];
    }

    public function onStart(): void
    {
        try {
            $state = StateStore::read();
            $state['status'] = 'online';
            $state['workerStartedAt'] = time();
            StateStore::write($state);
            StateStore::heartbeat();
            EventForwarder::status('online', 'Personal connector event loop is online.', $state['identity'] ?? null);
        } catch (Throwable) {
            // Never log: session material can surface in traces.
        }
    }

    #[Handler]
    public function onAnyMessage(Message $message): void
    {
        try {
            StateStore::heartbeat();
            $state = StateStore::read();
            if (($state['disabled'] ?? false) === true) {
                return;
            }
            EventForwarder::post([
                'type' => 'message',
                'message' => [
                    'chatKey' => (string) $message->chatId,
                    'sender' => (string) $message->senderId,
                    'text' => $message->message,
                    'direction' => $message->out ? 'outgoing' : 'incoming',
                    'chatType' => $this->chatType($message),
                    'isEdited' => $message->editDate !== null,
                    'isReply' => $message->replyToMsgId !== null,
                    'isForwarded' => $message->fwdInfo !== null,
                    'isBot' => $this->isBot($message->senderId),
                    'mediaType' => $this->mediaType($message),
                    'messageId' => (string) $message->id,
                ],
            ]);
        } catch (Throwable) {
            // Message bodies and exceptions are intentionally never logged.
        }
    }

    /**
     * Resolves whether a sender is a bot. Bot-to-bot steps depend on this, so an
     * unresolvable peer is reported as "not a bot" rather than blocking the flow.
     */
    private function isBot(int $senderId): bool
    {
        if (array_key_exists($senderId, $this->botCache)) {
            return $this->botCache[$senderId];
        }
        $isBot = false;
        try {
            $info = $this->getInfo($senderId);
            if (is_array($info)) {
                $isBot = ($info['type'] ?? '') === 'bot' || (bool) ($info['User']['bot'] ?? false);
            }
        } catch (Throwable) {
            $isBot = false;
        }
        if (count($this->botCache) > 500) {
            $this->botCache = [];
        }
        $this->botCache[$senderId] = $isBot;

        return $isBot;
    }

    private function chatType(Message $message): string
    {
        if ($message->topicId !== null && $message->topicId > 1) {
            return 'topic';
        }
        $type = '';
        try {
            $info = $this->getInfo($message->chatId);
            if (is_array($info)) {
                $type = (string) ($info['type'] ?? '');
            }
        } catch (Throwable) {
            $type = '';
        }

        return match ($type) {
            'user', 'bot' => 'private',
            'chat', 'supergroup' => 'group',
            'channel' => 'channel',
            default => $message->chatId < 0 ? 'group' : 'private',
        };
    }

    private function mediaType(Message $message): string
    {
        $media = $message->media;
        if ($media === null) {
            return 'text';
        }
        $class = strtolower($media::class);

        return match (true) {
            str_contains($class, 'sticker') => 'sticker',
            str_contains($class, 'voice'), str_contains($class, 'audio') => 'voice',
            str_contains($class, 'roundvideo'), str_contains($class, 'video'), str_contains($class, 'gif') => 'video',
            str_contains($class, 'photo') => 'photo',
            str_contains($class, 'document') => 'document',
            default => 'other',
        };
    }
}
