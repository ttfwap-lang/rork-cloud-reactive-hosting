<?php

declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

use ReplyFlow\Signature;
use ReplyFlow\StateStore;
use ReplyFlow\TelegramService;

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($path === '/health') {
    $state = [];
    try { $state = StateStore::read(); } catch (Throwable) { $state = ['status' => 'attention']; }
    http_response_code(200);
    echo json_encode(['ok' => true, 'status' => $state['status'] ?? 'offline'], JSON_THROW_ON_ERROR);
    exit;
}

$body = file_get_contents('php://input') ?: '';
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !Signature::verify('POST', $path, $body)) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized'], JSON_THROW_ON_ERROR);
    exit;
}

try {
    $input = $body === '' ? [] : json_decode($body, true, flags: JSON_THROW_ON_ERROR);
    $service = match ($path) {
        '/v1/login/start' => new TelegramService((int) ($input['apiId'] ?? 0), (string) ($input['apiHash'] ?? '')),
        default => new TelegramService(),
    };
    $result = match ($path) {
        '/v1/login/start' => $service->startLogin($input),
        '/v1/login/submit' => $service->submit((string) ($input['kind'] ?? ''), (string) ($input['value'] ?? '')),
        '/v1/session/status' => $service->refreshState(),
        '/v1/session/reconnect' => $service->reconnect(),
        '/v1/session/disconnect' => $service->disconnect(),
        '/v1/session/forget' => $service->forget(),
        '/v1/actions/execute' => $service->execute($input),
        default => throw new RuntimeException('not found', 404),
    };
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    $code = $error->getCode() === 404 ? 404 : 400;
    http_response_code($code);
    $message = preg_replace('/\+?\d[\d\s()-]{6,}/', '[redacted]', $error->getMessage()) ?: 'Connector request failed.';
    echo json_encode(['error' => mb_substr($message, 0, 240)], JSON_THROW_ON_ERROR);
}
