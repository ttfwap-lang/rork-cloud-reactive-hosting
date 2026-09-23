<?php

declare(strict_types=1);

namespace ReplyFlow\Tests\Agent;

use PHPUnit\Framework\TestCase;
use ReplyFlow\Agent\AgentTools;
use ReplyFlow\ConnectorException;

final class AgentToolsTest extends TestCase
{
    private AgentTools $tools;

    protected function setUp(): void
    {
        $this->tools = new AgentTools();
    }

    public function testDeclarationsCountAndNames(): void
    {
        $declarations = AgentTools::declarations();
        $this->assertCount(10, $declarations);

        $names = array_column($declarations, 'name');
        $this->assertContains('read_history', $names);
        $this->assertContains('send_text', $names);
        $this->assertContains('press_button', $names);
        $this->assertContains('react', $names);
        $this->assertContains('forward_to_saved', $names);
        $this->assertContains('mark_read', $names);
        $this->assertContains('release_lease', $names);
        $this->assertContains('patch_settings', $names);
        $this->assertContains('save_workflow', $names);
        $this->assertContains('start_batch_run', $names);
    }

    public function testSendText(): void
    {
        $proto = new class {
            public object $messages;
            public function __construct() {
                $this->messages = new class {
                    public function sendMessage(string $peer, string $message): array {
                        return ['id' => 999, 'peer' => $peer, 'message' => $message];
                    }
                };
            }
        };

        $result = $this->tools->execute('send_text', ['chat' => '@testbot', 'text' => 'hello'], $proto);
        $this->assertTrue($result['ok']);
        $this->assertTrue($result['sent']);
        $this->assertSame('999', $result['id']);
    }

    public function testReadHistory(): void
    {
        $proto = new class {
            public object $messages;
            public function __construct() {
                $this->messages = new class {
                    public function getHistory(string $peer, int $limit): array {
                        return [
                            'messages' => [
                                ['id' => 10, 'message' => 'msg 1', 'date' => 123456, 'out' => false],
                                ['id' => 11, 'message' => 'msg 2', 'date' => 123457, 'out' => true],
                            ],
                        ];
                    }
                };
            }
        };

        $result = $this->tools->execute('read_history', ['chat' => '@testbot', 'limit' => 5], $proto);
        $this->assertTrue($result['ok']);
        $this->assertSame(2, $result['count']);
        $this->assertCount(2, $result['messages']);
    }

    public function testPressButton(): void
    {
        $proto = new class {
            public object $messages;
            public bool $pressed = false;
            public function __construct() {
                $this->messages = new class($this) {
                    private object $parent;
                    public function __construct(object $parent) { $this->parent = $parent; }
                    public function getHistory(string $peer, int $limit): array {
                        return [
                            'messages' => [
                                [
                                    'id' => 42,
                                    'reply_markup' => [
                                        'rows' => [
                                            [
                                                'buttons' => [
                                                    ['text' => 'Click Me', 'data' => 'data_123'],
                                                ],
                                            ],
                                        ],
                                    ],
                                ],
                            ],
                        ];
                    }
                    public function getBotCallbackAnswer(string $peer, int $msg_id, string $data): array {
                        $this->parent->pressed = true;
                        return ['ok' => true];
                    }
                };
            }
        };

        $result = $this->tools->execute('press_button', ['chat' => '@bot', 'button' => 'Click Me'], $proto);
        $this->assertTrue($result['ok']);
        $this->assertTrue($result['pressed']);
        $this->assertTrue($proto->pressed);
    }

    public function testReact(): void
    {
        $proto = new class {
            public object $messages;
            public function __construct() {
                $this->messages = new class {
                    public function sendReaction(string $peer, int $msg_id, array $reaction): array {
                        return ['ok' => true];
                    }
                };
            }
        };

        $result = $this->tools->execute('react', ['chat' => '@user', 'messageId' => '100', 'emoji' => '👍'], $proto);
        $this->assertTrue($result['ok']);
        $this->assertTrue($result['reacted']);
        $this->assertSame('👍', $result['emoji']);
    }

    public function testForwardToSaved(): void
    {
        $proto = new class {
            public object $messages;
            public function __construct() {
                $this->messages = new class {
                    public function forwardMessages(string $from_peer, int|string $to_peer, array $id): array {
                        return ['ok' => true];
                    }
                };
            }
            public function getSelf(): array {
                return ['id' => 12345, 'username' => 'myself'];
            }
        };

        $result = $this->tools->execute('forward_to_saved', ['chat' => '@user', 'messageId' => '500'], $proto);
        $this->assertTrue($result['ok']);
        $this->assertTrue($result['forwarded']);
    }

    public function testMarkRead(): void
    {
        $proto = new class {
            public object $messages;
            public function __construct() {
                $this->messages = new class {
                    public function readHistory(string $peer, int $max_id): bool {
                        return true;
                    }
                };
            }
        };

        $result = $this->tools->execute('mark_read', ['chat' => '@user', 'messageId' => '200'], $proto);
        $this->assertTrue($result['ok']);
        $this->assertTrue($result['markedRead']);
    }

    public function testUnknownToolThrows(): void
    {
        $this->expectException(ConnectorException::class);
        $this->tools->execute('non_existent', [], new class {});
    }
}
