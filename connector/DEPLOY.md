# Deploy the always-on Telegram service

This folder is the only part of ReplyFlow that talks to your personal Telegram
account. It has to run on a real Linux host that stays up 24/7. These steps use
Railway; any Docker host works the same way.

Follow the steps in order. It takes about ten minutes.

---

## Step 1 — Get your Telegram app credentials

1. Open <https://my.telegram.org> and log in with your phone number.
2. Choose **API development tools**.
3. Fill in any app title and short name (for example `ReplyFlow`, `replyflow`).
4. Copy the two values it shows you:
   - **App api_id** — a number, e.g. `1234567`
   - **App api_hash** — 32 letters and numbers

Keep this tab open. You will paste both into Railway in step 4.

> These never touch your browser or the dashboard. They live only on this service.

---

## Step 2 — Create the service on Railway

1. Go to <https://railway.app> and sign in.
2. **New Project → Deploy from GitHub repo**, and pick this repository.
3. When it asks for the **Root Directory**, enter:

   ```
   connector
   ```

4. Railway detects the `Dockerfile` automatically. Let the first build run —
   it will fail its health check until step 4 is done. That is expected.

---

## Step 3 — Attach a permanent disk

Without this, your Telegram login is wiped on every restart and you have to
scan the QR code again.

1. Open the service → **Variables** tab is where we go next, but first:
2. Go to the service → **Settings → Volumes → New Volume**.
3. Set the **Mount path** to exactly:

   ```
   /data
   ```

4. Save.

---

## Step 4 — Paste in the values

Service → **Variables** → **Raw Editor**, then paste this block in whole.
Replace only the two Telegram lines with your own values from step 1.

```
TELEGRAM_API_ID=paste-your-api-id-here
TELEGRAM_API_HASH=paste-your-api-hash-here
SESSION_ENCRYPTION_KEY=0f32f873e33e08445fdb76b2e9a495a5aa7cad7cc61300f93c57d8889ee51a73
CONNECTOR_SHARED_SECRET=28231886a62412bbe363c4ba1859398ce12d5f2eb67b75582de2e73c2d8eeffe
CONTROL_PLANE_URL=https://cloud-reactive-hosting-backend.rork.app
SESSION_PATH=/data
```

What each one is for:

- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` — your app credentials from step 1.
- `SESSION_ENCRYPTION_KEY` — encrypts the saved login on the disk. Generated for
  you. **If you ever change it, your saved login becomes unreadable and you must
  log in again.**
- `CONNECTOR_SHARED_SECRET` — proves this service and your ReplyFlow engine are
  talking to each other. It must stay identical on both sides.
- `CONTROL_PLANE_URL` — where this service sends the messages it sees. No
  trailing slash.
- `SESSION_PATH` — where the login is stored. Must match the volume from step 3.

Save. Railway redeploys automatically.

---

## Step 5 — Get the service address

1. Service → **Settings → Networking → Generate Domain**.
2. Copy the address it gives you, e.g. `https://replyflow-connector.up.railway.app`.

---

## Step 6 — Check it is healthy

Open this in your browser, using your address from step 5:

```
https://YOUR-ADDRESS/selfcheck
```

You will get a plain list of every setting with `pass`, `warn` or `fail`, and a
one-line summary. Fix anything marked `fail` and reload.

At this point you should see:

- Everything `pass`, except
- **Telegram login** — `warn`, "Not logged in yet". That is correct; you log in next.

The page never shows the value of a secret, only whether it is present and
correctly shaped.

---

## Step 7 — Connect it to ReplyFlow

Back in the ReplyFlow engine, set these server-side values:

```
CONNECTOR_BASE_URL=https://replytelego-production.up.railway.app
CONNECTOR_SHARED_SECRET=28231886a62412bbe363c4ba1859398ce12d5f2eb67b75582de2e73c2d8eeffe
CREDENTIAL_ENCRYPTION_KEY=6eb2c8778711d19478d672c3bb357c93687eb63ddb96618808ce9db0653d015e
```

`CONNECTOR_SHARED_SECRET` must be byte-identical to the one in step 4.

Then open the console → **Connection** and press **Test service**. It reports
whether the address answers and whether the always-on process is running. The
login button stays disabled until that check passes, so you can never scan a QR
code into a service that is not there.

---

## Step 8 — Log in and watch it run

1. Open the ReplyFlow console → **Connection**.
2. Tick the risk acknowledgement and press **Generate secure QR**.
3. In Telegram on your phone: **Settings → Devices → Link Desktop Device**, and
   scan the code. The console refreshes the code by itself while you do this —
   leave the page open.
4. If you use two-step verification, Telegram asks for the password next. It is
   sent once and never stored.
5. Once it says **online**, go to **Workflows**. The hardwired card should read
   **Armed**.
6. Put your target bot in the **Run now** box and press **Start flow**, or send
   `joefortune` yourself in that chat.

Watch **Live activity** on the Overview page. You should see the five steps go
through in order.

---

## If something goes wrong

- **`/health` and `/selfcheck` return `Application not found`** — that reply comes
  from Railway itself, not from this service: the domain exists but no running
  deployment is attached to it. Check the service's **Deployments** tab for a
  failed or crashed build, confirm **Root Directory** is `connector`, and confirm
  the generated domain targets port `8080`.
- **`/selfcheck` says "Always-on process: Stalled"** — the background process
  died. Check Railway's deploy logs for a crash on startup.
- **Login never completes** — confirm the volume is mounted at `/data` and that
  `SESSION_PATH=/data`. Without the disk, the login is thrown away instantly.
- **Console says "connector heartbeat is overdue"** — `CONNECTOR_BASE_URL` in the
  engine does not match the Railway address, or the two shared secrets differ.
- **Flow sends step 1 then stops** — the reply is not being seen as coming from a
  bot. Check the target really is a bot account, and that the bot is replying in
  the same chat.
- **"Telegram asked for a Ns pause"** — normal. The action reschedules itself and
  resumes automatically once the wait is over.

---

## Two things to keep in mind

**Account risk.** This flow runs with all pacing removed, which is exactly the
pattern Telegram watches for. Restriction or a ban is a real possibility. The
single flood wait we honour reduces that risk but does not remove it. Use an
account you can afford to lose.

**Licence.** This service uses MadelineProto, which is AGPL-3.0. If you make the
service available to other people, the AGPL requires you to offer them the
corresponding source. Resolve this before any production or commercial use.
