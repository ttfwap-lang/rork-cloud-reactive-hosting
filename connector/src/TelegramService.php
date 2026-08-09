<?php

declare(strict_types=1);

namespace ReplyFlow;

use danog\MadelineProto\API;
use danog\MadelineProto\Settings;
use RuntimeException;
use Throwable;

final class TelegramService
{
    private API $api;

    public function __construct(?int $apiId = null, ?string $apiHash = null)
    {
        $state = StateStore::read();
        $resolvedId = $apiId ?? (isset($state['apiId']) ? (int) $state['apiId'] : null);
        $resolvedHash = $apiHash ?? ($state['apiHash'] ?? null);
        if (!$resolvedId || !$resolvedHash) {
            throw new RuntimeException('Telegram API credentials are not configured.');
        }
        $settings = new Settings();
        $settings->getAppInfo()->setApiId($resolvedId)->setApiHash($resolvedHash);
        $settings->getLogger()->setLevel(2);
        $this->api = new API(StateStore::sessionPath(), $settings);
    }

    public function startLogin(array $input): array
    {
        $state = StateStore::read();
        $state['apiId'] = (int) $input['apiId'];
        $state['apiHash'] = (string) $input['apiHash'];
        $state['disabled'] = false;
        StateStore::write($state);

        if (($input['method'] ?? 'qr') === 'phone') {
            $phone = trim((string) ($input['phone'] ?? ''));
            $this->api->phoneLogin($phone);
            $state = array_merge($state, ['status' => 'awaiting_code', 'phoneMasked' => self::maskPhone($phone)]);
            StateStore::write($state);
            return $this->publicState($state, 'Telegram sent a login code.');
        }

        $qr = $this->api->qrLogin();
        if ($qr === null) {
            return $this->refreshState('Existing personal session restored.');
        }
        $state['status'] = 'awaiting_qr';
        StateStore::write($state);
        return array_merge($this->publicState($state, 'Scan in Telegram: Settings → Devices → Link Desktop Device.'), [
            'qrUrl' => $qr->getQRText(),
            'qrExpiresAt' => (int) round(microtime(true) * 1000) + 30000,
        ]);
    }

    public function submit(string $kind, string $value): array
    {
        if ($kind === 'code') {
            $authorization = $this->api->completePhoneLogin(trim($value));
            if (($authorization['_'] ?? '') === 'account.password') {
                $state = StateStore::read();
                $state['status'] = 'awaiting_password';
                StateStore::write($state);
                return $this->publicState($state, 'Two-step verification is enabled. Enter the password; it is never stored.');
            }
        } elseif ($kind === 'password') {
            $this->api->complete2faLogin($value);
        } else {
            throw new RuntimeException('Unsupported login submission.');
        }
        return $this->refreshState('Personal Telegram session is online.');
    }

    public function refreshState(string $detail = 'Connector health check completed.'): array
    {
        $state = StateStore::read();
        if (($state['disabled'] ?? false) === true) {
            $state['status'] = 'offline';
            StateStore::write($state);
            return $this->publicState($state, 'Session is preserved but disconnected.');
        }
        $authorization = $this->api->getAuthorization();
        $status = match ($authorization) {
            API::LOGGED_IN => 'online',
            API::WAITING_CODE => 'awaiting_code',
            API::WAITING_PASSWORD => 'awaiting_password',
            default => 'attention',
        };
        $state['status'] = $status;
        if ($status === 'online') {
            $self = $this->api->getSelf();
            $username = is_array($self) ? ($self['username'] ?? null) : null;
            $name = is_array($self) ? trim((string) (($self['first_name'] ?? '').' '.($self['last_name'] ?? ''))) : '';
            $state['identity'] = $username ? '@'.$username : ($name !== '' ? $name : 'Personal account');
            if (is_array($self) && isset($self['phone'])) {
                $state['phoneMasked'] = self::maskPhone((string) $self['phone']);
            }
        }
        StateStore::write($state);
        return $this->publicState($state, $detail);
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
        return ['status' => 'offline', 'identity' => null, 'phoneMasked' => null, 'detail' => 'Telegram authorization revoked and encrypted session files removed.'];
    }

    public function execute(array $action): array
    {
        $state = StateStore::read();
        if (($state['disabled'] ?? false) || ($state['status'] ?? '') !== 'online') {
            throw new RuntimeException('Personal session is not online.');
        }
        $idempotencyKey = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($action['idempotencyKey'] ?? ''));
        if ($idempotencyKey === '') {
            throw new RuntimeException('An idempotency key is required.');
        }
        $receipt = StateStore::path('action_'.hash('sha256', $idempotencyKey));
        if (is_file($receipt)) {
            return ['ok' => true, 'duplicate' => true];
        }
        $peer = (string) ($action['chatKey'] ?? '');
        $type = (string) ($action['actionType'] ?? '');
        if ($peer === '') {
            throw new RuntimeException('A target chat is required.');
        }

        match ($type) {
            'sendText' => $this->api->messages->sendMessage(peer: $peer, message: (string) ($action['text'] ?? '')),
            'pressButton' => $this->pressButton($peer, (string) ($action['buttonTarget'] ?? '')),
            'react' => $this->react($peer, (int) ($action['messageId'] ?? 0), (string) ($action['reaction'] ?? '')),
            'markRead' => $this->api->messages->readHistory(peer: $peer, max_id: (int) ($action['messageId'] ?? 0)),
            default => throw new RuntimeException('Unsupported personal-account action.'),
        };
        file_put_contents($receipt, json_encode(['at' => time(), 'type' => $type], JSON_THROW_ON_ERROR), LOCK_EX);
        foreach (glob(StateStore::path('action_*')) ?: [] as $file) {
            if (filemtime($file) !== false && filemtime($file) < time() - 172800) {
                @unlink($file);
            }
        }
        return ['ok' => true, 'duplicate' => false];
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
                        throw new RuntimeException('That button cannot be safely pressed by the connector.');
                    }
                    $this->api->messages->getBotCallbackAnswer(peer: $peer, msg_id: (int) $message['id'], data: $button['data']);
                    return;
                }
            }
        }
        throw new RuntimeException('The requested button was not found in recent messages.');
    }

    private function react(string $peer, int $messageId, string $emoji): void
    {
        if ($messageId <= 0 || $emoji === '') {
            throw new RuntimeException('A message and reaction are required.');
        }
        $this->api->messages->sendReaction(
            peer: $peer,
            msg_id: $messageId,
            reaction: [['_'=>'reactionEmoji', 'emoticon'=>$emoji]],
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

    private static function maskPhone(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone) ?? '';
        return strlen($digits) <= 4 ? '••••' : '+'.substr($digits, 0, 2).str_repeat('•', max(2, strlen($digits) - 4)).substr($digits, -2);
    }
}
