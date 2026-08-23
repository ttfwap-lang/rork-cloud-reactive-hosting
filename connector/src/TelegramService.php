<?php

declare(strict_types=1);

namespace ReplyFlow;

use Amp\CancelledException;
use Amp\TimeoutCancellation;
use danog\MadelineProto\API;
use danog\MadelineProto\Settings;
use Throwable;

final class TelegramService
{
    /** Longest a single QR poll may block before returning a refreshed code. */
    private const QR_WAIT_SECONDS = 25.0;
    /** Longest flood wait absorbed inline; anything larger is handed back to the control plane. */
    private const INLINE_FLOOD_LIMIT = 25;
    /** Keeps the always-on supervisor away from the session while a login is in flight. */
    private const LOGIN_LOCK_SECONDS = 90;

    private API $api;

    private string $tenant;

    public function __construct(string $tenant = StateStore::OWNER_TENANT)
    {
        $this->tenant = StateStore::normalize($tenant);
        StateStore::use($this->tenant);
        $credentials = self::credentials($this->tenant);
        if ($credentials === null) {
            throw new ConnectorException(
                'No Telegram API credentials are stored for this account. Add your own API ID and hash from my.telegram.org.',
                null,
                503,
            );
        }
        $this->api = new API(
            StateStore::sessionPath($this->tenant),
            self::buildSettings($credentials['apiId'], $credentials['apiHash']),
        );
    }

    /**
     * App credentials for one account. Only the original owner inherits the
     * connector's own environment pair; every other account brings its own, so a
     * single flagged api_id can never take the whole service down with it.
     */
    public static function credentials(string $tenant = StateStore::OWNER_TENANT): ?array
    {
        $resolved = StateStore::normalize($tenant);
        $apiId = '';
        $apiHash = '';
        if ($resolved === StateStore::OWNER_TENANT) {
            $apiId = trim((string) (getenv('TELEGRAM_API_ID') ?: ''));
            $apiHash = trim((string) (getenv('TELEGRAM_API_HASH') ?: ''));
        }
        if ($apiId === '' || $apiHash === '') {
            try {
                $state = StateStore::read($resolved);
            } catch (Throwable) {
                return null;
            }
            $apiId = $apiId !== '' ? $apiId : (string) ($state['apiId'] ?? '');
            $apiHash = $apiHash !== '' ? $apiHash : (string) ($state['apiHash'] ?? '');
        }
        if (preg_match('/^\d{4,12}$/', $apiId) !== 1 || preg_match('/^[a-fA-F0-9]{32}$/', $apiHash) !== 1) {
            return null;
        }

        return ['apiId' => (int) $apiId, 'apiHash' => $apiHash];
    }

    public static function buildSettings(int $apiId, string $apiHash): Settings
    {
        $settings = new Settings();
        $settings->getAppInfo()->setApiId($apiId)->setApiHash($apiHash);
        // Level 2 keeps startup/connection notices without echoing message bodies.
        $settings->getLogger()->setLevel(2);
        // Absorb Telegram's own cool-off requests transparently instead of failing.
        $settings->getRpc()->setFloodTimeout(300);

        return $settings;
    }

    public function startLogin(array $input): array
    {
        $state = StateStore::read();
        $state['disabled'] = false;
        $state['loginLockUntil'] = time() + self::LOGIN_LOCK_SECONDS;
        // Sealed alongside the session, in this account's folder only.
        if (isset($input['apiId'])) {
            $state['apiId'] = (int) $input['apiId'];
        }
        if (isset($input['apiHash'])) {
            $state['apiHash'] = (string) $input['apiHash'];
        }
        StateStore::write($state);

        if (($input['method'] ?? 'qr') === 'phone') {
            $phone = trim((string) ($input['phone'] ?? ''));
            $this->api->phoneLogin($phone);
            $state['status'] = 'awaiting_code';
            $state['phoneMasked'] = self::maskPhone($phone);
            StateStore::write($state);

            return $this->publicState($state, 'Telegram sent a login code.');
        }

        if ($this->api->getAuthorization() === API::LOGGED_IN) {
            return $this->finishLogin('Existing personal session restored.');
        }
        $qr = $this->api->qrLogin();
        if ($qr === null) {
            return $this->finishLogin('Existing personal session restored.');
        }
        $state['status'] = 'awaiting_qr';
        StateStore::write($state);

        return array_merge(
            $this->publicState($state, 'Scan in Telegram: Settings → Devices → Link Desktop Device.'),
            ['qrUrl' => $qr->getQRText(), 'qrExpiresAt' => self::nowMs() + 30_000],
        );
    }

    /**
     * Blocks until the QR code is either scanned or expires, then reports the
     * outcome. Someone has to hold the connection open for Telegram to deliver
     * the login token, so the console calls this repeatedly while showing the code.
     */
    public function waitForQr(): array
    {
        $state = StateStore::read();
        if (($state['disabled'] ?? false) === true) {
            throw new ConnectorException('The connector is disconnected.', null, 409);
        }
        $state['loginLockUntil'] = time() + self::LOGIN_LOCK_SECONDS;
        StateStore::write($state);

        if ($this->api->getAuthorization() === API::LOGGED_IN) {
            return $this->finishLogin('Personal Telegram session is online.');
        }
        $qr = $this->api->qrLogin();
        if ($qr === null) {
            return $this->finishLogin('Personal Telegram session is online.');
        }
        try {
            $qr->waitForLoginOrQrCodeExpiration(new TimeoutCancellation(self::QR_WAIT_SECONDS));
        } catch (CancelledException) {
            // Poll window elapsed; fall through and hand back a current code.
        } catch (Throwable $error) {
            if (self::isPasswordRequired($error)) {
                $state['status'] = 'awaiting_password';
                StateStore::write($state);

                return $this->publicState($state, 'Two-step verification is enabled. Enter the password; it is never stored.');
            }
            throw $error;
        }

        if ($this->api->getAuthorization() === API::LOGGED_IN) {
            return $this->finishLogin('Personal Telegram session is online.');
        }
        if ($this->api->getAuthorization() === API::WAITING_PASSWORD) {
            $state['status'] = 'awaiting_password';
            StateStore::write($state);

            return $this->publicState($state, 'Two-step verification is enabled. Enter the password; it is never stored.');
        }
        $fresh = $this->api->qrLogin();
        if ($fresh === null) {
            return $this->finishLogin('Personal Telegram session is online.');
        }
        $state['status'] = 'awaiting_qr';
        StateStore::write($state);

        return array_merge(
            $this->publicState($state, 'Waiting for the code to be scanned.'),
            ['qrUrl' => $fresh->getQRText(), 'qrExpiresAt' => self::nowMs() + 30_000],
        );
    }

    public function submit(string $kind, string $value): array
    {
        $state = StateStore::read();
        $state['loginLockUntil'] = time() + self::LOGIN_LOCK_SECONDS;
        StateStore::write($state);

        if ($kind === 'code') {
            $authorization = $this->api->completePhoneLogin(trim($value));
            if (($authorization['_'] ?? '') === 'account.password') {
                $state['status'] = 'awaiting_password';
                StateStore::write($state);

                return $this->publicState($state, 'Two-step verification is enabled. Enter the password; it is never stored.');
            }
        } elseif ($kind === 'password') {
            $this->api->complete2faLogin($value);
        } else {
            throw new ConnectorException('Unsupported login submission.');
        }

        return $this->finishLogin('Personal Telegram session is online.');
    }

    /** Marks the session live and releases it so the always-on process can take over. */
    private function finishLogin(string $detail): array
    {
        $state = StateStore::read();
        $state['status'] = 'online';
        $state['disabled'] = false;
        $state['loginLockUntil'] = 0;
        $state = $this->withIdentity($state);
        StateStore::write($state);

        return $this->publicState($state, $detail);
    }

    public function refreshState(string $detail = 'Connector health check completed.'): array
    {
        $state = StateStore::read();
        if (($state['disabled'] ?? false) === true) {
            $state['status'] = 'offline';
            StateStore::write($state);

            return $this->publicState($state, 'Session is preserved but disconnected.');
        }
        $status = match ($this->api->getAuthorization()) {
            API::LOGGED_IN => 'online',
            API::WAITING_CODE => 'awaiting_code',
            API::WAITING_PASSWORD => 'awaiting_password',
            default => 'attention',
        };
        $state['status'] = $status;
        if ($status === 'online') {
            $state['loginLockUntil'] = 0;
            $state = $this->withIdentity($state);
        }
        StateStore::write($state);

        return $this->publicState($state, $detail);
    }

    private function withIdentity(array $state): array
    {
        try {
            $self = $this->api->getSelf();
        } catch (Throwable) {
            return $state;
        }
        if (!is_array($self)) {
            return $state;
        }
        $username = $self['username'] ?? null;
        $name = trim((string) (($self['first_name'] ?? '').' '.($self['last_name'] ?? '')));
        $state['identity'] = $username ? '@'.$username : ($name !== '' ? $name : 'Personal account');
        if (isset($self['phone'])) {
            $state['phoneMasked'] = self::maskPhone((string) $self['phone']);
        }

        return $state;
    }

    public function disconnect(): array
    {
        $state = StateStore::read();
        $state['disabled'] = true;
        $state['status'] = 'offline';
        StateStore::write($state);

        return $this->publicState($state, 'Session preserved and event delivery paused.');
    }

    public function reconnect(): array
    {
        $state = StateStore::read();
        $state['disabled'] = false;
        StateStore::write($state);

        return $this->refreshState('Persistent session restored.');
    }

    public function forget(): array
    {
        try {
            $this->api->logout();
        } catch (Throwable) {
            // Local deletion still proceeds if Telegram is unreachable.
        }
        StateStore::clear();

        return [
            'status' => 'offline',
            'identity' => null,
            'phoneMasked' => null,
            'detail' => 'Telegram authorization revoked and encrypted session files removed.',
        ];
    }

    public function execute(array $action): array
    {
        $state = StateStore::read();
        if (($state['disabled'] ?? false) || ($state['status'] ?? '') !== 'online') {
            throw new ConnectorException('Personal session is not online.', null, 409);
        }
        $idempotencyKey = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($action['idempotencyKey'] ?? '')) ?? '';
        if ($idempotencyKey === '') {
            throw new ConnectorException('An idempotency key is required.');
        }
        $receipt = StateStore::path('action_'.hash('sha256', $idempotencyKey));
        if (is_file($receipt)) {
            return ['ok' => true, 'duplicate' => true];
        }
        $peer = (string) ($action['chatKey'] ?? '');
        $type = (string) ($action['actionType'] ?? '');
        if ($peer === '') {
            throw new ConnectorException('A target chat is required.');
        }

        $this->runAction($peer, $type, $action);

        file_put_contents($receipt, json_encode(['at' => time(), 'type' => $type], JSON_THROW_ON_ERROR), LOCK_EX);
        foreach (glob(StateStore::path('action_*')) ?: [] as $file) {
            if (filemtime($file) !== false && filemtime($file) < time() - 172800) {
                @unlink($file);
            }
        }

        return ['ok' => true, 'duplicate' => false];
    }

    /**
     * Performs one Telegram action, honouring a short flood wait inline and
     * surfacing longer ones so the control plane can reschedule precisely.
     */
    private function runAction(string $peer, string $type, array $action, bool $isRetry = false): void
    {
        try {
            match ($type) {
                'sendText' => $this->api->messages->sendMessage(peer: $peer, message: (string) ($action['text'] ?? '')),
                'pressButton' => $this->pressButton($peer, (string) ($action['buttonTarget'] ?? '')),
                'react' => $this->react($peer, (int) ($action['messageId'] ?? 0), (string) ($action['reaction'] ?? '')),
                'markRead' => $this->api->messages->readHistory(peer: $peer, max_id: (int) ($action['messageId'] ?? 0)),
                default => throw new ConnectorException('Unsupported personal-account action.'),
            };
        } catch (ConnectorException $error) {
            throw $error;
        } catch (Throwable $error) {
            $seconds = ConnectorException::floodSeconds($error);
            if ($seconds === null) {
                throw $error;
            }
            if ($isRetry || $seconds > self::INLINE_FLOOD_LIMIT) {
                throw new ConnectorException(
                    "Telegram asked for a {$seconds}s pause.",
                    $seconds,
                    429,
                    $error,
                );
            }
            sleep($seconds);
            $this->runAction($peer, $type, $action, true);
        }
    }

    private function pressButton(string $peer, string $target): void
    {
        $history = $this->api->messages->getHistory(peer: $peer, limit: 10);
        foreach ($history['messages'] ?? [] as $message) {
            foreach (($message['reply_markup']['rows'] ?? []) as $rowIndex => $row) {
                foreach (($row['buttons'] ?? []) as $columnIndex => $button) {
                    $coordinates = ($rowIndex + 1).','.($columnIndex + 1);
                    if (($button['text'] ?? '') !== $target && $coordinates !== $target) {
                        continue;
                    }
                    if (!array_key_exists('data', $button)) {
                        throw new ConnectorException('That button cannot be safely pressed by the connector.');
                    }
                    $this->api->messages->getBotCallbackAnswer(peer: $peer, msg_id: (int) $message['id'], data: $button['data']);

                    return;
                }
            }
        }
        throw new ConnectorException('The requested button was not found in recent messages.');
    }

    private function react(string $peer, int $messageId, string $emoji): void
    {
        if ($messageId <= 0 || $emoji === '') {
            throw new ConnectorException('A message and reaction are required.');
        }
        $this->api->messages->sendReaction(
            peer: $peer,
            msg_id: $messageId,
            reaction: [['_' => 'reactionEmoji', 'emoticon' => $emoji]],
        );
    }

    private function publicState(array $state, string $detail): array
    {
        return [
            'status' => $state['status'] ?? 'offline',
            'identity' => $state['identity'] ?? null,
            'phoneMasked' => $state['phoneMasked'] ?? null,
            'detail' => $detail,
        ];
    }

    private static function isPasswordRequired(Throwable $error): bool
    {
        return str_contains(strtoupper($error->getMessage()), 'SESSION_PASSWORD_NEEDED');
    }

    private static function nowMs(): int
    {
        return (int) round(microtime(true) * 1000);
    }

    private static function maskPhone(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone) ?? '';

        return strlen($digits) <= 4
            ? '••••'
            : '+'.substr($digits, 0, 2).str_repeat('•', max(2, strlen($digits) - 4)).substr($digits, -2);
    }
}
