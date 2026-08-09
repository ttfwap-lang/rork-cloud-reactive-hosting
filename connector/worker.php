<?php

declare(strict_types=1);

require __DIR__.'/vendor/autoload.php';

use ReplyFlow\ReplyFlowEventHandler;
use ReplyFlow\StateStore;

while (true) {
    try {
        $state = StateStore::read();
        if (($state['status'] ?? '') === 'online' && !($state['disabled'] ?? false)) {
            ReplyFlowEventHandler::startAndLoop(StateStore::sessionPath());
        }
    } catch (Throwable) {
        // Deliberately omit exception details: session data can be sensitive.
    }
    sleep(5);
}
