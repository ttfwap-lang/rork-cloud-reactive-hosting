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
        putenv('DATA_DIR='.$this->tempDir);
        putenv('SESSION_ENCRYPTION_KEY=12345678901234567890123456789012');
        putenv('GEMINI_API_KEY=test_key_123');

        StateStore::writeAgentConfig([
            'controlChat' => '@agent_control',
            'model' => 'gemini-2.5-flash',
        ]);
    }

    protected function tearDown(): void
    {
        $files = glob($this->tempDir.'/*');
        if ($files) {
            foreach ($files as $file) {
                if (is_file($file)) {
                    unlink($file);
                }
            }
        }
        @rmdir($this->tempDir);
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
}
