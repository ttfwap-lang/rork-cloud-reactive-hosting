<?php

declare(strict_types=1);

namespace ReplyFlow;

use Throwable;

/**
 * Shared resolver for the personal account's Saved Messages peer.
 * Reused across AgentTools (forward_to_saved) and Stage 11 (TelegramService forward action).
 */
final class SavedMessagesResolver
{
    private static int|string|null $cachedPeer = null;

    /**
     * Resolves the Saved Messages peer for the current session.
     */
    public static function resolve(object $proto): int|string
    {
        if (self::$cachedPeer !== null) {
            return self::$cachedPeer;
        }

        try {
            if (method_exists($proto, 'getSelf')) {
                $self = $proto->getSelf();
                if (is_array($self) && isset($self['id'])) {
                    self::$cachedPeer = (int) $self['id'];
                    return self::$cachedPeer;
                }
            }
        } catch (Throwable) {
            // Silently fall back
        }

        return 'me';
    }

    public static function reset(): void
    {
        self::$cachedPeer = null;
    }
}
