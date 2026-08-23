<?php

declare(strict_types=1);

require __DIR__.'/vendor/autoload.php';

use ReplyFlow\SessionRunner;
use ReplyFlow\StateStore;

// With no argument this is the supervisor: it spawns and watches one child per
// connected account. With a tenant argument it *is* that child, and owns exactly
// one Telegram session, its event loop, and the IPC socket the web layer uses.
$tenant = $argv[1] ?? null;

if ($tenant === null || trim($tenant) === '') {
    SessionRunner::supervise();
    exit;
}

SessionRunner::runOne(StateStore::normalize($tenant));
