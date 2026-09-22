<?php

declare(strict_types=1);

namespace ReplyFlow\Tests\Agent;

use PHPUnit\Framework\TestCase;
use ReplyFlow\Agent\AgentState;

final class AgentStateTest extends TestCase
{
    public function testFoldEventsProgressively(): void
    {
        $events = [
            [
                'kind' => 'instruction',
                'chatKey' => '@control',
                'text' => 'Check the bonus bot',
                'timestamp' => 1000,
            ],
            [
                'kind' => 'lease.acquired',
                'chatKey' => '@bonus_bot',
                'owner' => 'agent',
                'ttlSeconds' => 120,
                'timestamp' => 1005,
            ],
            [
                'kind' => 'turn.start',
                'turnId' => 'turn_1',
                'chatKey' => '@bonus_bot',
                'timestamp' => 1010,
            ],
            [
                'kind' => 'turn.attempt',
                'turnId' => 'turn_1',
                'timestamp' => 1011,
            ],
            [
                'kind' => 'tool.intent',
                'callId' => 'call_btn',
                'turnId' => 'turn_1',
                'chatKey' => '@bonus_bot',
                'tool' => 'press_button',
                'arguments' => ['button' => 'Claim'],
                'timestamp' => 1012,
            ],
        ];

        $state = AgentState::foldEvents($events);

        // 1. Transcripts
        $this->assertCount(1, $state->getTranscript('@control'));
        $this->assertSame('Check the bonus bot', $state->getTranscript('@control')[0]['text']);
        $this->assertCount(2, $state->getTranscript('@bonus_bot')); // turn.start and tool.intent

        // 2. Leases
        $this->assertTrue($state->isLeased('@bonus_bot', 1050));
        $this->assertFalse($state->isLeased('@bonus_bot', 1130)); // 1005 + 120 = 1125 expiry
        $this->assertCount(1, $state->getHeldLeases(1050));
        $this->assertCount(0, $state->getHeldLeases(1130));

        // 3. Turn attempts & active turns
        $this->assertSame(1, $state->getTurnAttempts('turn_1'));
        $this->assertArrayHasKey('turn_1', $state->getActiveTurns());

        // 4. Pending tool intents
        $this->assertTrue($state->hasPendingToolIntents());
        $this->assertTrue($state->hasPendingToolIntents('@bonus_bot'));
        $this->assertFalse($state->hasPendingToolIntents('@other'));
        $this->assertCount(1, $state->getPendingToolIntents());
        $this->assertSame('call_btn', $state->getPendingToolIntents()[0]['callId']);

        // 5. Tool result resolves intent
        $state->apply([
            'kind' => 'tool.result',
            'callId' => 'call_btn',
            'turnId' => 'turn_1',
            'chatKey' => '@bonus_bot',
            'result' => ['status' => 'clicked'],
            'timestamp' => 1015,
        ]);
        $this->assertFalse($state->hasPendingToolIntents('@bonus_bot'));

        // 6. Turn end cleans up turn
        $state->apply([
            'kind' => 'turn.end',
            'turnId' => 'turn_1',
            'chatKey' => '@bonus_bot',
            'timestamp' => 1020,
        ]);
        $this->assertArrayNotHasKey('turn_1', $state->getActiveTurns());

        // 7. Lease released
        $state->apply([
            'kind' => 'lease.released',
            'chatKey' => '@bonus_bot',
            'timestamp' => 1025,
        ]);
        $this->assertFalse($state->isLeased('@bonus_bot', 1026));
        $this->assertNull($state->getLease('@bonus_bot'));

        $this->assertSame(1025, $state->getLastEventTime());
    }

    public function testTurnAbandonedClearsPendingIntents(): void
    {
        $state = new AgentState();
        $state->apply([
            'kind' => 'turn.start',
            'turnId' => 'turn_crash',
            'chatKey' => '@bot',
            'timestamp' => 100,
        ]);
        $state->apply([
            'kind' => 'tool.intent',
            'callId' => 'call_orphan',
            'turnId' => 'turn_crash',
            'chatKey' => '@bot',
            'tool' => 'send_text',
            'timestamp' => 101,
        ]);

        $this->assertTrue($state->hasPendingToolIntents());

        $state->apply([
            'kind' => 'turn.abandoned',
            'turnId' => 'turn_crash',
            'chatKey' => '@bot',
            'timestamp' => 105,
        ]);

        $this->assertFalse($state->hasPendingToolIntents());
        $this->assertArrayNotHasKey('turn_crash', $state->getActiveTurns());
    }
}
