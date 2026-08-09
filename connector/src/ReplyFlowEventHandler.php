<?php

declare(strict_types=1);

namespace ReplyFlow;

use danog\MadelineProto\EventHandler\Attributes\Handler;
use danog\MadelineProto\EventHandler\Message\Incoming\Message;
use danog\MadelineProto\SimpleEventHandler;
use Throwable;

final class ReplyFlowEventHandler extends SimpleEventHandler
{
    #[Handler]
    public function onIncomingMessage(Message $message): void
    {
        try {
            $state = StateStore::read();
            if (($state['disabled'] ?? false) || ($state['status'] ?? '') !== 'online') {
                return;
            }
            $mediaType = 'text';
            if ($message->media !== null) {
                $class = strtolower($message->media::class);
                $mediaType = str_contains($class, 'photo') ? 'photo'
                    : (str_contains($class, 'video') ? 'video'
                    : (str_contains($class, 'voice') || str_contains($class, 'audio') ? 'voice'
                    : (str_contains($class, 'document') ? 'document'
                    : (str_contains($class, 'sticker') ? 'sticker' : 'other'))));
            }
            self::postEvent([
                'type' => 'message',
                'message' => [
                    'chatKey' => (string) $message->chatId,
                    'sender' => (string) $message->senderId,
                    'text' => (string) $message->text,
                    'direction' => 'incoming',
                    'chatType' => $message->chatId < 0 ? 'group' : 'private',
                    'isEdited' => false,
                    'isReply' => $message->replyToMsgId !== null,
                    'isForwarded' => $message->fwdInfo !== null,
                    'isBot' => false,
                    'mediaType' => $mediaType,
                    'messageId' => (string) $message->id,
                ],
            ]);
        } catch (Throwable) {
            // Message bodies and exceptions are intentionally not logged.
        }
    }

    public function onStart(): void
    {
        self::postEvent(['type' => 'status', 'status' => 'online', 'detail' => 'Personal connector event loop is online.']);
    }

    private static function postEvent(array $payload): void
    {
        $controlPlane = rtrim(getenv('CONTROL_PLANE_URL') ?: '', '/');
        if ($controlPlane === '') {
            return;
        }
        $path = '/connector/event';
        $body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $curl = curl_init($controlPlane.$path);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => Signature::outboundHeaders($path, $body),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);
        curl_exec($curl);
        curl_close($curl);
    }
}
