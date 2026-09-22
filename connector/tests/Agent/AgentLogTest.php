<?php

declare(strict_types=1);

namespace ReplyFlow\Tests\Agent;

use PHPUnit\Framework\TestCase;
use ReplyFlow\Agent\AgentLog;
use ReplyFlow\StateStore;

final class AgentLogTest extends TestCase
{
    private string $tempDir;

    protected function setUp(): void
    {
        $this->tempDir = sys_get_temp_dir().'/agent_log_test_'.bin2hex(random_bytes(8));
        @mkdir($this->tempDir, 0700, true);
        putenv("SESSION_PATH={$this->tempDir}");
        putenv('SESSION_ENCRYPTION_KEY=test_encryption_key_at_least_32_characters_long_12345');
        StateStore::use(StateStore::OWNER_TENANT);
    }

    protected function tearDown(): void
    {
        $files = glob($this->tempDir.'/*') ?: [];
        foreach ($files as $file) {
            is_dir($file) ? @rmdir($file) : @unlink($file);
        }
        @rmdir($this->tempDir);
    }

    public function testSealAndAppendRoundTrip(): void
    {
        $event1 = [
            'kind' => 'instruction',
            'chatKey' => '@control',
            'text' => 'Hello',
            'timestamp' => 1000,
        ];
        $event2 = [
            'kind' => 'tool.intent',
            'callId' => 'call_1',
            'tool' => 'press_button',
            'timestamp' => 1001,
        ];

        AgentLog::append('test_chat', $event1);
        AgentLog::append('test_chat', $event2);

        $events = AgentLog::readAll('test_chat');

        $this->assertCount(2, $events);
        $this->assertSame('instruction', $events[0]['kind']);
        $this->assertSame('Hello', $events[0]['text']);
        $this->assertSame('tool.intent', $events[1]['kind']);
        $this->assertSame('call_1', $events[1]['callId']);
    }

    public function testCompactionCreatesSnapshotAndTailsLog(): void
    {
        for ($i = 1; $i <= 15; $i++) {
            AgentLog::append('compact_chat', [
                'kind' => 'instruction',
                'chatKey' => 'compact_chat',
                'text' => "Message {$i}",
                'timestamp' => 1000 + $i,
            ]);
        }

        $allBefore = AgentLog::readAll('compact_chat');
        $this->assertCount(15, $allBefore);

        AgentLog::compact('compact_chat');

        // Verify snapshot file exists
        $snapshotFile = StateStore::path('agent-compact_chat.snapshot');
        $this->assertFileExists($snapshotFile);

        // Verify log was tailed to recent events
        $allAfter = AgentLog::readAll('compact_chat');
        $this->assertLessThan(15, count($allAfter));
        $this->assertSame('Message 15', $allAfter[count($allAfter) - 1]['text']);
    }
}

