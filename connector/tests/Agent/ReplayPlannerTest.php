<?php

declare(strict_types=1);

namespace ReplyFlow\Tests\Agent;

use PHPUnit\Framework\TestCase;
use ReplyFlow\Agent\ReplayPlanner;

final class ReplayPlannerTest extends TestCase
{
    private ReplayPlanner $planner;

    protected function setUp(): void
    {
        $this->planner = new ReplayPlanner();
    }

    public function testPressButtonReissuedUnconditionally(): void
    {
        $intent = [
            'callId' => 'call_1',
            'tool' => 'press_button',
            'arguments' => ['chat' => '@bot', 'button' => 'Spin'],
        ];

        // Even with empty history and 0 attempts
        $this->assertSame(
            ReplayPlanner::DECISION_REISSUE,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: [])
        );

        // With arbitrary history, still re-issued
        $history = [
            ['id' => 123, 'message' => 'welcome', 'out' => false],
        ];
        $this->assertSame(
            ReplayPlanner::DECISION_REISSUE,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: $history)
        );
    }

    public function testSendTextVerifiesHistory(): void
    {
        $intent = [
            'callId' => 'call_2',
            'tool' => 'send_text',
            'arguments' => ['chat' => '@user', 'text' => 'Hello there!'],
        ];

        // 1. Not in history -> reissue
        $history1 = [
            ['id' => 1, 'text' => 'Some other message', 'out' => true],
            ['id' => 2, 'text' => 'Hello there!', 'out' => false], // incoming, not our sent text
        ];
        $this->assertSame(
            ReplayPlanner::DECISION_REISSUE,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: $history1)
        );

        // 2. Already landed in outgoing history -> skip
        $history2 = [
            ['id' => 1, 'text' => 'Some other message', 'out' => true],
            ['id' => 3, 'text' => 'Hello there!', 'out' => true],
        ];
        $this->assertSame(
            ReplayPlanner::DECISION_SKIP,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: $history2)
        );
    }

    public function testReactVerifiesHistory(): void
    {
        $intent = [
            'callId' => 'call_3',
            'tool' => 'react',
            'arguments' => ['chat' => '@user', 'messageId' => '100', 'emoji' => '🔥'],
        ];

        // Not present -> reissue
        $historyNoReaction = [
            ['id' => '100', 'message' => 'test', 'reactions' => []],
        ];
        $this->assertSame(
            ReplayPlanner::DECISION_REISSUE,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: $historyNoReaction)
        );

        // Reaction present -> skip
        $historyWithReaction = [
            ['id' => '100', 'message' => 'test', 'reactions' => [['emoji' => '🔥', 'isSelf' => true]]],
        ];
        $this->assertSame(
            ReplayPlanner::DECISION_SKIP,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: $historyWithReaction)
        );
    }

    public function testForwardToSavedVerifiesHistory(): void
    {
        $intent = [
            'callId' => 'call_4',
            'tool' => 'forward_to_saved',
            'arguments' => ['chat' => '@user', 'messageId' => '500'],
        ];

        // Absent in Saved Messages -> reissue
        $savedWithout = [
            ['id' => '1', 'fwdMsgId' => '499'],
        ];
        $this->assertSame(
            ReplayPlanner::DECISION_REISSUE,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: $savedWithout)
        );

        // Present in Saved Messages -> skip
        $savedWith = [
            ['id' => '2', 'fwdMsgId' => '500'],
        ];
        $this->assertSame(
            ReplayPlanner::DECISION_SKIP,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: $savedWith)
        );
    }

    public function testCrashLoopProtectionAbandonsAfterOneAttempt(): void
    {
        $intent = [
            'callId' => 'call_btn',
            'tool' => 'press_button',
            'arguments' => ['chat' => '@bot', 'button' => 'Spin'],
        ];

        // 0 attempts -> allowed to reissue
        $this->assertSame(
            ReplayPlanner::DECISION_REISSUE,
            $this->planner->plan($intent, attemptCount: 0, recentHistory: [])
        );

        // 1 or more attempts -> strictly abandon
        $this->assertSame(
            ReplayPlanner::DECISION_ABANDON,
            $this->planner->plan($intent, attemptCount: 1, recentHistory: [])
        );
        $this->assertSame(
            ReplayPlanner::DECISION_ABANDON,
            $this->planner->plan($intent, attemptCount: 2, recentHistory: [])
        );
    }

    public function testPlanAll(): void
    {
        $intents = [
            [
                'callId' => 'c1',
                'turnId' => 't1',
                'chatKey' => '@bot',
                'tool' => 'press_button',
            ],
            [
                'callId' => 'c2',
                'turnId' => 't2',
                'chatKey' => '@user',
                'tool' => 'send_text',
                'arguments' => ['text' => 'Hi'],
            ],
        ];

        $turnAttempts = ['t1' => 0, 't2' => 1]; // t2 has already been attempted once
        $chatHistories = [
            '@user' => [],
        ];

        $decisions = $this->planner->planAll($intents, $turnAttempts, $chatHistories);

        $this->assertSame(ReplayPlanner::DECISION_REISSUE, $decisions['c1']['decision']);
        $this->assertSame(ReplayPlanner::DECISION_ABANDON, $decisions['c2']['decision']);
    }
}
