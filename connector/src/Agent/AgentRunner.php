<?php

declare(strict_types=1);

namespace ReplyFlow\Agent;

use ReplyFlow\ConnectorException;
use ReplyFlow\EventForwarder;
use ReplyFlow\GeminiClient;
use ReplyFlow\StateStore;
use Throwable;
use function Amp\async;

/**
 * Live agent execution runner.
 * Manages Gemini 3.7 Flash turn loops, write-ahead logging, tool dispatching,
 * per-chat FIFO turn queue, and cross-chat concurrent execution.
 */
final class AgentRunner
{
    public const MAX_TOOL_ITERATIONS = 25;

    private GeminiClient $gemini;
    private AgentTools $tools;
    private TurnQueue $queue;
    private AgentState $state;
    private string $tenant;
    private array $config;

    public function __construct(
        ?string $tenant = null,
        ?GeminiClient $gemini = null,
        ?AgentTools $tools = null,
        ?TurnQueue $queue = null,
        ?AgentState $state = null,
    ) {
        $this->tenant = StateStore::normalize($tenant ?? StateStore::tenant());
        $this->config = $this->loadConfig();
        $apiKey = (string) ($this->config['apiKey'] ?? (getenv('GEMINI_API_KEY') ?: ''));
        $model = (string) ($this->config['model'] ?? (getenv('GEMINI_MODEL') ?: GeminiClient::DEFAULT_MODEL));

        $this->gemini = $gemini ?? new GeminiClient($apiKey, $model);
        $this->tools = $tools ?? new AgentTools();
        $this->queue = $queue ?? new TurnQueue();
        $this->state = $state ?? new AgentState();
    }

    /**
     * Checks whether the agent is configured and has an API key available.
     */
    public function isConfigured(): bool
    {
        $apiKey = (string) ($this->config['apiKey'] ?? (getenv('GEMINI_API_KEY') ?: ''));

        return $apiKey !== '';
    }

    public function getControlChat(): string
    {
        return trim((string) ($this->config['controlChat'] ?? ''));
    }

    public function isControlChat(string $chatKey, ?string $sender = null): bool
    {
        $control = $this->getControlChat();
        if ($control === '') {
            return false;
        }

        $normControl = '@'.ltrim(strtolower($control), '@');
        $normChat = '@'.ltrim(strtolower($chatKey), '@');
        if ($normChat === $normControl) {
            return true;
        }

        if ($sender !== null && $sender !== '') {
            $normSender = '@'.ltrim(strtolower($sender), '@');
            if ($normSender === $normControl) {
                return true;
            }
        }

        return false;
    }

    public function isLeased(string $chatKey): bool
    {
        return $this->state->isLeased($chatKey, time());
    }

    public function getState(): AgentState
    {
        return $this->state;
    }

    public function getQueue(): TurnQueue
    {
        return $this->queue;
    }

    /**
     * Handles an incoming message from ReplyFlowEventHandler::onAnyMessage.
     *
     * @param array<string, mixed> $msg Normalized message payload
     * @param object $proto MadelineProto instance or event handler
     * @return bool True if intercepted and handled by the agent; false if it should be forwarded normally
     */
    public function handleMessage(array $msg, object $proto): bool
    {
        if (!$this->isConfigured()) {
            return false;
        }

        $chatKey = (string) ($msg['chatKey'] ?? '');
        $sender = (string) ($msg['sender'] ?? '');

        // 1. Control chat: instruction intake
        if ($this->isControlChat($chatKey, $sender)) {
            $event = [
                'kind' => 'instruction',
                'timestamp' => time(),
                'chatKey' => $chatKey,
                'sender' => $sender,
                'text' => (string) ($msg['text'] ?? ''),
                'messageId' => (string) ($msg['messageId'] ?? ''),
            ];
            AgentLog::append($chatKey, $event, $this->tenant);
            $this->state->apply($event);
            EventForwarder::post(['type' => 'agent_log', 'event' => $event], $this->tenant);

            $this->queue->enqueue($chatKey, [
                'type' => 'instruction',
                'message' => $msg,
            ]);
            $this->processQueue($chatKey, $proto);

            return true;
        }

        // 2. Leased chat: queue into chat's turn instead of ordinary forwarding
        if ($this->isLeased($chatKey)) {
            $event = [
                'kind' => 'observation',
                'timestamp' => time(),
                'chatKey' => $chatKey,
                'sender' => $sender,
                'text' => (string) ($msg['text'] ?? ''),
                'messageId' => (string) ($msg['messageId'] ?? ''),
            ];
            AgentLog::append($chatKey, $event, $this->tenant);
            $this->state->apply($event);
            EventForwarder::post(['type' => 'agent_log', 'event' => $event], $this->tenant);

            $this->queue->enqueue($chatKey, [
                'type' => 'observation',
                'message' => $msg,
            ]);
            $this->processQueue($chatKey, $proto);

            return true;
        }

        // 3. Non-control chat and not leased: observation only, forward normally to Worker
        return false;
    }

    /**
     * Advances the per-chat queue sequentially.
     */
    public function processQueue(string $chatKey, object $proto): void
    {
        if ($this->queue->isTurnActive($chatKey)) {
            return;
        }

        $item = $this->queue->dequeue($chatKey);
        if ($item === null) {
            return;
        }

        $turnId = uniqid('turn_', true);
        if (!$this->queue->startTurn($chatKey, $turnId)) {
            return;
        }

        // Execute turn in an asynchronous fiber
        try {
            async(function () use ($chatKey, $turnId, $item, $proto): void {
                try {
                    $this->runTurn($chatKey, $turnId, $item, $proto);
                } finally {
                    $this->queue->finishTurn($chatKey, $turnId);
                    $this->checkCompaction();
                    $this->processQueue($chatKey, $proto);
                }
            });
        } catch (Throwable) {
            $this->queue->finishTurn($chatKey, $turnId);
        }
    }

    /**
     * Executes a single turn loop with Gemini function calling.
     */
    public function runTurn(string $chatKey, string $turnId, array $item, object $proto): void
    {
        $startEvent = [
            'kind' => 'turn.start',
            'timestamp' => time(),
            'chatKey' => $chatKey,
            'turnId' => $turnId,
        ];
        AgentLog::append($chatKey, $startEvent, $this->tenant);
        $this->state->apply($startEvent);
        EventForwarder::post(['type' => 'agent_log', 'event' => $startEvent], $this->tenant);

        $systemInstruction = (string) ($this->config['systemInstruction'] ?? "You are an autonomous Telegram agent. Use the provided tools to inspect chats, read history, send messages, press buttons, react, forward messages to Saved Messages, and mark messages read.");

        $userPrompt = $this->buildPrompt($chatKey, $item);
        $contents = [
            [
                'role' => 'user',
                'parts' => [
                    ['text' => $userPrompt],
                ],
            ],
        ];

        $iteration = 0;
        try {
            while (true) {
                if ($iteration >= self::MAX_TOOL_ITERATIONS) {
                    $abandonEvent = [
                        'kind' => 'turn.abandoned',
                        'timestamp' => time(),
                        'chatKey' => $chatKey,
                        'turnId' => $turnId,
                        'error' => 'Reached maximum tool iterations (' . self::MAX_TOOL_ITERATIONS . ')',
                    ];
                    AgentLog::append($chatKey, $abandonEvent, $this->tenant);
                    $this->state->apply($abandonEvent);
                    EventForwarder::post(['type' => 'agent_log', 'event' => $abandonEvent], $this->tenant);
                    return;
                }
                $iteration++;

                $response = $this->gemini->generateContent(
                    contents: $contents,
                    tools: [['functionDeclarations' => AgentTools::declarations()]],
                    systemInstruction: $systemInstruction !== '' ? ['parts' => [['text' => $systemInstruction]]] : null,
                );

                $candidate = $response['candidates'][0] ?? null;
                if ($candidate === null) {
                    break;
                }

                $parts = (array) ($candidate['content']['parts'] ?? []);
                $functionCalls = [];
                foreach ($parts as $p) {
                    if (isset($p['functionCall']) && is_array($p['functionCall'])) {
                        $functionCalls[] = $p['functionCall'];
                    }
                }

                // If model did not request any function calls, the turn loop is complete
                if (count($functionCalls) === 0) {
                    break;
                }

                // Append model's thought / function calls to contents
                $contents[] = [
                    'role' => 'model',
                    'parts' => $parts,
                ];

                $responseParts = [];
                foreach ($functionCalls as $fn) {
                    $toolName = (string) ($fn['name'] ?? '');
                    $args = (array) ($fn['args'] ?? []);
                    $callId = uniqid('call_', true);

                    // 1. Write-ahead logging: tool.intent appended and flushed BEFORE the Telegram action
                    $intentEvent = [
                        'kind' => 'tool.intent',
                        'timestamp' => time(),
                        'chatKey' => $chatKey,
                        'turnId' => $turnId,
                        'callId' => $callId,
                        'tool' => $toolName,
                        'arguments' => $args,
                    ];
                    AgentLog::append($chatKey, $intentEvent, $this->tenant);
                    $this->state->apply($intentEvent);
                    EventForwarder::post(['type' => 'agent_log', 'event' => $intentEvent], $this->tenant);

                    // If targeting another chat with an action, acquire lease for that target
                    $targetChat = trim((string) ($args['chat'] ?? ''));
                    if ($targetChat !== '' && in_array($toolName, ['send_text', 'press_button', 'react', 'forward_to_saved', 'mark_read'], true)) {
                        $this->acquireLease($targetChat);
                    }

                    // 2. Execute tool
                    try {
                        if ($toolName === 'release_lease') {
                            if ($targetChat === '') {
                                throw new ConnectorException('chat argument is required for release_lease.');
                            }
                            $this->releaseLease($targetChat);
                            $toolResult = ['ok' => true, 'released' => $targetChat];
                        } else {
                            $toolResult = $this->tools->execute($toolName, $args, $proto);
                        }
                        $responseContent = ['output' => $toolResult];
                        $error = null;
                    } catch (Throwable $e) {
                        $responseContent = ['error' => $e->getMessage()];
                        $error = $e->getMessage();
                    }

                    // 3. Write tool.result
                    $resultEvent = [
                        'kind' => 'tool.result',
                        'timestamp' => time(),
                        'chatKey' => $chatKey,
                        'turnId' => $turnId,
                        'callId' => $callId,
                        'tool' => $toolName,
                        'result' => $responseContent,
                        'error' => $error,
                    ];
                    AgentLog::append($chatKey, $resultEvent, $this->tenant);
                    $this->state->apply($resultEvent);
                    EventForwarder::post(['type' => 'agent_log', 'event' => $resultEvent], $this->tenant);

                    $responseParts[] = [
                        'functionResponse' => [
                            'name' => $toolName,
                            'response' => $responseContent,
                        ],
                    ];
                }

                $contents[] = [
                    'role' => 'user',
                    'parts' => $responseParts,
                ];
            }

            $endEvent = [
                'kind' => 'turn.end',
                'timestamp' => time(),
                'chatKey' => $chatKey,
                'turnId' => $turnId,
            ];
            AgentLog::append($chatKey, $endEvent, $this->tenant);
            $this->state->apply($endEvent);
            EventForwarder::post(['type' => 'agent_log', 'event' => $endEvent], $this->tenant);
        } catch (Throwable $e) {
            $abandonEvent = [
                'kind' => 'turn.abandoned',
                'timestamp' => time(),
                'chatKey' => $chatKey,
                'turnId' => $turnId,
                'error' => $e->getMessage(),
            ];
            AgentLog::append($chatKey, $abandonEvent, $this->tenant);
            $this->state->apply($abandonEvent);
            EventForwarder::post(['type' => 'agent_log', 'event' => $abandonEvent], $this->tenant);
        }
    }

    public function acquireLease(string $chatKey, int $ttlSeconds = ChatLease::DEFAULT_TTL_SECONDS): void
    {
        $now = time();
        if ($this->state->isLeased($chatKey, $now)) {
            return;
        }

        $event = [
            'kind' => 'lease.acquired',
            'timestamp' => $now,
            'chatKey' => $chatKey,
            'owner' => 'agent',
            'ttlSeconds' => $ttlSeconds,
        ];
        AgentLog::append($chatKey, $event, $this->tenant);
        $this->state->apply($event);
        EventForwarder::post(['type' => 'agent_log', 'event' => $event], $this->tenant);
        EventForwarder::post([
            'type' => 'lease',
            'action' => 'acquire',
            'chatKey' => $chatKey,
            'owner' => 'agent',
            'ttlSeconds' => $ttlSeconds,
        ], $this->tenant);
    }

    public function releaseLease(string $chatKey): void
    {
        $now = time();
        $event = [
            'kind' => 'lease.released',
            'timestamp' => $now,
            'chatKey' => $chatKey,
        ];
        AgentLog::append($chatKey, $event, $this->tenant);
        $this->state->apply($event);
        EventForwarder::post(['type' => 'agent_log', 'event' => $event], $this->tenant);
        EventForwarder::post([
            'type' => 'lease',
            'action' => 'release',
            'chatKey' => $chatKey,
        ], $this->tenant);
    }

    /**
     * Performs orphan recovery on child start (Stage 6).
     * Folds existing logs, identifies tool intents without results,
     * verifies against recent history using ReplayPlanner, and re-issues or skips.
     *
     * @return array<string, array{decision: string, intent: array}> Decisions made
     */
    public function recoverOrphans(object $proto): array
    {
        if (!$this->isConfigured()) {
            return [];
        }

        $logFiles = glob(StateStore::path('agent-*.log', $this->tenant)) ?: [];
        $planner = new ReplayPlanner();
        $allDecisions = [];

        foreach ($logFiles as $file) {
            $base = basename($file, '.log');
            $chatKey = substr($base, 6);
            $events = AgentLog::readAll($chatKey, $this->tenant);
            if (empty($events)) {
                continue;
            }

            $state = AgentState::foldEvents($events);
            $pendingIntents = $state->getPendingToolIntents();
            if (empty($pendingIntents)) {
                continue;
            }

            $chatHistories = [];
            foreach ($pendingIntents as $intent) {
                $tool = (string) ($intent['tool'] ?? '');
                $target = $planner->targetChatForTool($tool, $intent);
                if (!isset($chatHistories[$target])) {
                    try {
                        $peer = $target === ReplayPlanner::SAVED_MESSAGES_KEY
                            ? \ReplyFlow\SavedMessagesResolver::resolve($proto)
                            : $target;
                        $res = $proto->messages->getHistory(peer: $peer, limit: 10);
                        $chatHistories[$target] = (array) ($res['messages'] ?? []);
                    } catch (Throwable) {
                        $chatHistories[$target] = [];
                    }
                }
            }

            $decisions = $planner->planAll($pendingIntents, $state->getAllTurnAttempts(), $chatHistories);

            foreach ($decisions as $callId => $dec) {
                $decision = $dec['decision'];
                $intent = $dec['intent'];
                $turnId = (string) ($intent['turnId'] ?? '');
                $tool = (string) ($intent['tool'] ?? '');
                $args = (array) ($intent['arguments'] ?? []);

                if ($decision === ReplayPlanner::DECISION_ABANDON) {
                    $abandonEvent = [
                        'kind' => 'turn.abandoned',
                        'timestamp' => time(),
                        'chatKey' => $chatKey,
                        'turnId' => $turnId,
                        'reason' => 'replay_abandoned',
                    ];
                    AgentLog::append($chatKey, $abandonEvent, $this->tenant);
                    $this->state->apply($abandonEvent);
                    EventForwarder::post(['type' => 'agent_log', 'event' => $abandonEvent], $this->tenant);
                } elseif ($decision === ReplayPlanner::DECISION_SKIP) {
                    $resultEvent = [
                        'kind' => 'tool.result',
                        'timestamp' => time(),
                        'chatKey' => $chatKey,
                        'turnId' => $turnId,
                        'callId' => $callId,
                        'tool' => $tool,
                        'result' => ['output' => ['skipped' => true, 'verified_landed' => true]],
                    ];
                    AgentLog::append($chatKey, $resultEvent, $this->tenant);
                    $this->state->apply($resultEvent);
                    EventForwarder::post(['type' => 'agent_log', 'event' => $resultEvent], $this->tenant);
                } elseif ($decision === ReplayPlanner::DECISION_REISSUE) {
                    $attemptEvent = [
                        'kind' => 'turn.attempt',
                        'timestamp' => time(),
                        'chatKey' => $chatKey,
                        'turnId' => $turnId,
                    ];
                    AgentLog::append($chatKey, $attemptEvent, $this->tenant);
                    $this->state->apply($attemptEvent);
                    EventForwarder::post(['type' => 'agent_log', 'event' => $attemptEvent], $this->tenant);

                    try {
                        $res = $this->tools->execute($tool, $args, $proto);
                        $resultData = ['output' => $res];
                        $error = null;
                    } catch (Throwable $e) {
                        $resultData = ['error' => $e->getMessage()];
                        $error = $e->getMessage();
                    }

                    $resultEvent = [
                        'kind' => 'tool.result',
                        'timestamp' => time(),
                        'chatKey' => $chatKey,
                        'turnId' => $turnId,
                        'callId' => $callId,
                        'tool' => $tool,
                        'result' => $resultData,
                        'error' => $error,
                    ];
                    AgentLog::append($chatKey, $resultEvent, $this->tenant);
                    $this->state->apply($resultEvent);
                    EventForwarder::post(['type' => 'agent_log', 'event' => $resultEvent], $this->tenant);
                }

                $allDecisions[$callId] = $dec;
            }
        }

        return $allDecisions;
    }

    /**
     * Executes emergency compaction if requested by supervisor (Stage 7).
     * Compacts at a turn boundary, preserving single-writer.
     */
    public function checkCompaction(): void
    {
        $reqFile = StateStore::path('agent-compact.request', $this->tenant);
        if (!is_file($reqFile)) {
            return;
        }

        foreach (glob(StateStore::path('agent-*.log', $this->tenant)) ?: [] as $logFile) {
            $base = basename($logFile, '.log');
            $chatKey = substr($base, 6);
            AgentLog::compact($chatKey, $this->tenant);
        }

        @unlink($reqFile);
    }

    private function buildPrompt(string $chatKey, array $item): string
    {
        $type = (string) ($item['type'] ?? 'message');
        $msg = (array) ($item['message'] ?? []);
        $sender = (string) ($msg['sender'] ?? 'unknown');
        $text = (string) ($msg['text'] ?? '');
        $messageId = (string) ($msg['messageId'] ?? '');

        return "Event: {$type}\nChat: {$chatKey}\nSender: {$sender}\nMessage ID: {$messageId}\nContent:\n{$text}";
    }

    private function loadConfig(): array
    {
        try {
            return StateStore::readAgentConfig($this->tenant);
        } catch (Throwable) {
            return [];
        }
    }
}

