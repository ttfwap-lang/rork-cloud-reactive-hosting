<?php

declare(strict_types=1);

namespace ReplyFlow\Tests\Agent;

use PHPUnit\Framework\TestCase;
use ReplyFlow\Agent\TurnQueue;

final class TurnQueueTest extends TestCase
{
    public function testFifoQueueOrdering(): void
    {
        $queue = new TurnQueue();

        $this->assertTrue($queue->isEmpty('@chat1'));
        $this->assertSame(0, $queue->size('@chat1'));
        $this->assertNull($queue->dequeue('@chat1'));

        $queue->enqueue('@chat1', 'item_1');
        $queue->enqueue('@chat1', 'item_2');
        $queue->enqueue('@chat1', 'item_3');

        $this->assertFalse($queue->isEmpty('@chat1'));
        $this->assertSame(3, $queue->size('@chat1'));
        $this->assertSame('item_1', $queue->peek('@chat1'));

        $this->assertSame('item_1', $queue->dequeue('@chat1'));
        $this->assertSame('item_2', $queue->dequeue('@chat1'));
        $this->assertSame('item_3', $queue->dequeue('@chat1'));
        $this->assertNull($queue->dequeue('@chat1'));
        $this->assertTrue($queue->isEmpty('@chat1'));
    }

    public function testCrossChatIndependence(): void
    {
        $queue = new TurnQueue();

        $queue->enqueue('@chat_a', 'a1');
        $queue->enqueue('@chat_b', 'b1');
        $queue->enqueue('@chat_a', 'a2');

        $this->assertSame(['@chat_a', '@chat_b'], $queue->getQueuedChats());
        $this->assertSame('a1', $queue->dequeue('@chat_a'));
        $this->assertSame('b1', $queue->dequeue('@chat_b'));
        $this->assertSame('a2', $queue->dequeue('@chat_a'));
    }

    public function testTurnAdmissionSequencing(): void
    {
        $queue = new TurnQueue();

        $this->assertFalse($queue->isTurnActive('@chat1'));

        // Start turn 1: should be admitted
        $this->assertTrue($queue->startTurn('@chat1', 'turn_101'));
        $this->assertTrue($queue->isTurnActive('@chat1'));
        $this->assertSame('turn_101', $queue->getActiveTurnId('@chat1'));

        // Simultaneous second turn for same chat: must be rejected (sequential admission)
        $this->assertFalse($queue->startTurn('@chat1', 'turn_102'));
        $this->assertSame('turn_101', $queue->getActiveTurnId('@chat1'));

        // Different chat can start concurrently (unbounded cross-chat)
        $this->assertTrue($queue->startTurn('@chat2', 'turn_201'));
        $this->assertTrue($queue->isTurnActive('@chat2'));

        // Finishing turn 101 on chat1 admits future turns
        $queue->finishTurn('@chat1', 'turn_101');
        $this->assertFalse($queue->isTurnActive('@chat1'));
        $this->assertNull($queue->getActiveTurnId('@chat1'));

        // Chat 2 is still active
        $this->assertTrue($queue->isTurnActive('@chat2'));

        // Now turn 102 can be admitted
        $this->assertTrue($queue->startTurn('@chat1', 'turn_102'));
    }

    public function testClear(): void
    {
        $queue = new TurnQueue();
        $queue->enqueue('@chat1', 'item');
        $queue->startTurn('@chat1', 'turn_1');
        $queue->enqueue('@chat2', 'item');

        $queue->clear('@chat1');
        $this->assertTrue($queue->isEmpty('@chat1'));
        $this->assertFalse($queue->isTurnActive('@chat1'));
        $this->assertFalse($queue->isEmpty('@chat2'));

        $queue->clear();
        $this->assertTrue($queue->isEmpty('@chat2'));
    }
}
