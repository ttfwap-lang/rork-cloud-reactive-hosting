# Superticket — Connector-Hosted Gemini Agent + Worker Batch Orchestrator (Phases 0–14, sequential)

# Superticket

Single sequential work item implementing the entire initiative. Source of truth: spec:394cc56c-feba-4fee-93fd-352a8ecf5388/009569fa-f5fb-49f7-8a37-cd47308ab57b. Current-state grounding: spec:394cc56c-feba-4fee-93fd-352a8ecf5388/c4ad15ec-e61f-4596-9cbb-709e423b87ff.

Work the stages **in order**. Each stage must leave the repo deployable.

## ⚠️ Read before starting

These decisions were made deliberately across nine rounds of interviewing and one validation pass. **Do not soften them.** If any stage seems to want a safer default, that default was explicitly rejected.

| Do NOT reintroduce | Because |
| --- | --- |
| A read-only / observe-only first slice | Explicitly rejected — Stage 4 ships acting tools |
| A runtime agent mode flag or dry-run for the agent | Explicitly rejected — no runtime gate exists |
| Exact-identifier-only targeting or a mandatory disambiguation prompt | Explicitly rejected — free-form inference |
| Guarding leased chats against Worker writes | Explicitly rejected — conflicts are accepted |
| Routine log pruning, ring buffers, transcript caps | Explicitly rejected — keep everything |
| Caps on turns, concurrency or model spend | Explicitly rejected — unbounded |
| Rails on direct Telegram agent actions | Explicitly rejected — unrailed |
| Exempting the pinned Joe Fortune flow from seizure | Explicitly rejected — seize freely |

## Stage 0 — Dependency and test foundation

**Scope:** file:connector/composer.json, file:connector/Dockerfile

- Commit a `composer.lock`. file:connector/Dockerfile already branches on its presence and prefers it; none exists today, so builds are non-reproducible.
- Add `amphp/http-client` to production `require`, pinned to the amphp v3 line that `danog/madelineproto 8.4.18` already depends on.
- Add PHPUnit as the project's first `require-dev`, plus a `composer test` script.
- Confirm `composer install --no-dev` in the Dockerfile keeps tests out of the image.

**Acceptance:** image builds from the lock file; `composer test` runs; zero runtime behaviour change.

## Stage 1 — Async connector transport

**Scope:** file:connector/src/EventForwarder.php, new async HTTP class

Validated change: `EventForwarder` is refactored **now**, not left alone.

- New async HTTP wrapper over `amphp/http-client`.
- `EventForwarder::post` moves off blocking `curl_exec`. Signature generation via `Signature::outboundHeaders` is unchanged — only the transport changes.
- New async signed Worker client (reads the response, unlike today's fire-and-forget).
- Gemini client shell, async.
- Async delay helper to replace `sleep()` on any event-loop path.

**Why:** `onAnyMessage` runs inside the tenant's blocking MadelineProto event loop. Blocking curl there already stalls the session for up to 10 s; a multi-second model call would be far worse.

**Acceptance:** no `curl_exec` or `sleep()` remains reachable from `onAnyMessage`; forwarding behaviour is externally identical.

## Stage 2 — Connector config and heartbeat

**Scope:** file:connector/src/StateStore.php, file:connector/src/TelegramService.php, file:connector/public/index.php, file:connector/src/SessionRunner.php

- `agent-config.sealed` per tenant — control chat, model id, provider settings. Same libsodium envelope as `state.sealed`.
- New signed route to write it, added to the existing `match ($path)` table.
- **Child heartbeat ticker.** Today `StateStore::heartbeat()` is written once in `runOne` before `startAndLoop()` blocks, and again only when messages arrive. A live-but-idle child therefore looks dead. Add a periodic amphp timer in the child.
- Expose `StateStore::heartbeatAge()` through `publicState()` — the shared response builder, so every session route carries it additively.
- `StateStore::clear()` must erase `agent-*.log`, `agent-*.snapshot`, `agent-config.sealed` and `agent-compact.request`.

**Critical:** provider variables must **not** be added to `REQUIRED_CONNECTOR_VARS`. That list drives `readConnectorReadiness()`, which drives `autoRepairHosting`, which redeploys the container. Adding to it would kill live sessions on every existing deploy.

## Stage 3 — PHP pure state layer

**Scope:** new `ReplyFlow\Agent\*` under file:connector/src/ (PSR-4 already maps it)

Pure, testable, no MadelineProto, no network:

| Class | Responsibility |
| --- | --- |
| `AgentState` | Fold log events into current state |
| `ChatLease` | Ownership and expiry decisions |
| `TurnQueue` | Per-chat FIFO admission |
| `ReplayPlanner` | Intent-without-result → re-issue / skip / abandon |
| `CompactionPolicy` | Free bytes + log size → compact or not |

Plus the append-only log I/O class (not pure, not covered).

Log format: one sealed event per line, `base64url(nonce).base64url(cipher)`. Sealed **per event**, because a single sealed blob cannot be appended to.

**Durability note:** the failure mode is child-process death, not host loss. `fflush` after each intent event is the requirement. `fsync` is reserved for the compaction rename.

**Acceptance:** PHPUnit covers all five pure classes. Nothing is wired into the event handler yet.

## Stage 4 — First live acting agent slice

**Scope:** file:connector/src/ReplyFlowEventHandler.php + agent runner

⚠️ **This is the risk cliff.** Once this deploys with a Gemini key present, the agent acts on a real Telegram account. No observation period, no report-only phase, no dry-run, no mode flag.

Ships:

- Agent hook in `onAnyMessage`, **strictly below** the `$state['disabled'] === true` early return. That check is now the only live stop.
- Gemini 3.7 Flash turn loop. Wire format: `functionDeclarations`, model replies with `functionCall` parts in `candidates[0].content.parts`, results appended as `functionResponse`. Loop until no `functionCall`. This differs from the OpenAI-style `tool_calls` shape in `handleConversationAnalysis`.
- Per-chat in-process queue; cross-chat concurrent and unbounded.
- Write-ahead: `tool.intent` appended and flushed **before** every Telegram call, `tool.result` after.
- Direct tools: `read_history`, `send_text`, `press_button`, `react`, `forward_to_saved`, `mark_read`.
- Control-chat instruction intake; non-control chats are observation only unless already leased by the agent. Messages in leased chats are queued into that chat's turn rather than forwarded as ordinary engine input.
- Free-form target inference — the model's chosen peer string is passed through. Telegram rejections feed back as errors.
- `agent_log` events to the Worker.

**Reuse note:** `forward_to_saved` resolves the Saved Messages peer via `getSelf()`, already called in `withIdentity()`. Write that resolver once — Stage 11's `forward` action shares it.

**Do not reuse ****`TelegramService::runAction`** — its inline `sleep($seconds)` on short flood waits would freeze the event loop.

## Stage 5 — Lease parking and destructive restore

**Scope:** file:functions/engine.ts, `/connector/event`

- `/connector/event` gains a `lease` type alongside `status` and `message`. The HMAC path string is hardcoded in `verifyConnectorRequest`, so this must be additive to that same route — not a new endpoint.
- New tables: `parked_runtime`, `agent_leases`, `agent_turns`.

**Why move rather than flag:** `CREATE TABLE IF NOT EXISTS` in the constructor will not add a column to a table that already exists on a live Durable Object. A `parked` flag would silently no-op. Moving the row out of `runtime` also means the watchdog's `DELETE FROM runtime WHERE expires_at <= ?` cannot see it, so `ingest()` needs **zero** changes.

Acquisition: insert lease → move `runtime` row into `parked_runtime` with `original_expires_at` and `parked_at` → delete from `runtime` → log.

Release: restore as `now + (original_expires_at − parked_at)`; `NEVER_EXPIRES` restores untouched.

**Accepted conflict semantics — implement exactly:**

| Situation | Behaviour |
| --- | --- |
| No current `runtime` row | Restore parked row |
| Current `runtime` row exists | **Restore parked row over it** |
| Conflict detected | Log `agent.lease_conflict_restore`, surface in Agent panel |
| Newer deterministic state lost | Accepted |

The pinned Joe Fortune flow is seizable with no exemption.

## Stage 6 — Replay and orphan recovery

**Scope:** connector startup path + file:functions/engine.ts watchdog

Connector side:

- On child start, fold the log. Intent-without-result is the replay set.
- Verify-then-decide: read recent history and re-issue only if the action clearly did not land.
- **`press_button`**** is re-issued unconditionally** — `getBotCallbackAnswer` leaves no trace, so verification is impossible. Double press accepted.
- Replay **once**. `turn.attempt` is appended *before* the retry, so a crash loop cannot replay forever.

Worker side:

- Restore parked rows when the child heartbeat age (Stage 2) goes stale.
- Absolute max lease TTL as a backstop, applied even when the heartbeat is fresh.
- Both run in `runWatchdogTick`; restore granularity is one 60 s tick.

**Do not** key recovery on `connectorHeartbeatAt` or `/health` — both stay green when a tenant's child is dead, because the web tier and the supervisor are separate processes.

## Stage 7 — Emergency compaction

**Scope:** file:connector/src/SessionRunner.php, agent log layer

- Supervisor detects pressure — it already loops every 3 s and is the only process that can see global free space on the shared `/data` volume.
- Triggers: volume free space **or** per-tenant log cap, whichever first.
- Supervisor writes `agent-compact.request`; the **child** compacts at a turn boundary, preserving single-writer.
- Crash-safe: snapshot + tail to temp, flush, fsync, atomic rename. Never rewrite in place.
- No routine pruning.

## Stage 8 — Worker-mediated agent tools

**Scope:** file:functions/engine.ts

`agentTool` branch on `/connector/event`:

- `patch_settings` — agent may change everything including `killSwitch`, `automationEnabled`, `dryRun`, caps, allowlist, quiet hours. **`alertChatId`**** is rejected Worker-side.** That rejection is what stops the agent silencing its own alarm.
- `save_workflow` — including `bypassLimits: true`.
- `start_batch_run`.
- Every rail change fires `sendOperationalAlert`.

## Stage 9 — Console Agent panel

**Scope:** file:functions/engine.ts (`snapshot()`), file:web/src/lib/api.ts, file:web/src/pages/, file:web/src/App.tsx

- `snapshot()` gains an `agent` section: control chat, child heartbeat age, active turns, held leases, parked rows, conflict restores, recent tools, replay/abandon events, disk state.
- file:web/src/lib/api.ts is a hand-maintained mirror with no codegen — update types there or they silently diverge.
- New Agent page; agent events flow through the existing WebSocket stream.

```wireframe
<!DOCTYPE html>
<html>
<head>
<style>
 body{font-family:system-ui,sans-serif;margin:0;padding:18px;background:#fafafa;color:#111}
 h1{font-size:19px;margin:0 0 3px}
 .sub{font-size:12px;color:#666;margin-bottom:16px}
 .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
 .card{background:#fff;border:1px solid #ddd;border-radius:6px;padding:11px}
 .label{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.04em}
 .value{font-size:19px;margin-top:4px}
 .panel{background:#fff;border:1px solid #ddd;border-radius:6px;margin-bottom:16px}
 .head{padding:9px 12px;border-bottom:1px solid #eee;font-weight:600;font-size:13px;display:flex;justify-content:space-between;align-items:center}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th{font-size:10px;color:#666;text-transform:uppercase;text-align:left;padding:7px 12px;border-bottom:1px solid #eee}
 td{padding:8px 12px;border-bottom:1px solid #f2f2f2}
 button{border:1px solid #aaa;background:#fff;border-radius:4px;padding:4px 9px;font-size:12px}
 .warn{color:#a60}
 .danger{color:#b00}
</style>
</head>
<body>
 <h1>Agent</h1>
 <div class="sub">Connector-hosted Gemini agent. Telegram actions are unrailed. No runtime gate.</div>

 <div class="grid">
  <div class="card"><div class="label">Status</div><div class="value">Acting</div></div>
  <div class="card"><div class="label">Child heartbeat</div><div class="value">3s</div></div>
  <div class="card"><div class="label">Held leases</div><div class="value">4</div></div>
  <div class="card"><div class="label">Turns today</div><div class="value">218</div></div>
 </div>

 <div class="panel">
  <div class="head"><span>Control chat</span><button data-element-id="change-control-chat">Change</button></div>
  <table><tr><td>@agent_control — only this chat creates instructions. Actions may target any chat, including humans.</td></tr></table>
 </div>

 <div class="panel">
  <div class="head"><span>Leases</span><button data-element-id="release-all">Release all</button></div>
  <table>
   <thead><tr><th>Chat</th><th>State</th><th>Parked workflow</th><th>Note</th><th></th></tr></thead>
   <tbody>
    <tr><td>@astro1</td><td>turn running</td><td>—</td><td>agent owns</td><td><button data-element-id="release-astro1">Release</button></td></tr>
    <tr><td>@joefortune</td><td>leased</td><td>step 3, frozen</td><td class="warn">restore may overwrite newer row</td><td><button data-element-id="release-jf">Release</button></td></tr>
   </tbody>
  </table>
 </div>

 <div class="panel">
  <div class="head"><span>Recent tools</span></div>
  <table>
   <thead><tr><th>Time</th><th>Chat</th><th>Tool</th><th>Outcome</th></tr></thead>
   <tbody>
    <tr><td>14:22:07</td><td>@astro2</td><td>forward_to_saved</td><td>ok</td></tr>
    <tr><td>14:21:54</td><td>Sarah</td><td>send_text</td><td>ok</td></tr>
    <tr><td>14:21:40</td><td>@astro1</td><td>press_button</td><td class="danger">replayed — possible double press</td></tr>
   </tbody>
  </table>
 </div>

 <div class="panel">
  <div class="head"><span>Storage</span></div>
  <table><tr><td>84 MB across 3 chat logs. Volume 61% free. No compaction pending.</td></tr></table>
 </div>
</body>
</html>
```

## Stage 10 — TypeScript pure extraction

**Scope:** file:functions/, file:web/src/test/

Buy safety before restructuring `ingest()`. Extract rail evaluation, pacing arithmetic and step-advancement decisions into pure modules beside file:functions/matching.ts, then test them under the existing vitest config — the same cross-boundary import pattern file:web/src/test/matching.test.ts already uses.

No `@cloudflare/vitest-pool-workers`, no wrangler config, no DO harness. None of that exists here and it may not be addable through the Rork-managed pipeline.

file:functions/matching.ts semantics stay identical; its ~25 tests keep passing.

## Stage 11 — Forward action and batch orchestrator

**Scope:** file:functions/engine.ts, file:connector/src/TelegramService.php

- `WorkflowActionType` gains `forward`; update `normalizeStep`, `validateStep`, `sendAction`, and the file:web/src/lib/api.ts mirror.
- `runAction` gains a forward arm using the shared `getSelf()` resolver from Stage 4.
- `runs` and `run_items` tables.
- Alarm-driven self-pacing that stays under `perMinuteCap` **by design**, never triggering a block.

**The blocker this fixes:** today `reserveSlot` returns `{ blocked }`, `executeAction` returns `false`, and `ingest` aborts *without advancing*. The job lands in `failed_jobs` as `pending`, but `runDueRetries` only replays rows with `autoRetry: true` — set solely on the flood-wait path. An unattended 72-action run would stall permanently.

**Alarm constraint:** `onAlarm` unconditionally re-arms every 60 s in a `finally`, and `scheduleAlarm` only brings that single shared alarm *forward*. Cooperate with it; do not assume a private timer.

**Target check:** 3 bots × 12 signs = 72 actions. At `minGapMs: 1500` and `perMinuteCap: 20`, the floor is ~3.6 min; realistic completion 8–12 min, well inside `dailyCap: 500`.

## Stage 12 — Conversation ingestion

**Scope:** file:functions/engine.ts, file:connector/src/TelegramService.php, file:web/src/pages/ConversationImport.tsx

- Telegram Desktop JSON (`result.json`) and HTML export parsing.
- Live MTProto history pull — `messages->getHistory` is already proven inside `pressButton`; needs pagination and a cap.
- Parse and distil **locally**; send only the summarised pattern to the model, not raw bulk history.

## Stage 13 — NL planner

**Scope:** file:functions/engine.ts, file:web/src/

- Worker-side planner turning plain English into a batch-run plan.
- **Mandatory preview-and-approve** — the user sees the expanded item list ("3 bots × 12 signs = 36 items, 72 actions") and approves once.
- After approval, execution is fully unattended.

Note the deliberate asymmetry: the batch planner is gated; the conversational agent is not.

## Stage 14 — Auto-repair rework

**Scope:** file:functions/engine.ts

- Make `autoRepairHosting` run- and lease-aware; defer redeploy while a run or lease is active.
- Separate config push from redeploy. `applyHostingConfig` currently ends in `startDeployment`; everything before it (variables, volume, domain) is non-destructive and can be split off.
- Reconcile timing: `AUTO_REPAIR_COOLDOWN_MS` is 10 min with exponential backoff across 5 attempts — slower than an entire batch run.
- **Bump ****`REPAIR_LOGIC_VERSION`**** 4 → 5.** The code explicitly discards stored attempts on version mismatch; without the bump, live engines inherit stale counts, some already exhausted at `attempts: 5`.
- `PublicStatus` is unauthenticated and value-free — any new outcome extends the `HostingApplyCode` union and carries no project, service or address names.

## Cross-cutting invariants

Must hold at every stage:

1. Agent hook stays below the `disabled` check.
2. No blocking HTTP or `sleep()` on event-loop paths.
3. `tool.intent` flushed before the Telegram call; `turn.attempt` written before a replay.
4. Agent logs sealed per event; `forget()` erases all of them.
5. `alertChatId` never agent-writable.
6. Provider vars never in `REQUIRED_CONNECTOR_VARS`.
7. Parked rows may overwrite newer runtime rows — logged, accepted.
8. `matching.ts` behaviour-identical.
9. `PublicStatus` value-free.
10. Message bodies never reach a plaintext log; `redactConnectorMessage` preserved.
11. `/health` stays fast and never touches Telegram — the Docker `HEALTHCHECK` restarts the service on failure.

## Rollback

Remove the Gemini key (agent inert at next child restart), or redeploy the previous image. All new state lives in new files and new tables, so there is nothing to migrate back.

## Accepted risks

Ban exposure on the personal account; unbounded model spend; unbounded log growth on a volume shared by up to 5 tenants; duplicate button presses after a crash; the agent can message the wrong chat; the agent can message humans; the agent can disarm its own rails except alerting; deterministic workflow state can be lost on lease restore; bulk history reaches a model.