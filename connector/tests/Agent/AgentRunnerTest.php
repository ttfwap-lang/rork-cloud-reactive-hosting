<?php

declare(strict_types=1);

namespace ReplyFlow\Tests\Agent;

use PHPUnit\Framework\TestCase;
use ReplyFlow\Agent\AgentLog;
use ReplyFlow\Agent\AgentRunner;
use ReplyFlow\Agent\AgentState;
use ReplyFlow\Agent\AgentTools;
use ReplyFlow\Agent\TurnQueue;
use ReplyFlow\GeminiClient;
use ReplyFlow\StateStore;

final class AgentRunnerTest extends TestCase
{
    private string $tempDir;

    protected function setUp(): void
    {
        $this->tempDir = sys_get_temp_dir().'/replyflow_agent_runner_test_'.uniqid();
        mkdir($this->tempDir, 0700, true);
        putenv('SESSION_PATH='.$this->tempDir);
        putenv('DATA_DIR='.$this->tempDir);
        putenv('SESSION_ENCRYPTION_KEY=12345678901234567890123456789012');
        putenv('GEMINI_API_KEY=test_key_123');
        StateStore::use(StateStore::OWNER_TENANT);

        StateStore::writeAgentConfig([
            'controlChat' => '@agent_control',
            'model' => 'gemini-3.7-flash',
        ]);
    }

    protected function tearDown(): void
    {
        \ReplyFlow\EventForwarder::setInterceptor(null);
        if (is_dir($this->tempDir)) {
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($this->tempDir, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($iterator as $item) {
                $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
            }
            @rmdir($this->tempDir);
        }
        putenv('SESSION_PATH');
    }

    public function testControlChatMatching(): void
    {
        $runner = new AgentRunner();
        $this->assertTrue($runner->isConfigured());
        $this->assertTrue($runner->isControlChat('@agent_control'));
        $this->assertTrue($runner->isControlChat('agent_control'));
        $this->assertTrue($runner->isControlChat('12345', '@agent_control')); // sender matched
        $this->assertFalse($runner->isControlChat('@other_chat', 'someone_else'));
    }

    public function testHandleMessageRouting(): void
    {
        $runner = new AgentRunner();
        $proto = new class {};

        // 1. Control chat message -> intercepted
        $msgControl = [
            'chatKey' => '@agent_control',
            'sender' => '@owner',
            'text' => 'Check the weather',
            'messageId' => '101',
        ];
        $handled = $runner->handleMessage($msgControl, $proto);
        $this->assertTrue($handled);

        // Verify instruction event was logged
        $events = AgentLog::readAll('@agent_control');
        $this->assertNotEmpty($events);
        $this->assertSame('instruction', $events[0]['kind']);

        // 2. Unleased non-control chat -> not intercepted (forwarded normally)
        $msgNormal = [
            'chatKey' => '@random_user',
            'sender' => '@random_user',
            'text' => 'Hello',
            'messageId' => '102',
        ];
        $handledNormal = $runner->handleMessage($msgNormal, $proto);
        $this->assertFalse($handledNormal);

        // 3. Leased chat -> intercepted
        $runner->acquireLease('@leased_bot');
        $this->assertTrue($runner->isLeased('@leased_bot'));

        $msgLeased = [
            'chatKey' => '@leased_bot',
            'sender' => '@leased_bot',
            'text' => 'Game prompt',
            'messageId' => '103',
        ];
        $handledLeased = $runner->handleMessage($msgLeased, $proto);
        $this->assertTrue($handledLeased);

        // Verify observation event was logged in leased chat
        $leasedEvents = AgentLog::readAll('@leased_bot');
        $this->assertNotEmpty($leasedEvents);
        $kinds = array_column($leasedEvents, 'kind');
        $this->assertContains('lease.acquired', $kinds);
        $this->assertContains('observation', $kinds);
    }

    public function testRunTurnExecutesToolWithWriteAheadLog(): void
    {
        // Mock GeminiClient that returns one tool call (send_text), then finished
        $mockGemini = $this->createMock(GeminiClient::class);
        $mockGemini->expects($this->exactly(2))
            ->method('generateContent')
            ->willReturnOnConsecutiveCalls(
                // Call 1: model calls send_text tool
                [
                    'candidates' => [
                        [
                            'content' => [
                                'parts' => [
                                    [
                                        'functionCall' => [
                                            'name' => 'send_text',
                                            'args' => [
                                                'chat' => '@target_user',
                                                'text' => 'Automated reply',
                                            ],
                                        ],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
                // Call 2: model concludes
                [
                    'candidates' => [
                        [
                            'content' => [
                                'parts' => [
                                    ['text' => 'Sent message successfully.'],
                                ],
                            ],
                        ],
                    ],
                ]
            );

        $mockTools = $this->createMock(AgentTools::class);
        $mockTools->expects($this->once())
            ->method('execute')
            ->with('send_text', ['chat' => '@target_user', 'text' => 'Automated reply'])
            ->willReturn(['ok' => true, 'sent' => true]);

        $runner = new AgentRunner(
            gemini: $mockGemini,
            tools: $mockTools,
        );

        $proto = new class {};
        $item = [
            'type' => 'instruction',
            'message' => [
                'chatKey' => '@agent_control',
                'sender' => '@owner',
                'text' => 'Say hello to @target_user',
                'messageId' => '55',
            ],
        ];

        $runner->runTurn('@agent_control', 'turn_test_1', $item, $proto);

        // Inspect log events
        $events = AgentLog::readAll('@agent_control');
        $kinds = array_column($events, 'kind');

        $this->assertContains('turn.start', $kinds);
        $this->assertContains('tool.intent', $kinds);
        $this->assertContains('tool.result', $kinds);
        $this->assertContains('turn.end', $kinds);

        // Verify target chat lease was acquired
        $this->assertTrue($runner->isLeased('@target_user'));
    }

    public function testRecoverOrphansReissuesMissingAndSkipsConfirmed(): void
    {
        // 1. Write an uncompleted intent for press_button (must reissue unconditionally)
        AgentLog::append('@bot_chat', [
            'kind' => 'turn.start',
            'chatKey' => '@bot_chat',
            'turnId' => 'turn_btn',
            'timestamp' => 2000,
        ]);
        AgentLog::append('@bot_chat', [
            'kind' => 'tool.intent',
            'chatKey' => '@bot_chat',
            'turnId' => 'turn_btn',
            'callId' => 'call_btn',
            'tool' => 'press_button',
            'arguments' => ['chat' => '@bot_chat', 'button' => 'Spin'],
            'timestamp' => 2001,
        ]);

        $mockTools = $this->createMock(AgentTools::class);
        $mockTools->expects($this->once())
            ->method('execute')
            ->with('press_button', ['chat' => '@bot_chat', 'button' => 'Spin'])
            ->willReturn(['ok' => true, 'pressed' => true]);

        $runner = new AgentRunner(
            tools: $mockTools,
        );

        $proto = new class {
            public object $messages;
            public function __construct() {
                $this->messages = new class {
                    public function getHistory(string $peer, int $limit): array {
                        return ['messages' => []];
                    }
                };
            }
        };

        $decisions = $runner->recoverOrphans($proto);
        $this->assertArrayHasKey('call_btn', $decisions);
        $this->assertSame('reissue', $decisions['call_btn']['decision']);

        // Verify turn.attempt and tool.result were written
        $events = AgentLog::readAll('@bot_chat');
        $kinds = array_column($events, 'kind');
        $this->assertContains('turn.attempt', $kinds);
        $this->assertContains('tool.result', $kinds);
    }

    public function testTurnLoopStopsAtMaxIterationsAndEmitsTurnAbandoned(): void
    {
        $mockGemini = $this->createMock(GeminiClient::class);
        $mockGemini->expects($this->exactly(AgentRunner::MAX_TOOL_ITERATIONS))
            ->method('generateContent')
            ->willReturn([
                'candidates' => [
                    [
                        'content' => [
                            'parts' => [
                                [
                                    'functionCall' => [
                                        'name' => 'read_history',
                                        'args' => ['chat' => '@loop_target'],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ]);

        $mockTools = $this->createMock(AgentTools::class);
        $mockTools->expects($this->exactly(AgentRunner::MAX_TOOL_ITERATIONS))
            ->method('execute')
            ->willReturn(['messages' => []]);

        $runner = new AgentRunner(
            gemini: $mockGemini,
            tools: $mockTools,
        );

        $proto = new class {};
        $item = [
            'type' => 'instruction',
            'message' => [
                'chatKey' => '@agent_control',
                'sender' => '@owner',
                'text' => 'Keep looping',
                'messageId' => '201',
            ],
        ];

        $runner->runTurn('@agent_control', 'turn_loop_test', $item, $proto);

        $events = AgentLog::readAll('@agent_control');
        $kinds = array_column($events, 'kind');

        $this->assertContains('turn.start', $kinds);
        $this->assertContains('turn.abandoned', $kinds);
        $this->assertNotContains('turn.end', $kinds);

        $abandoned = null;
        foreach ($events as $ev) {
            if ($ev['kind'] === 'turn.abandoned') {
                $abandoned = $ev;
                break;
            }
        }
        $this->assertNotNull($abandoned);
        $this->assertSame('Reached maximum tool iterations (25)', $abandoned['error']);
    }

    public function testReleaseLeaseToolDispatchesAndReleasesLeaseWithoutAutoAcquire(): void
    {
        $mockGemini = $this->createMock(GeminiClient::class);
        $mockGemini->expects($this->exactly(2))
            ->method('generateContent')
            ->willReturnOnConsecutiveCalls(
                [
                    'candidates' => [
                        [
                            'content' => [
                                'parts' => [
                                    [
                                        'functionCall' => [
                                            'name' => 'release_lease',
                                            'args' => ['chat' => '@leased_target'],
                                        ],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
                [
                    'candidates' => [
                        [
                            'content' => [
                                'parts' => [
                                    ['text' => 'Released lease successfully.'],
                                ],
                            ],
                        ],
                    ],
                ]
            );

        $mockTools = $this->createMock(AgentTools::class);
        $mockTools->expects($this->never())->method('execute');

        $runner = new AgentRunner(
            gemini: $mockGemini,
            tools: $mockTools,
        );

        // Pre-acquire lease on @leased_target
        $runner->acquireLease('@leased_target');
        $this->assertTrue($runner->isLeased('@leased_target'));

        $proto = new class {};
        $item = [
            'type' => 'instruction',
            'message' => [
                'chatKey' => '@agent_control',
                'sender' => '@owner',
                'text' => 'Release @leased_target',
                'messageId' => '202',
            ],
        ];

        $runner->runTurn('@agent_control', 'turn_release_test', $item, $proto);

        // Verify lease was released
        $this->assertFalse($runner->isLeased('@leased_target'));

        // Verify events recorded
        $events = AgentLog::readAll('@agent_control');
        $kinds = array_column($events, 'kind');

        $this->assertContains('tool.intent', $kinds);
        $this->assertContains('tool.result', $kinds);
        $this->assertContains('turn.end', $kinds);

        $resultEvent = null;
        foreach ($events as $ev) {
            if ($ev['kind'] === 'tool.result' && $ev['tool'] === 'release_lease') {
                $resultEvent = $ev;
                break;
            }
        }
        $this->assertNotNull($resultEvent);
        $this->assertSame(['ok' => true, 'released' => '@leased_target'], $resultEvent['result']['output'] ?? null);
    }

    public function testConfigFreshnessReloadsControlChatWithoutReconstructingRunner(): void
    {
        StateStore::writeAgentConfig([
            'controlChat' => '@initial_control',
            'apiKey' => 'test-key',
        ]);

        $runner = new AgentRunner();
        $this->assertSame('@initial_control', $runner->getControlChat());
        $this->assertTrue($runner->isControlChat('@initial_control'));
        $this->assertFalse($runner->isControlChat('@updated_control'));

        // Modify sealed config on disk without reconstructing the runner
        touch(StateStore::path('agent-config.sealed'), time() + 5);
        StateStore::writeAgentConfig([
            'controlChat' => '@updated_control',
            'apiKey' => 'test-key-2',
        ]);

        // Freshness check must reload and recognize the new control chat immediately
        $this->assertSame('@updated_control', $runner->getControlChat());
        $this->assertTrue($runner->isControlChat('@updated_control'));
        $this->assertFalse($runner->isControlChat('@initial_control'));

        // Clearing control chat must also be recognized immediately
        touch(StateStore::path('agent-config.sealed'), time() + 10);
        StateStore::writeAgentConfig([
            'controlChat' => '',
            'apiKey' => 'test-key-2',
        ]);

        $this->assertSame('', $runner->getControlChat());
        $this->assertFalse($runner->isControlChat('@updated_control'));
    }

    public function testWorkerMediatedToolDispatchInTurnLoop(): void
    {
        $mockGemini = $this->createMock(GeminiClient::class);
        $mockGemini->expects($this->exactly(2))
            ->method('generateContent')
            ->willReturnOnConsecutiveCalls(
                [
                    'candidates' => [
                        [
                            'content' => [
                                'parts' => [
                                    [
                                        'functionCall' => [
                                            'name' => 'patch_settings',
                                            'args' => ['settings' => ['killSwitch' => true]],
                                        ],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
                [
                    'candidates' => [
                        [
                            'content' => [
                                'parts' => [
                                    ['text' => 'Settings patched successfully.'],
                                ],
                            ],
                        ],
                    ],
                ]
            );

        $mockTools = $this->createMock(AgentTools::class);
        $mockTools->expects($this->never())->method('execute');

        $dispatchedTool = null;
        $dispatchedArgs = null;
        $runner = new AgentRunner(
            gemini: $mockGemini,
            tools: $mockTools,
            workerToolDispatcher: function (string $tool, array $args) use (&$dispatchedTool, &$dispatchedArgs): array {
                $dispatchedTool = $tool;
                $dispatchedArgs = $args;
                return ['ok' => true, 'settings' => ['killSwitch' => true]];
            },
        );

        $proto = new class {};
        $item = [
            'type' => 'instruction',
            'message' => [
                'chatKey' => '@agent_control',
                'sender' => '@owner',
                'text' => 'Emergency stop',
                'messageId' => '303',
            ],
        ];

        $runner->runTurn('@agent_control', 'turn_worker_tool_test', $item, $proto);

        $this->assertSame('patch_settings', $dispatchedTool);
        $this->assertSame(['settings' => ['killSwitch' => true]], $dispatchedArgs);

        $events = AgentLog::readAll('@agent_control');
        $toolResult = null;
        foreach ($events as $ev) {
            if ($ev['kind'] === 'tool.result' && $ev['tool'] === 'patch_settings') {
                $toolResult = $ev;
                break;
            }
        }
        $this->assertNotNull($toolResult);
        $this->assertSame(['ok' => true, 'settings' => ['killSwitch' => true]], $toolResult['result']['output'] ?? null);
    }

    public function testRecoverOrphansRestoresLeasedStateFromLogs(): void
    {
        // 1. Pre-existing log with active lease.acquired before child restart
        AgentLog::append('@leased_bot', [
            'kind' => 'lease.acquired',
            'chatKey' => '@leased_bot',
            'owner' => 'agent',
            'timestamp' => time(),
            'ttlSeconds' => 300,
        ]);

        // Fresh AgentRunner instance (simulating child restart)
        $runner = new AgentRunner();
        $this->assertFalse($runner->isLeased('@leased_bot'));

        $proto = new class {
            public object $messages;
            public function __construct() {
                $this->messages = new class {
                    public function getHistory(string $peer, int $limit): array {
                        return ['messages' => []];
                    }
                };
            }
        };

        // Recover orphans restores state from folded logs
        $runner->recoverOrphans($proto);

        // Active lease is now reflected in local runner state
        $this->assertTrue($runner->isLeased('@leased_bot'));

        // Leased chat message after restart remains intercepted rather than forwarded normally
        $msg = [
            'chatKey' => '@leased_bot',
            'sender' => '@leased_bot',
            'text' => 'Game prompt',
            'messageId' => '201',
        ];
        $handled = $runner->handleMessage($msg, $proto);
        $this->assertTrue($handled);
    }

    public function testRedactedObservationPostingForAmbientLeasedChat(): void
    {
        $postedEvents = [];
        \ReplyFlow\EventForwarder::setInterceptor(static function (array $payload) use (&$postedEvents): void {
            if (($payload['type'] ?? '') === 'agent_log') {
                $postedEvents[] = $payload['event'] ?? [];
            }
        });

        $runner = new AgentRunner();
        $proto = new class {};

        // 1. Control chat message: instruction text remains present in agent_log payload
        $msgControl = [
            'chatKey' => '@agent_control',
            'sender' => '@owner',
            'text' => 'Sensitive user instruction',
            'messageId' => '301',
        ];
        $runner->handleMessage($msgControl, $proto);

        $this->assertNotEmpty($postedEvents);
        $lastEvent = end($postedEvents);
        $this->assertSame('instruction', $lastEvent['kind']);
        $this->assertSame('Sensitive user instruction', $lastEvent['text'] ?? null);

        // Verify sealed log also retains instruction text
        $controlLogs = AgentLog::readAll('@agent_control');
        $this->assertSame('Sensitive user instruction', $controlLogs[0]['text']);

        // 2. Leased chat message: observation text must be absent from agent_log payload
        $runner->acquireLease('@leased_bot');
        $msgLeased = [
            'chatKey' => '@leased_bot',
            'sender' => '@leased_bot',
            'text' => 'Ambient bot reply text',
            'messageId' => '302',
        ];
        $runner->handleMessage($msgLeased, $proto);

        $observationEvents = array_values(array_filter(
            $postedEvents,
            static fn (array $e): bool => ($e['kind'] ?? '') === 'observation'
        ));
        $this->assertCount(1, $observationEvents);
        // Ambient observation text is absent from connector-to-Worker agent_log payload
        $this->assertArrayNotHasKey('text', $observationEvents[0]);
        $this->assertSame('@leased_bot', $observationEvents[0]['chatKey']);

        // Verify sealed connector log STILL retains full observation text
        $leasedLogs = AgentLog::readAll('@leased_bot');
        $obsInLog = array_values(array_filter(
            $leasedLogs,
            static fn (array $e): bool => ($e['kind'] ?? '') === 'observation'
        ));
        $this->assertCount(1, $obsInLog);
        $this->assertSame('Ambient bot reply text', $obsInLog[0]['text']);
    }

    public function testRecoverOrphansPreservesSameSecondEventOrdering(): void
    {
        $now = time();

        // 1. Same-second lease acquisition and release in the same log file
        // Append order: lease.acquired then lease.released
        AgentLog::append('@same_sec_bot', [
            'kind' => 'lease.acquired',
            'chatKey' => '@same_sec_bot',
            'owner' => 'agent',
            'timestamp' => $now,
            'ttlSeconds' => 300,
        ]);
        AgentLog::append('@same_sec_bot', [
            'kind' => 'lease.released',
            'chatKey' => '@same_sec_bot',
            'timestamp' => $now,
        ]);

        // 2. Same-second tool intent and result
        // Append order: turn.start -> tool.intent -> tool.result -> turn.end
        AgentLog::append('@same_sec_bot', [
            'kind' => 'turn.start',
            'chatKey' => '@same_sec_bot',
            'turnId' => 'turn-samesec-1',
            'timestamp' => $now,
        ]);
        AgentLog::append('@same_sec_bot', [
            'kind' => 'tool.intent',
            'chatKey' => '@same_sec_bot',
            'turnId' => 'turn-samesec-1',
            'callId' => 'call-samesec-1',
            'tool' => 'send_text',
            'arguments' => ['text' => 'hello'],
            'timestamp' => $now,
        ]);
        AgentLog::append('@same_sec_bot', [
            'kind' => 'tool.result',
            'chatKey' => '@same_sec_bot',
            'turnId' => 'turn-samesec-1',
            'callId' => 'call-samesec-1',
            'tool' => 'send_text',
            'result' => ['output' => ['messageId' => '555']],
            'timestamp' => $now,
        ]);
        AgentLog::append('@same_sec_bot', [
            'kind' => 'turn.end',
            'chatKey' => '@same_sec_bot',
            'turnId' => 'turn-samesec-1',
            'timestamp' => $now,
        ]);

        // 3. Another chat with active lease acquired at the exact same second
        AgentLog::append('@active_bot', [
            'kind' => 'lease.acquired',
            'chatKey' => '@active_bot',
            'owner' => 'agent',
            'timestamp' => $now,
            'ttlSeconds' => 300,
        ]);

        $runner = new AgentRunner();
        $proto = new class {
            public object $messages;
            public function __construct() {
                $this->messages = new class {
                    public function getHistory(string $peer, int $limit): array {
                        return ['messages' => []];
                    }
                };
            }
        };

        $decisions = $runner->recoverOrphans($proto);

        // No orphaned intent should be replayed or skipped since tool.result resolved it
        $this->assertEmpty($decisions);

        // Lease on @same_sec_bot was released after acquisition in the same second
        $this->assertFalse($runner->isLeased('@same_sec_bot'));

        // Lease on @active_bot remains active
        $this->assertTrue($runner->isLeased('@active_bot'));

        // State reflects no pending intents and no active turns for @same_sec_bot
        $state = $runner->getState();
        $this->assertEmpty($state->getPendingToolIntents('@same_sec_bot'));
        $this->assertEmpty($state->getActiveTurns());

        // Transcript preserves events in strict append order
        $transcript = $runner->getTranscript('@same_sec_bot');
        $this->assertCount(4, $transcript);
        $this->assertSame('turn.start', $transcript[0]['kind']);
        $this->assertSame('tool.intent', $transcript[1]['kind']);
        $this->assertSame('tool.result', $transcript[2]['kind']);
        $this->assertSame('turn.end', $transcript[3]['kind']);
    }
}
