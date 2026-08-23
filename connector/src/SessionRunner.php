<?php

declare(strict_types=1);

namespace ReplyFlow;

use Throwable;

/**
 * The always-on supervisor.
 *
 * One connected account is one Telegram event loop, and an event loop blocks for
 * as long as it stays healthy. So the supervisor never runs a loop itself: it
 * spawns one child process per eligible account, watches them, and restarts any
 * that exit. That keeps accounts genuinely independent — one dropping, crashing
 * or flood-waiting cannot stall anybody else's automation.
 */
final class SessionRunner
{
    private const IDLE_SLEEP_SECONDS = 3;
    /** Matches the control plane's live-connection ceiling. */
    private const MAX_CONCURRENT_SESSIONS = 5;
    /** Stops a broken account from being respawned in a tight loop. */
    private const RESTART_BACKOFF_SECONDS = 15;

    /** tenant => ['process' => resource, 'startedAt' => int] */
    private static array $children = [];
    /** tenant => earliest unix time it may be started again */
    private static array $backoff = [];

    /** Parent process: keeps one child alive per connected account. */
    public static function supervise(): void
    {
        while (true) {
            try {
                StateStore::supervisorHeartbeat();
                self::reap();
                self::spawnEligible();
            } catch (Throwable) {
                // Never logged: traces can contain session material and message text.
            }
            sleep(self::IDLE_SLEEP_SECONDS);
        }
    }

    /** Child process: runs exactly one account's event loop until it drops. */
    public static function runOne(string $tenant): void
    {
        StateStore::use($tenant);
        while (true) {
            try {
                StateStore::heartbeat();
                if (!self::eligible($tenant)) {
                    return;
                }
                $credentials = TelegramService::credentials($tenant);
                if ($credentials === null) {
                    return;
                }
                // Blocks for as long as the connection stays healthy; returns on disconnect.
                ReplyFlowEventHandler::startAndLoop(
                    StateStore::sessionPath($tenant),
                    TelegramService::buildSettings($credentials['apiId'], $credentials['apiHash']),
                );
            } catch (Throwable) {
                // Never logged: traces can contain session material and message text.
            }
            sleep(self::IDLE_SLEEP_SECONDS);
        }
    }

    /** An account is run only while it is logged in, enabled and not mid-login. */
    private static function eligible(string $tenant): bool
    {
        try {
            $state = StateStore::read($tenant);
        } catch (Throwable) {
            return false;
        }
        if (($state['disabled'] ?? false) === true) {
            return false;
        }
        if (($state['status'] ?? '') !== 'online') {
            return false;
        }
        if ((int) ($state['loginLockUntil'] ?? 0) > time()) {
            return false;
        }

        return StateStore::sessionExists($tenant);
    }

    /** Clears finished children so their account can be started again. */
    private static function reap(): void
    {
        foreach (self::$children as $tenant => $child) {
            $status = proc_get_status($child['process']);
            if ($status === false || $status['running'] === false) {
                proc_close($child['process']);
                unset(self::$children[$tenant]);
                self::$backoff[$tenant] = time() + self::RESTART_BACKOFF_SECONDS;
            }
        }
    }

    private static function spawnEligible(): void
    {
        foreach (StateStore::tenants() as $tenant) {
            if (count(self::$children) >= self::MAX_CONCURRENT_SESSIONS) {
                return;
            }
            if (isset(self::$children[$tenant])) {
                continue;
            }
            if ((self::$backoff[$tenant] ?? 0) > time()) {
                continue;
            }
            if (!self::eligible($tenant)) {
                continue;
            }
            self::spawn($tenant);
        }
    }

    private static function spawn(string $tenant): void
    {
        $command = [PHP_BINARY, dirname(__DIR__).'/worker.php', $tenant];
        // Output is discarded rather than piped: MadelineProto notices can contain
        // account detail, and an unread pipe would eventually block the child.
        $descriptors = [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']];
        $process = @proc_open($command, $descriptors, $pipes);
        if (!is_resource($process)) {
            self::$backoff[$tenant] = time() + self::RESTART_BACKOFF_SECONDS;

            return;
        }
        self::$children[$tenant] = ['process' => $process, 'startedAt' => time()];
    }
}
