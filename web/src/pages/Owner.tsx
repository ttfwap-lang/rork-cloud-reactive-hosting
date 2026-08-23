import { useState } from "react";
import { Ban, Crown, Loader2, RefreshCw, Trash2, Undo2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";

function Metric({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: string }) {
  return (
    <div className="panel relative overflow-hidden p-4">
      <div className={cn("absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl", tone)} />
      <p className="font-mono text-3xl font-semibold tabular-nums leading-none">{value}</p>
      <p className="mt-1.5 text-sm font-medium">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function Owner() {
  const { ownerOverview, refreshOwnerOverview, suspendAccount, removeAccount } = useEngine();
  const [busyId, setBusyId] = useState<string | null>(null);

  const overview = ownerOverview;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Crown className="h-5 w-5 text-accent" />Owner area
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who is using ReplyFlow and how much of the hosting they are holding. Only your account can open this page.
          </p>
        </div>
        <Button size="sm" variant="secondary" className="rounded-full" onClick={refreshOwnerOverview}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh
        </Button>
      </header>

      {!overview ? (
        <div className="panel grid h-40 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Accounts" value={overview.accounts} hint={`${overview.active} active · ${overview.suspended} suspended`} tone="bg-primary" />
            <Metric label="Connected" value={overview.connected} hint={`of ${overview.capacityLimit} live slots`} tone="bg-accent" />
            <Metric label="Queued" value={overview.queued} hint="waiting for a free slot" tone="bg-amber-400" />
            <Metric label="Slots free" value={Math.max(0, overview.capacityLimit - overview.connected)} hint="each one is a real process" tone="bg-primary" />
          </div>

          <section className="panel overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div>
                <h2 className="text-sm font-semibold">Accounts</h2>
                <p className="text-[11px] text-muted-foreground">Usernames and usage only — no account&apos;s flows, logs or Telegram are visible from here.</p>
              </div>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {overview.rows.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold uppercase", row.role === "owner" ? "bg-accent/15 text-accent" : "bg-primary/12 text-primary")}>
                    {row.username.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{row.username}</p>
                      {row.role === "owner" ? <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[9px] uppercase text-accent ring-1 ring-accent/25">owner</span> : null}
                      {row.status === "suspended" ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-[9px] uppercase text-destructive ring-1 ring-destructive/25">suspended</span> : null}
                      {row.live ? <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase text-primary ring-1 ring-primary/25"><span className="h-1 w-1 animate-signal rounded-full bg-primary" />live</span> : null}
                      {row.queued ? <span className="rounded-full bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] uppercase text-amber-300 ring-1 ring-amber-400/25">queued</span> : null}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Joined {new Date(row.createdAt).toLocaleDateString()}
                      {row.lastSeenAt ? ` · last seen ${new Date(row.lastSeenAt).toLocaleString()}` : " · never signed in"}
                      {` · ${row.aiUsed} AI import${row.aiUsed === 1 ? "" : "s"} this month`}
                    </p>
                  </div>

                  {row.role === "owner" ? null : row.status === "suspended" ? (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="rounded-full"
                        disabled={busyId === row.id}
                        onClick={() => { setBusyId(row.id); void suspendAccount(row.id, false).finally(() => setBusyId(null)); }}
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" />Restore
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="border-white/[0.08] bg-card">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {row.username} for good?</AlertDialogTitle>
                            <AlertDialogDescription>
                              The username is freed and they can no longer sign in. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="rounded-xl">Keep account</AlertDialogCancel>
                            <AlertDialogAction
                              className="rounded-xl bg-destructive text-white"
                              onClick={() => { setBusyId(row.id); void removeAccount(row.id).finally(() => setBusyId(null)); }}
                            >
                              Remove account
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive">
                          <Ban className="mr-1.5 h-3.5 w-3.5" />Suspend
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="border-white/[0.08] bg-card">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Suspend {row.username}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            They are signed out everywhere and their live connection slot is released. Their flows, logs and
                            Telegram session are left untouched, so restoring them later brings everything back.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="rounded-xl bg-destructive text-white"
                            onClick={() => { setBusyId(row.id); void suspendAccount(row.id, true).finally(() => setBusyId(null)); }}
                          >
                            Suspend account
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
