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
}

