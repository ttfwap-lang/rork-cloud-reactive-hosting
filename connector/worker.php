<?php

declare(strict_types=1);

require __DIR__.'/vendor/autoload.php';

use ReplyFlow\SessionRunner;

// The always-on process: owns the Telegram session and the event loop, and
// serves the web layer over MadelineProto's IPC socket once it is running.
SessionRunner::supervise();
