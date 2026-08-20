<?php

declare(strict_types=1);

namespace ReplyFlow;

use Throwable;

/**
 * The always-on supervisor.
 *
 * This is the only process that runs the Telegram event loop. It claims the
 * session strictly while the account is logged in and not disconnected, which
 * keeps ownership unambiguous: during a login the web layer owns the session,
 * and afterwards this process takes it over and serves the web layer over
 * MadelineProto's IPC socket.
 */
final class SessionRunner
{
    private const IDLE_SLEEP_SECONDS = 3;

    public static function supervise(): void
    {
        while (true) {
            try {
                StateStore::heartbeat();
                self::tick();
            } catch (Throwable) {
                // Never logged: traces can contain session material and message text.
            }
            sleep(self::IDLE_SLEEP_SECONDS);
        }
    }

    /** Starts the event loop when — and only when — the session is ours to run. */
    private static function tick(): void
    {
        $state = StateStore::read();
        if (($state['disabled'] ?? false) === true) {
            return;
        }
        if (($state['status'] ?? '') !== 'online') {
            return;
        }
        if ((int) ($state['loginLockUntil'] ?? 0) > time()) {
            return;
        }
        if (!StateStore::sessionExists()) {
            return;
        }
        $credentials = TelegramService::credentials();
        if ($credentials === null) {
            return;
        }

        // Blocks for as long as the connection stays healthy; returns on disconnect.
        ReplyFlowEventHandler::startAndLoop(
            StateStore::sessionPath(),
            TelegramService::buildSettings($credentials['apiId'], $credentials['apiHash']),
        );
    }
}
