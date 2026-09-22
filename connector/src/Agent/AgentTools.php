<?php

declare(strict_types=1);

namespace ReplyFlow\Agent;

use ReplyFlow\AsyncDelay;
use ReplyFlow\ConnectorException;
use ReplyFlow\SavedMessagesResolver;
use Throwable;

/**
 * Direct Telegram acting and inspection tools for the agent.
 * Handles free-form target inference and non-blocking flood wait backoff.
 */
class AgentTools
{
    /** Maximum flood wait in seconds absorbed via non-blocking delay. */
    private const INLINE_FLOOD_LIMIT = 25.0;

    /**
     * Gemini function declarations for direct agent tools.
     *
     * @return list<array>
     */
    public static function declarations(): array
    {
        return [
            [
                'name' => 'read_history',
                'description' => 'Read recent messages in a Telegram chat.',
                'parameters' => [
                    'type' => 'OBJECT',
                    'properties' => [
                        'chat' => [
                            'type' => 'STRING',
                            'description' => 'Target chat peer (username, phone, or numeric id).',
                        ],
                        'limit' => [
                            'type' => 'INTEGER',
                            'description' => 'Number of recent messages to fetch (default 10).',
                        ],
                    ],
                    'required' => ['chat'],
                ],
            ],
            [
                'name' => 'send_text',
                'description' => 'Send a text message to a Telegram chat.',
                'parameters' => [
                    'type' => 'OBJECT',
                    'properties' => [
                        'chat' => [
                            'type' => 'STRING',
                            'description' => 'Target chat peer (username, phone, or numeric id).',
                        ],
                        'text' => [
                            'type' => 'STRING',
                            'description' => 'Text message content to send.',
                        ],
                    ],
                    'required' => ['chat', 'text'],
                ],
            ],
            [
                'name' => 'press_button',
                'description' => 'Press an inline keyboard button on a recent message.',
                'parameters' => [
                    'type' => 'OBJECT',
                    'properties' => [
                        'chat' => [
                            'type' => 'STRING',
                            'description' => 'Target chat peer.',
                        ],
                        'button' => [
                            'type' => 'STRING',
                            'description' => 'Button label or coordinate (row,col) 1-indexed.',
                        ],
                    ],
                    'required' => ['chat', 'button'],
                ],
            ],
            [
                'name' => 'react',
                'description' => 'React with an emoji to a message.',
                'parameters' => [
                    'type' => 'OBJECT',
                    'properties' => [
                        'chat' => [
                            'type' => 'STRING',
                            'description' => 'Target chat peer.',
                        ],
                        'messageId' => [
                            'type' => 'STRING',
                            'description' => 'Message ID to react to.',
                        ],
                        'emoji' => [
                            'type' => 'STRING',
                            'description' => 'Emoji to react with.',
                        ],
                    ],
                    'required' => ['chat', 'messageId', 'emoji'],
                ],
            ],
            [
                'name' => 'forward_to_saved',
                'description' => 'Forward a message to Saved Messages.',
                'parameters' => [
                    'type' => 'OBJECT',
                    'properties' => [
                        'chat' => [
                            'type' => 'STRING',
                            'description' => 'Source chat peer.',
                        ],
                        'messageId' => [
                            'type' => 'STRING',
                            'description' => 'Message ID to forward.',
                        ],
                    ],
                    'required' => ['chat', 'messageId'],
                ],
            ],
            [
                'name' => 'mark_read',
                'description' => 'Mark messages in a chat as read up to a message ID.',
                'parameters' => [
                    'type' => 'OBJECT',
                    'properties' => [
                        'chat' => [
                            'type' => 'STRING',
                            'description' => 'Target chat peer.',
                        ],
                        'messageId' => [
                            'type' => 'STRING',
                            'description' => 'Maximum message ID to mark as read.',
                        ],
                    ],
                    'required' => ['chat', 'messageId'],
                ],
            ],
        ];
    }

    /**
     * Executes a tool using the given Telegram client/handler.
     *
     * @param string $tool Tool name
     * @param array<string, mixed> $args Tool arguments
     * @param object $proto MadelineProto instance or event handler
     * @return array<string, mixed>
     */
    public function execute(string $tool, array $args, object $proto): array
    {
        return match ($tool) {
            'read_history' => $this->readHistory($proto, $args),
            'send_text' => $this->sendText($proto, $args),
            'press_button' => $this->pressButton($proto, $args),
            'react' => $this->react($proto, $args),
            'forward_to_saved' => $this->forwardToSaved($proto, $args),
            'mark_read' => $this->markRead($proto, $args),
            default => throw new ConnectorException("Unknown agent tool: {$tool}"),
        };
    }

    private function readHistory(object $proto, array $args): array
    {
        $chat = trim((string) ($args['chat'] ?? ''));
        if ($chat === '') {
            throw new ConnectorException('chat argument is required for read_history.');
        }
        $limit = min(100, max(1, (int) ($args['limit'] ?? 10)));

        return $this->runWithFloodProtection(function () use ($proto, $chat, $limit): array {
            $raw = $proto->messages->getHistory(peer: $chat, limit: $limit);
            $messages = [];
            foreach (($raw['messages'] ?? []) as $m) {
                if (!is_array($m)) {
                    continue;
                }
                $messages[] = [
                    'id' => (string) ($m['id'] ?? ''),
                    'text' => (string) ($m['message'] ?? ''),
                    'date' => (int) ($m['date'] ?? 0),
                    'out' => (bool) ($m['out'] ?? false),
                    'from_id' => $m['from_id'] ?? null,
                ];
            }

            return [
                'ok' => true,
                'chat' => $chat,
                'count' => count($messages),
                'messages' => $messages,
            ];
        });
    }

    private function sendText(object $proto, array $args): array
    {
        $chat = trim((string) ($args['chat'] ?? ''));
        $text = (string) ($args['text'] ?? '');
        if ($chat === '') {
            throw new ConnectorException('chat argument is required for send_text.');
        }
        if ($text === '') {
            throw new ConnectorException('text argument is required for send_text.');
        }

        return $this->runWithFloodProtection(function () use ($proto, $chat, $text): array {
            $res = $proto->messages->sendMessage(peer: $chat, message: $text);

            return [
                'ok' => true,
                'sent' => true,
                'chat' => $chat,
                'id' => isset($res['id']) ? (string) $res['id'] : null,
            ];
        });
    }

    private function pressButton(object $proto, array $args): array
    {
        $chat = trim((string) ($args['chat'] ?? ''));
        $button = trim((string) ($args['button'] ?? ''));
        if ($chat === '') {
            throw new ConnectorException('chat argument is required for press_button.');
        }
        if ($button === '') {
            throw new ConnectorException('button argument is required for press_button.');
        }

        return $this->runWithFloodProtection(function () use ($proto, $chat, $button): array {
            $history = $proto->messages->getHistory(peer: $chat, limit: 10);
            foreach ($history['messages'] ?? [] as $message) {
                foreach (($message['reply_markup']['rows'] ?? []) as $rowIndex => $row) {
                    foreach (($row['buttons'] ?? []) as $columnIndex => $btn) {
                        $coordinates = ($rowIndex + 1).','.($columnIndex + 1);
                        if (($btn['text'] ?? '') !== $button && $coordinates !== $button) {
                            continue;
                        }
                        if (!array_key_exists('data', $btn)) {
                            throw new ConnectorException('That button cannot be safely pressed by the connector.');
                        }
                        $proto->messages->getBotCallbackAnswer(
                            peer: $chat,
                            msg_id: (int) $message['id'],
                            data: $btn['data'],
                        );

                        return [
                            'ok' => true,
                            'pressed' => true,
                            'chat' => $chat,
                            'button' => $button,
                            'messageId' => (string) $message['id'],
                        ];
                    }
                }
            }

            throw new ConnectorException("The requested button '{$button}' was not found in recent messages.");
        });
    }

    private function react(object $proto, array $args): array
    {
        $chat = trim((string) ($args['chat'] ?? ''));
        $messageId = (int) ($args['messageId'] ?? 0);
        $emoji = trim((string) ($args['emoji'] ?? ''));
        if ($chat === '') {
            throw new ConnectorException('chat argument is required for react.');
        }
        if ($messageId <= 0) {
            throw new ConnectorException('A valid messageId is required for react.');
        }
        if ($emoji === '') {
            throw new ConnectorException('emoji argument is required for react.');
        }

        return $this->runWithFloodProtection(function () use ($proto, $chat, $messageId, $emoji): array {
            $proto->messages->sendReaction(
                peer: $chat,
                msg_id: $messageId,
                reaction: [['_' => 'reactionEmoji', 'emoticon' => $emoji]],
            );

            return [
                'ok' => true,
                'reacted' => true,
                'chat' => $chat,
                'messageId' => (string) $messageId,
                'emoji' => $emoji,
            ];
        });
    }

    private function forwardToSaved(object $proto, array $args): array
    {
        $chat = trim((string) ($args['chat'] ?? ''));
        $messageId = (int) ($args['messageId'] ?? 0);
        if ($chat === '') {
            throw new ConnectorException('chat argument is required for forward_to_saved.');
        }
        if ($messageId <= 0) {
            throw new ConnectorException('A valid messageId is required for forward_to_saved.');
        }

        return $this->runWithFloodProtection(function () use ($proto, $chat, $messageId): array {
            $savedPeer = SavedMessagesResolver::resolve($proto);
            $proto->messages->forwardMessages(
                from_peer: $chat,
                to_peer: $savedPeer,
                id: [$messageId],
            );

            return [
                'ok' => true,
                'forwarded' => true,
                'chat' => $chat,
                'messageId' => (string) $messageId,
                'target' => 'saved_messages',
            ];
        });
    }

    private function markRead(object $proto, array $args): array
    {
        $chat = trim((string) ($args['chat'] ?? ''));
        $messageId = (int) ($args['messageId'] ?? 0);
        if ($chat === '') {
            throw new ConnectorException('chat argument is required for mark_read.');
        }
        if ($messageId <= 0) {
            throw new ConnectorException('A valid messageId is required for mark_read.');
        }

        return $this->runWithFloodProtection(function () use ($proto, $chat, $messageId): array {
            $proto->messages->readHistory(peer: $chat, max_id: $messageId);

            return [
                'ok' => true,
                'markedRead' => true,
                'chat' => $chat,
                'maxId' => (string) $messageId,
            ];
        });
    }

    /**
     * Executes an operation with non-blocking flood wait backoff.
     */
    private function runWithFloodProtection(callable $operation, bool $isRetry = false): array
    {
        try {
            return $operation();
        } catch (ConnectorException $error) {
            throw $error;
        } catch (Throwable $error) {
            $seconds = ConnectorException::floodSeconds($error);
            if ($seconds === null) {
                throw $error;
            }
            if ($isRetry || $seconds > self::INLINE_FLOOD_LIMIT) {
                throw new ConnectorException(
                    "Telegram asked for a {$seconds}s pause.",
                    $seconds,
                    429,
                    $error,
                );
            }
            // Use non-blocking delay to never stall the event loop
            AsyncDelay::forSeconds((float) $seconds);

            return $this->runWithFloodProtection($operation, true);
        }
    }
}
