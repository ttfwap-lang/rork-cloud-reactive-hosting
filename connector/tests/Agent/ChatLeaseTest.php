<?php

declare(strict_types=1);

namespace ReplyFlow\Tests\Agent;

use PHPUnit\Framework\TestCase;
use ReplyFlow\Agent\ChatLease;

final class ChatLeaseTest extends TestCase
{
    public function testExpiryDecision(): void
    {
        $now = 1000;
        $lease = new ChatLease(
            chatKey: '@astro1',
            owner: 'agent',
            acquiredAt: $now,
            ttlSeconds: 60,
        );

        $this->assertSame(1060, $lease->getExpiresAt());
        $this->assertFalse($lease->isExpired($now));
        $this->assertFalse($lease->isExpired($now + 59));
        $this->assertTrue($lease->isExpired($now + 60));
        $this->assertTrue($lease->isExpired($now + 100));

        $this->assertSame(60, $lease->remainingTtl($now));
        $this->assertSame(1, $lease->remainingTtl($now + 59));
        $this->assertSame(0, $lease->remainingTtl($now + 60));
        $this->assertSame(0, $lease->remainingTtl($now + 120));
    }

    public function testOwnershipCheck(): void
    {
        $now = 1000;
        $lease = new ChatLease('@astro1', 'agent', $now, 60);

        $this->assertTrue($lease->isHeldBy('agent', $now + 30));
        $this->assertFalse($lease->isHeldBy('other_agent', $now + 30));
        $this->assertFalse($lease->isHeldBy('agent', $now + 60)); // expired
    }

    public function testCanAcquire(): void
    {
        $now = 1000;

        // 1. When no current lease exists
        $this->assertTrue(ChatLease::canAcquire(null, 'agent', $now));

        // 2. When current lease is active and held by someone else
        $activeLease = new ChatLease('@astro1', 'agent_a', $now, 60);
        $this->assertFalse(ChatLease::canAcquire($activeLease, 'agent_b', $now + 10));

        // 3. When current lease is active and held by same requester (renewal)
        $this->assertTrue(ChatLease::canAcquire($activeLease, 'agent_a', $now + 10));

        // 4. When current lease has expired
        $expiredLease = new ChatLease('@astro1', 'agent_a', $now, 60);
        $this->assertTrue(ChatLease::canAcquire($expiredLease, 'agent_b', $now + 60));
        $this->assertTrue(ChatLease::canAcquire($expiredLease, 'agent_b', $now + 100));
    }

    public function testRenew(): void
    {
        $now = 1000;
        $lease = new ChatLease('@astro1', 'agent', $now, 60, ['meta' => 'val']);

        $renewed = $lease->renew(now: 1050, newTtl: 120);

        $this->assertSame('@astro1', $renewed->chatKey);
        $this->assertSame('agent', $renewed->owner);
        $this->assertSame(1050, $renewed->acquiredAt);
        $this->assertSame(120, $renewed->ttlSeconds);
        $this->assertSame(1170, $renewed->getExpiresAt());
        $this->assertSame(['meta' => 'val'], $renewed->metadata);
    }

    public function testSerializationRoundTrip(): void
    {
        $lease = new ChatLease('@chat123', 'worker', 123456, 300, ['priority' => 'high']);
        $array = $lease->toArray();
        $restored = ChatLease::fromArray($array);

        $this->assertSame($lease->chatKey, $restored->chatKey);
        $this->assertSame($lease->owner, $restored->owner);
        $this->assertSame($lease->acquiredAt, $restored->acquiredAt);
        $this->assertSame($lease->ttlSeconds, $restored->ttlSeconds);
        $this->assertSame($lease->metadata, $restored->metadata);
    }
}
