import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Bot, GitBranch, ImagePlus, KeyRound, Radio, ShieldAlert, Users, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchPublicStats, type PublicStats } from "@/lib/api";
import { SourceOffer } from "@/components/SourceOffer";
import { FlowDemo } from "@/components/FlowDemo";

const CAPABILITIES = [
  {
    icon: Bot,
    title: "Answer any bot",
    body: "Point a flow at a bot, describe what it says, and decide what to send back — text, a button press, or a reaction.",
  },
  {
    icon: GitBranch,
    title: "Multi-step sequences",
    body: "Steps run in order and wait for the bot's next reply. Loops, conditions and captured values are all built in.",
  },
  {
    icon: ImagePlus,
    title: "Build from screenshots",
    body: "Upload screenshots of a real conversation. The transcript is read back, and a draft flow is proposed for you to review.",
  },
  {
    icon: Radio,
    title: "Runs without you",
    body: "Your flows live on an always-on service. Close the tab, shut the laptop — the automation keeps answering.",
  },
] as const;

function StatPill({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "live" }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-secondary/50 px-3.5 py-2 ring-1 ring-white/[0.05]">
      <span className={cn("h-1.5 w-1.5 rounded-full", tone === "live" ? "animate-signal bg-primary" : "bg-muted-foreground/50")} />
      <span className="font-mono text-xs font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

export default function Landing() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicStats().then((result) => { if (!cancelled) setStats(result); });
    return () => { cancelled = true; };
  }, []);

  const spotsLeft = stats?.spotsLeft ?? null;

  return (
    <div className="grid-noise flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">ReplyFlow</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">cloud</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="rounded-full text-sm">
            <Link to="/signin">Sign in</Link>
          </Button>
          <Button asChild size="sm" className="rounded-full text-sm font-semibold">
            <Link to="/signup">Create account</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5">
        <section className="grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-12">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-primary ring-1 ring-primary/25">
              <Zap className="h-3 w-3" />always-on telegram automation
            </span>
            <h1 className="text-balance mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              Your Telegram bot conversations,{" "}
              <span className="relative whitespace-nowrap text-primary">
                answered for you
                <span aria-hidden className="absolute inset-x-0 -bottom-1 h-[3px] rounded-full bg-gradient-to-r from-primary/80 to-accent/40" />
              </span>
              .
            </h1>
            <p className="text-balance mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
              Build a reply flow once — what the bot says, what you send back, which button gets pressed —
              and it runs on our servers around the clock. No scripts, no laptop left open.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-12 gap-2 rounded-full px-6 text-sm font-semibold">
                <Link to="/signup">Create your account <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="h-12 rounded-full px-6 text-sm">
                <Link to="/signin">I already have one</Link>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <StatPill label="accounts" value={stats ? String(stats.accounts) : "—"} />
              <StatPill label="connected right now" value={stats ? String(stats.connected) : "—"} tone={stats && stats.connected > 0 ? "live" : "default"} />
              <StatPill label={spotsLeft === 0 ? "queue open" : "live slots free"} value={spotsLeft === null ? "—" : spotsLeft === 0 ? String(stats?.queued ?? 0) : String(spotsLeft)} />
            </div>
          </div>

          <div className="relative">
            <div aria-hidden className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(closest-side,hsl(168_82%_44%/0.16),transparent)]" />
            <FlowDemo />
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              a flow answering a bot, on repeat
            </p>
          </div>
        </section>

        <section className="grid gap-3 pb-14 sm:grid-cols-2">
          {CAPABILITIES.map((item) => (
            <div key={item.title} className="panel group relative overflow-hidden p-5 transition-transform hover:-translate-y-0.5">
              <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity group-hover:opacity-100" />
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 ring-1 ring-primary/25">
                <item.icon className="h-4.5 w-4.5 text-primary" />
              </div>
              <h2 className="mt-4 text-base font-semibold">{item.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </section>

        <section className="panel mb-14 overflow-hidden">
          <div className="grid gap-0 md:grid-cols-3">
            <div className="border-b border-white/[0.06] p-5 md:border-b-0 md:border-r">
              <KeyRound className="h-4 w-4 text-accent" />
              <h3 className="mt-3 text-sm font-semibold">You bring your own Telegram keys</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Each account connects with its own API ID and hash from Telegram&apos;s own site. Your session is sealed,
                stored apart from everyone else&apos;s, and never reaches this browser.
              </p>
            </div>
            <div className="border-b border-white/[0.06] p-5 md:border-b-0 md:border-r">
              <Users className="h-4 w-4 text-accent" />
              <h3 className="mt-3 text-sm font-semibold">Free, with honest limits</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                One Telegram connection per account and a monthly allowance of screenshot imports. Every live
                connection is a real process, so when the slots are full you join a queue and see your position.
              </p>
            </div>
            <div className="p-5">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <h3 className="mt-3 text-sm font-semibold">Said plainly: there is a risk</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Telegram watches for automated behaviour on personal accounts and can restrict or ban them. You
                acknowledge that before anything is sent, and an emergency stop is always one tap away.
              </p>
            </div>
          </div>
        </section>
      </main>

      <SourceOffer />
    </div>
  );
}
