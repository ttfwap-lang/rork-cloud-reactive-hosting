import { useEffect, useMemo, useState } from "react";
import { Activity, FolderGit2, GitBranch, Hammer, Loader2, RefreshCw, Rocket, ShieldAlert, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import type { HealthSample, SourceCheckState } from "@/lib/api";

const POLL_MS = 30_000;

/** Build states Railway reports while work is still in flight. */
const BUSY_STATES: readonly string[] = ["BUILDING", "DEPLOYING", "INITIALIZING", "WAITING", "QUEUED", "NEEDS_APPROVAL"];

function buildTone(status: string | null): { label: string; className: string; dot: string } {
  if (status === null) return { label: "never built", className: "bg-secondary/60 text-muted-foreground ring-white/10", dot: "bg-muted-foreground" };
  if (status === "SUCCESS") return { label: "build passed", className: "bg-primary/12 text-primary ring-primary/25", dot: "bg-primary" };
  if (BUSY_STATES.includes(status)) return { label: status.toLowerCase(), className: "bg-accent/12 text-accent ring-accent/25", dot: "bg-accent" };
  return { label: status.toLowerCase(), className: "bg-destructive/12 text-destructive ring-destructive/25", dot: "bg-destructive" };
}

/** How the pre-flight source check reads to someone who is not a developer. */
function sourceTone(state: SourceCheckState | undefined): { label: string; className: string; dot: string } {
  if (state === "ok") return { label: "source found", className: "bg-primary/12 text-primary ring-primary/25", dot: "bg-primary" };
  if (state === "not_found" || state === "missing_connector") return { label: "source missing", className: "bg-destructive/12 text-destructive ring-destructive/25", dot: "bg-destructive" };
  return { label: "not confirmed", className: "bg-secondary/60 text-muted-foreground ring-white/10", dot: "bg-muted-foreground" };
}

function duration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

/** Thin vertical bars, one per liveness sample, oldest on the left. */
function Sparkline({ history }: { history: HealthSample[] }) {
  const slots = useMemo<Array<HealthSample | null>>(() => {
    const padding = Math.max(0, 60 - history.length);
    return [...Array.from<null>({ length: padding }).fill(null), ...history];
  }, [history]);
  const peak = useMemo<number>(() => Math.max(120, ...history.map((sample) => sample.ms ?? 0)), [history]);

  return (
    <div className="flex h-10 items-end gap-[2px]" aria-hidden>
      {slots.map((sample, index) => {
        if (!sample) return <div key={`gap-${index}`} className="h-1 flex-1 rounded-full bg-white/[0.04]" />;
        const height = sample.up ? Math.max(18, Math.min(100, ((sample.ms ?? 0) / peak) * 100)) : 100;
        return (
          <div
            key={`${sample.t}-${index}`}
            className={cn("flex-1 rounded-full transition-all", sample.up ? "bg-primary/60" : "bg-destructive/80")}
            style={{ height: `${height}%` }}
            title={`${new Date(sample.t).toLocaleTimeString()} · ${sample.up ? `up${sample.ms === null ? "" : ` ${sample.ms}ms`}` : "down"}`}
          />
        );
      })}
    </div>
  );
}

export function HostingStatus() {
  const { hostingStatus, hostingStatusUpdatedAt, refreshHostingStatus, setAutoDeploy, forceRebuild } = useEngine();
  const [now, setNow] = useState<number>(() => Date.now());
  const [repository, setRepository] = useState<string>("");
  const [branch, setBranch] = useState<string>("");
  const [rebuildBranch, setRebuildBranch] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [rebuilding, setRebuilding] = useState<boolean>(false);

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  const nextIn = Math.max(0, Math.ceil((hostingStatusUpdatedAt + POLL_MS - now) / 1000));
  const up = hostingStatus?.probe.reachable ?? false;
  const uptime = hostingStatus?.uptimePct;
  const build = buildTone(hostingStatus?.build.status ?? null);
  const autoDeploy = hostingStatus?.autoDeploy;
  const repair = hostingStatus?.repair;
  const source = hostingStatus?.source;
  const sourceState = sourceTone(source?.state);
  const needsRepo = autoDeploy !== undefined && autoDeploy.repository === null;
  // The engine already knows which repository this connector is built from, so the
  // field only has to be filled in to override it.
  const repoValue = repository.trim().length > 0 ? repository.trim() : (source?.repository ?? "");

  const toggleAutoDeploy = (enabled: boolean): void => {
    setBusy(true);
    const payload = enabled && needsRepo
      ? { enabled, repository: repoValue, branch: branch.trim() || undefined }
      : { enabled };
    setAutoDeploy(payload).catch(() => undefined).finally(() => setBusy(false));
  };

  const startRebuild = (): void => {
    setRebuilding(true);
    const target = rebuildBranch.trim();
    forceRebuild(target.length > 0 ? { branch: target } : {})
      .then(() => setRebuildBranch(""))
      .catch(() => undefined)
      .finally(() => setRebuilding(false));
  };

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] p-5">
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1", up ? "bg-primary/10 text-primary ring-primary/20" : "bg-destructive/10 text-destructive ring-destructive/20")}>
          <Activity className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Service status</h2>
          <p className="text-[11px] text-muted-foreground">Checked automatically every 30 seconds, whether or not this tab is in front.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Timer className="h-3 w-3" />{nextIn}s
          </span>
          <Button size="sm" variant="secondary" className="rounded-full" onClick={refreshHostingStatus}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Check now
          </Button>
        </div>
      </div>

      <div className="grid gap-px bg-white/[0.05] sm:grid-cols-3">
        <div className="bg-card/60 p-5">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", up ? "animate-signal bg-primary" : "bg-destructive")} />
            <p className={cn("text-sm font-semibold", up ? "text-primary" : "text-destructive")}>{up ? "Reachable" : "Not reachable"}</p>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{hostingStatus?.probe.detail ?? "Waiting for the first check."}</p>
          {hostingStatus?.probe.latencyMs !== null && hostingStatus?.probe.latencyMs !== undefined ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">answered in {hostingStatus.probe.latencyMs}ms</p>
          ) : null}
        </div>

        <div className="bg-card/60 p-5">
          <p className="font-mono text-3xl font-semibold tabular-nums leading-none">{uptime === null || uptime === undefined ? "—" : `${uptime}%`}</p>
          <p className="mt-1.5 text-xs font-medium">Uptime</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {hostingStatus === undefined || hostingStatus.sampleCount === 0
              ? "No checks recorded yet."
              : `${hostingStatus.sampleCount} checks over ${duration(hostingStatus.windowMs)}.`}
          </p>
          {hostingStatus?.onlineSince ? (
            <p className="mt-1 font-mono text-[10px] text-primary">up {duration(now - hostingStatus.onlineSince)}</p>
          ) : hostingStatus?.lastDownAt ? (
            <p className="mt-1 font-mono text-[10px] text-destructive">down {duration(now - hostingStatus.lastDownAt)}</p>
          ) : null}
        </div>

        <div className="bg-card/60 p-5">
          <div className="flex items-center gap-2">
            <Hammer className="h-3.5 w-3.5 text-muted-foreground" />
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ring-1", build.className)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", build.dot, BUSY_STATES.includes(hostingStatus?.build.status ?? "") ? "animate-signal" : "")} />
              {build.label}
            </span>
          </div>
          <p className="mt-2 truncate text-xs font-medium" title={hostingStatus?.build.serviceName ?? undefined}>{hostingStatus?.build.serviceName ?? "No service found"}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {hostingStatus?.build.at ? `Last build ${duration(now - hostingStatus.build.at)} ago.` : "This service has never finished a build."}
          </p>
          {hostingStatus?.build.failure ? (
            <p className="mt-2 rounded-lg bg-destructive/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">{hostingStatus.build.failure.hint}</p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-white/[0.06] p-5">
        <Sparkline history={hostingStatus?.history ?? []} />
        <p className="mt-2 text-[10px] text-muted-foreground">Each bar is one check. Height is response time; full-height red means unreachable.</p>
      </div>

      {repair && repair.attempts > 0 ? (
        <div className={cn("flex gap-3 border-t border-white/[0.06] p-5", repair.exhausted ? "bg-destructive/[0.05]" : "bg-amber-400/[0.04]")}>
          <ShieldAlert className={cn("mt-0.5 h-4 w-4 shrink-0", repair.exhausted ? "text-destructive" : "text-amber-400")} />
          <div className="min-w-0">
            <p className="text-xs font-semibold">{repair.exhausted ? "Automatic repair gave up" : `Automatic repair ran ${repair.attempts} time${repair.attempts === 1 ? "" : "s"}`}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {repair.exhausted
                ? "The service stayed unreachable after repeated redeploys. Read the build log below to see why."
                : "The engine noticed the service was down and redeployed it by itself."}
              {repair.lastDetail ? ` Last result: ${repair.lastDetail}` : ""}
            </p>
            {!repair.exhausted && repair.nextAt !== null && repair.nextAt > now ? (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">next attempt in {duration(repair.nextAt - now)}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="border-t border-white/[0.06] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary/60 ring-1 ring-white/10">
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <GitBranch className={cn("h-4 w-4", autoDeploy?.enabled ? "text-primary" : "text-muted-foreground")} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Rebuild on every push</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{autoDeploy?.detail ?? "Waiting for the first check."}</p>
          </div>
          <Switch
            checked={autoDeploy?.enabled ?? false}
            disabled={busy || autoDeploy === undefined || (needsRepo && repoValue.length === 0)}
            onCheckedChange={toggleAutoDeploy}
            aria-label="Rebuild the service whenever the repository receives a push"
          />
        </div>

        {needsRepo ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-[1.6fr_1fr]">
            <Input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder={source?.repository ?? "owner/repository"} className="h-9 font-mono text-xs" />
            <Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder={source?.branch ?? "main"} className="h-9 font-mono text-xs" />
            <p className="text-[10px] text-muted-foreground sm:col-span-2">
              No repository is attached to this service yet. The one shown is the repository this connector is built from, so leaving these blank is usually right.
            </p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/[0.06] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary/60 ring-1 ring-white/10">
            <FolderGit2 className={cn("h-4 w-4", source?.state === "ok" ? "text-primary" : "text-muted-foreground")} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">Code to build</p>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ring-1", sourceState.className)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", sourceState.dot)} />
                {sourceState.label}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{source?.detail ?? "Waiting for the first check."}</p>
            {source?.commitSha ? (
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                {source.repository} · {source.branch} · {source.commitSha}
              </p>
            ) : null}
          </div>
        </div>
        {source?.state === "ok" && hostingStatus?.build.failure?.code === "no_build_output" ? (
          <p className="mt-3 rounded-lg bg-amber-400/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            The code is definitely there, yet the build fetched nothing. That points at the hosting platform's permission to read this repository rather than at the code. A rebuild re-establishes that link and is worth trying first.
          </p>
        ) : null}
      </div>

      <div className="border-t border-white/[0.06] bg-secondary/20 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
            {rebuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Force rebuild</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Builds and redeploys straight away, whether or not anything changed. Use it after fixing something on the hosting side.
            </p>
          </div>
          <Button
            className="rounded-full"
            disabled={rebuilding || hostingStatus === undefined}
            onClick={startRebuild}
          >
            {rebuilding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
            {rebuilding ? "Starting…" : "Rebuild now"}
          </Button>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={rebuildBranch}
            onChange={(event) => setRebuildBranch(event.target.value)}
            placeholder={autoDeploy?.branch ?? "leave blank to keep the current branch"}
            className="h-9 font-mono text-xs"
            aria-label="Branch to build"
          />
          <p className="self-center text-[10px] leading-relaxed text-muted-foreground">
            Every rebuild reconnects the repository first, then builds. Naming a branch also makes it the only one this service builds from.
          </p>
        </div>

        {repair?.exhausted ? (
          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            Automatic repair has stopped trying. A rebuild by hand clears that, so the engine resumes watching afterwards.
          </p>
        ) : null}
      </div>
    </section>
  );
}
