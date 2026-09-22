<?php

declare(strict_types=1);

namespace ReplyFlow\Agent;

/**
 * Pure value object representing a lease on a chat.
 * Encapsulates ownership, TTL, and expiry decisions.
 */
final class ChatLease
{
    public const DEFAULT_TTL_SECONDS = 300;

    public function __construct(
        public readonly string $chatKey,
        public readonly string $owner,
        public readonly int $acquiredAt,
        public readonly int $ttlSeconds = self::DEFAULT_TTL_SECONDS,
        public readonly array $metadata = [],
    ) {
    }

    public function getExpiresAt(): int
    {
        return $this->acquiredAt + $this->ttlSeconds;
    }

    public function isExpired(int $now): bool
    {
        return $now >= $this->getExpiresAt();
    }

    public function remainingTtl(int $now): int
    {
        return max(0, $this->getExpiresAt() - $now);
    }

    public function isHeldBy(string $owner, int $now): bool
    {
        return !$this->isExpired($now) && $this->owner === $owner;
    }

    /**
     * Determines whether a requester can acquire or renew the lease.
     */
    public static function canAcquire(?self $currentLease, string $requester, int $now): bool
    {
        if ($currentLease === null) {
            return true;
        }

        if ($currentLease->isExpired($now)) {
            return true;
        }

        return $currentLease->owner === $requester;
    }

    public function renew(int $now, ?int $newTtl = null): self
    {
        return new self(
            chatKey: $this->chatKey,
            owner: $this->owner,
            acquiredAt: $now,
            ttlSeconds: $newTtl ?? $this->ttlSeconds,
            metadata: $this->metadata,
        );
    }

    public function toArray(): array
    {
        return [
            'chatKey' => $this->chatKey,
            'owner' => $this->owner,
            'acquiredAt' => $this->acquiredAt,
            'ttlSeconds' => $this->ttlSeconds,
            'expiresAt' => $this->getExpiresAt(),
            'metadata' => $this->metadata,
        ];
    }

    public static function fromArray(array $data): self
    {
        return new self(
            chatKey: (string) ($data['chatKey'] ?? ''),
            owner: (string) ($data['owner'] ?? ''),
            acquiredAt: (int) ($data['acquiredAt'] ?? 0),
            ttlSeconds: (int) ($data['ttlSeconds'] ?? self::DEFAULT_TTL_SECONDS),
            metadata: (array) ($data['metadata'] ?? []),
        );
    }
}
