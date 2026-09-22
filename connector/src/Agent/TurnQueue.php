<?php

declare(strict_types=1);

namespace ReplyFlow\Agent;

/**
 * Pure in-memory per-chat FIFO admission queue.
 * Allows unbounded concurrent turns across different chats while enforcing
 * strict sequential FIFO admission within any single chat.
 */
final class TurnQueue
{
    /** @var array<string, list<mixed>> chatKey => queue */
    private array $queues = [];

    /** @var array<string, string> chatKey => activeTurnId */
    private array $activeTurns = [];

    /**
     * Appends an item to the chat's FIFO queue.
     */
    public function enqueue(string $chatKey, mixed $item): void
    {
        $this->queues[$chatKey][] = $item;
    }

    /**
     * Retrieves and removes the oldest item from the chat's FIFO queue, or null if empty.
     */
    public function dequeue(string $chatKey): mixed
    {
        if (empty($this->queues[$chatKey])) {
            return null;
        }

        return array_shift($this->queues[$chatKey]);
    }

    /**
     * Inspects the oldest item without removing it.
     */
    public function peek(string $chatKey): mixed
    {
        if (empty($this->queues[$chatKey])) {
            return null;
        }

        return $this->queues[$chatKey][0];
    }

    public function isEmpty(string $chatKey): bool
    {
        return empty($this->queues[$chatKey]);
    }

    public function size(string $chatKey): int
    {
        return isset($this->queues[$chatKey]) ? count($this->queues[$chatKey]) : 0;
    }

    /**
     * Checks if a turn is currently executing for the chat.
     */
    public function isTurnActive(string $chatKey): bool
    {
        return isset($this->activeTurns[$chatKey]);
    }

    public function getActiveTurnId(string $chatKey): ?string
    {
        return $this->activeTurns[$chatKey] ?? null;
    }

    /**
     * Attempts to admit a new turn for the chat.
     * Returns true if admitted, false if another turn is currently running for this chat.
     */
    public function startTurn(string $chatKey, string $turnId): bool
    {
        if ($this->isTurnActive($chatKey)) {
            return false;
        }

        $this->activeTurns[$chatKey] = $turnId;

        return true;
    }

    /**
     * Marks the active turn for the chat as finished, freeing admission for the next turn.
     */
    public function finishTurn(string $chatKey, ?string $turnId = null): void
    {
        if ($turnId === null || ($this->activeTurns[$chatKey] ?? null) === $turnId) {
            unset($this->activeTurns[$chatKey]);
        }
    }

    /**
     * Clears queue and active turn state for a chat or all chats.
     */
    public function clear(?string $chatKey = null): void
    {
        if ($chatKey === null) {
            $this->queues = [];
            $this->activeTurns = [];
        } else {
            unset($this->queues[$chatKey], $this->activeTurns[$chatKey]);
        }
    }

    /**
     * Lists all chats with queued items.
     *
     * @return list<string>
     */
    public function getQueuedChats(): array
    {
        return array_values(array_keys(array_filter($this->queues, static fn (array $q): bool => count($q) > 0)));
    }

    /**
     * Lists all chats with active turns.
     *
     * @return list<string>
     */
    public function getActiveChats(): array
    {
        return array_keys($this->activeTurns);
    }
}
