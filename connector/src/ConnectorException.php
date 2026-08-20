<?php

declare(strict_types=1);

namespace ReplyFlow;

use RuntimeException;
use Throwable;

/**
 * Connector failure that can carry a Telegram-requested cool-off, so the control
 * plane can reschedule instead of guessing at a wait.
 */
final class ConnectorException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly ?int $retryAfterSeconds = null,
        public readonly int $httpStatus = 400,
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    /** Extracts the seconds from a Telegram FLOOD_WAIT_x / PEER_FLOOD style error. */
    public static function floodSeconds(Throwable $error): ?int
    {
        if (preg_match('/FLOOD_WAIT_(\d+)/i', $error->getMessage(), $matches) === 1) {
            return (int) $matches[1];
        }
        if (preg_match('/wait (?:of )?(\d+) seconds?/i', $error->getMessage(), $matches) === 1) {
            return (int) $matches[1];
        }
        return null;
    }
}
