<?php

declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

use ReplyFlow\ConnectorException;
use ReplyFlow\SelfCheck;
use ReplyFlow\Signature;
use ReplyFlow\StateStore;
use ReplyFlow\TelegramService;

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Liveness must never touch Telegram or the session: the host restarts the
// service if this is slow, which would otherwise interrupt a login in progress.
if ($path === '/health') {
    $sessions = 0;
    try {
        foreach (StateStore::tenants() as $tenant) {
            if ((string) (StateStore::read($tenant)['status'] ?? 'offline') === 'online') {
                $sessions++;
            }
        }
    } catch (Throwable) {
        $sessions = 0;
    }
    http_response_code(200);
    // Counts only: which accounts exist is never exposed on an open route.
    echo json_encode([
        'ok' => true,
        'status' => $sessions > 0 ? 'online' : 'offline',
        'sessions' => $sessions,
        'worker' => StateStore::supervisorAge(),
    ], JSON_THROW_ON_ERROR);
    exit;
}

// Unauthenticated on purpose so it can be opened in a browser during setup.
// It reports only whether values are present and correctly shaped, never their contents.
if ($path === '/selfcheck') {
    $report = SelfCheck::report();
    http_response_code($report['ok'] ? 200 : 503);
    echo json_encode($report, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
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
    if (!is_array($input)) {
        $input = [];
    }
    // Every signed call names the account it acts for. The signature is what makes
    // this trustworthy: only the control plane can produce it, so a tenant handle
    // can never be forged from outside.
    $tenant = StateStore::normalize((string) ($input['tenant'] ?? StateStore::OWNER_TENANT));
    StateStore::use($tenant);
    $service = new TelegramService($tenant);
    $result = match ($path) {
        '/v1/login/start' => $service->startLogin($input),
        '/v1/login/qr/wait' => $service->waitForQr(),
        '/v1/login/submit' => $service->submit((string) ($input['kind'] ?? ''), (string) ($input['value'] ?? '')),
        '/v1/session/status' => $service->refreshState(),
        '/v1/session/reconnect' => $service->reconnect(),
        '/v1/session/disconnect' => $service->disconnect(),
        '/v1/session/forget' => $service->forget(),
        '/v1/actions/execute' => $service->execute($input),
        default => throw new ConnectorException('not found', null, 404),
    };
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
} catch (ConnectorException $error) {
    http_response_code($error->httpStatus);
    $payload = ['error' => mb_substr(redactConnectorMessage($error->getMessage()), 0, 240)];
    if ($error->retryAfterSeconds !== null) {
        $payload['retryAfter'] = $error->retryAfterSeconds;
    }
    echo json_encode($payload, JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    http_response_code(400);
    echo json_encode(['error' => mb_substr(redactConnectorMessage($error->getMessage()), 0, 240)], JSON_THROW_ON_ERROR);
}

/** Strips phone numbers and long digit runs before an error reaches the console. */
function redactConnectorMessage(string $message): string
{
    $clean = preg_replace('/\+?\d[\d\s()-]{6,}/', '[redacted]', $message);

    return ($clean === null || $clean === '') ? 'Connector request failed.' : $clean;
}
