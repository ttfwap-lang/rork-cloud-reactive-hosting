<?php

declare(strict_types=1);

namespace ReplyFlow;

use function Amp\delay;

/**
 * Non-blocking delay helper based on Amp\delay to avoid stalling the event loop.
 */
final class AsyncDelay
{
    /**
     * Delays fiber execution by the specified seconds without blocking the event loop.
     */
    public static function forSeconds(float $seconds): void
    {
        if ($seconds > 0) {
            delay($seconds);
        }
    }
}
