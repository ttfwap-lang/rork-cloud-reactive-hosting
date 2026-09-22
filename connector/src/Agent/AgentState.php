<?php

declare(strict_types=1);

namespace ReplyFlow\Agent;

/**
 * Pure state folder for the agent.
 * Folds an ordered stream of append-only log events into the current derived state:
 * - transcripts per chat
 * - active and held leases
 * - turn attempt counters
 * - active turns and pending tool intents
 */
final class AgentState
{
    /** @var array<string, list<array>> chatKey => transcript events */
    private array $transcripts = [];

    /** @var array<string, ChatLease> chatKey => lease */
    private array $leases = [];

    /** @var array<string, int> turnId => attempt count */
    private array $turnAttempts = [];

    /** @var array<string, array{turnId: string, chatKey: string, startedAt: int}> turnId => details */
    private array $activeTurns = [];

    /** @var array<string, array> callId => intent */
    private array $pendingToolIntents = [];

    private int $lastEventTime = 0;

    /**
     * Folds an ordered array of events into a fresh AgentState instance.
     *
     * @param list<array> $events
     */
    public static function foldEvents(array $events): self
    {
        $state = new self();
        foreach ($events as $event) {
            $state->apply($event);
        }

        return $state;
    }

    /**
     * Applies a single log event to advance state.
     */
    public function apply(array $event): void
    {
        $kind = (string) ($event['kind'] ?? '');
        $timestamp = (int) ($event['timestamp'] ?? ($event['time'] ?? 0));
        if ($timestamp > $this->lastEventTime) {
            $this->lastEventTime = $timestamp;
        }

        $chatKey = (string) ($event['chatKey'] ?? ($event['chat'] ?? ''));
        $turnId = (string) ($event['turnId'] ?? '');

        switch ($kind) {
            case 'instruction':
            case 'observation':
                if ($chatKey !== '') {
                    $this->transcripts[$chatKey][] = $event;
                }
                break;

            case 'turn.start':
                if ($turnId !== '') {
                    $this->activeTurns[$turnId] = [
                        'turnId' => $turnId,
                        'chatKey' => $chatKey,
                        'startedAt' => $timestamp,
                    ];
                }
                if ($chatKey !== '') {
                    $this->transcripts[$chatKey][] = $event;
                }
                break;

            case 'turn.attempt':
                if ($turnId !== '') {
                    $this->turnAttempts[$turnId] = ($this->turnAttempts[$turnId] ?? 0) + 1;
                }
                break;

            case 'tool.intent':
                $callId = (string) ($event['callId'] ?? '');
                if ($callId !== '') {
                    $this->pendingToolIntents[$callId] = $event;
                }
                if ($chatKey !== '') {
                    $this->transcripts[$chatKey][] = $event;
                }
                break;

            case 'tool.result':
                $callId = (string) ($event['callId'] ?? '');
                if ($callId !== '') {
                    unset($this->pendingToolIntents[$callId]);
                }
                if ($chatKey !== '') {
                    $this->transcripts[$chatKey][] = $event;
                }
                break;

            case 'lease.acquired':
                if ($chatKey !== '') {
                    $owner = (string) ($event['owner'] ?? 'agent');
                    $ttl = (int) ($event['ttlSeconds'] ?? ChatLease::DEFAULT_TTL_SECONDS);
                    $metadata = (array) ($event['metadata'] ?? []);
                    $this->leases[$chatKey] = new ChatLease(
                        chatKey: $chatKey,
                        owner: $owner,
                        acquiredAt: $timestamp,
                        ttlSeconds: $ttl,
                        metadata: $metadata,
                    );
                }
                break;

            case 'lease.released':
                if ($chatKey !== '') {
                    unset($this->leases[$chatKey]);
                }
                break;

            case 'turn.end':
                if ($turnId !== '') {
                    unset($this->activeTurns[$turnId]);
                    // Clear any remaining pending intents for this finished turn
                    foreach ($this->pendingToolIntents as $cid => $intent) {
                        if (($intent['turnId'] ?? null) === $turnId) {
                            unset($this->pendingToolIntents[$cid]);
                        }
                    }
                }
                if ($chatKey !== '') {
                    $this->transcripts[$chatKey][] = $event;
                }
                break;

            case 'turn.abandoned':
                if ($turnId !== '') {
                    unset($this->activeTurns[$turnId]);
                    foreach ($this->pendingToolIntents as $cid => $intent) {
                        if (($intent['turnId'] ?? null) === $turnId) {
                            unset($this->pendingToolIntents[$cid]);
                        }
                    }
                }
                if ($chatKey !== '') {
                    $this->transcripts[$chatKey][] = $event;
                }
                break;
        }
    }

    /**
     * Returns transcript events for a chat.
     *
     * @return list<array>
     */
    public function getTranscript(string $chatKey): array
    {
        return $this->transcripts[$chatKey] ?? [];
    }

    /**
     * @return array<string, list<array>>
     */
    public function getAllTranscripts(): array
    {
        return $this->transcripts;
    }

    /**
     * Returns all active leases that have not expired by $now.
     *
     * @return array<string, ChatLease>
     */
    public function getHeldLeases(int $now): array
    {
        $held = [];
        foreach ($this->leases as $chatKey => $lease) {
            if (!$lease->isExpired($now)) {
                $held[$chatKey] = $lease;
            }
        }

        return $held;
    }

    /**
     * Returns lease object regardless of expiry.
     */
    public function getLease(string $chatKey, ?int $now = null): ?ChatLease
    {
        $lease = $this->leases[$chatKey] ?? null;
        if ($lease === null) {
            return null;
        }

        if ($now !== null && $lease->isExpired($now)) {
            return null;
        }

        return $lease;
    }

    public function isLeased(string $chatKey, int $now): bool
    {
        return $this->getLease($chatKey, $now) !== null;
    }

    public function getTurnAttempts(string $turnId): int
    {
        return $this->turnAttempts[$turnId] ?? 0;
    }

    /**
     * @return array<string, int>
     */
    public function getAllTurnAttempts(): array
    {
        return $this->turnAttempts;
    }

    /**
     * @return array<string, array{turnId: string, chatKey: string, startedAt: int}>
     */
    public function getActiveTurns(): array
    {
        return $this->activeTurns;
    }

    /**
     * Returns pending tool intents (optionally filtered by chatKey).
     *
     * @return list<array>
     */
    public function getPendingToolIntents(?string $chatKey = null): array
    {
        $intents = array_values($this->pendingToolIntents);
        if ($chatKey === null) {
            return $intents;
        }

        return array_values(array_filter(
            $intents,
            static fn (array $i): bool => (string) ($i['chatKey'] ?? ($i['chat'] ?? '')) === $chatKey,
        ));
    }

    public function hasPendingToolIntents(?string $chatKey = null): bool
    {
        return count($this->getPendingToolIntents($chatKey)) > 0;
    }

    public function getLastEventTime(): int
    {
        return $this->lastEventTime;
    }
}
