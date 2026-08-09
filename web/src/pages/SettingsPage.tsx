import { useEffect, useState, type ReactNode } from "react";
import { AlertOctagon, BellRing, Clock3, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useEngine } from "@/lib/engine-store";
import type { Settings } from "@/lib/api";

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <div className="border-b border-white/[0.05] px-4 py-4 last:border-0"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p></div><div className="shrink-0">{children}</div></div></div>;
}

export default function SettingsPage() {
  const { snapshot, saveSettings } = useEngine();
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => { if (snapshot?.settings) setDraft(snapshot.settings); }, [snapshot?.settings]);
  if (!draft) return null;
  const patch = (next: Partial<Settings>): void => setDraft((current) => current ? { ...current, ...next } : current);
  const commit = (): void => { saveSettings(draft); toast.success("Safety policy saved"); };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header className="flex items-end justify-between gap-3"><div><h1 className="text-xl font-semibold tracking-tight">Safety & operations</h1><p className="mt-1 text-sm text-muted-foreground">Conservative limits apply to bot and personal-account actions.</p></div><Button size="sm" className="rounded-full" onClick={commit}><Save className="mr-1.5 h-3.5 w-3.5" />Save</Button></header>

      <section className="panel overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Global controls</p></div></div>
        <Row title="Automation enabled" hint="One-click pause for every workflow while keeping Telegram connected."><Switch checked={draft.automationEnabled} onCheckedChange={(checked) => patch({ automationEnabled: checked })} /></Row>
        <Row title="Emergency kill switch" hint="Last-resort stop checked again immediately before every action."><Switch checked={draft.killSwitch} onCheckedChange={(checked) => patch({ killSwitch: checked })} /></Row>
        <Row title="Dry-run mode" hint="Match and advance workflows, but never contact Telegram."><Switch checked={draft.dryRun} onCheckedChange={(checked) => patch({ dryRun: checked })} /></Row>
        <Row title="Auto-pause on Telegram slow-down" hint="Pause and recover automatically after rate limits; quarantine account-risk warnings."><Switch checked={draft.autoPauseOnFlood} onCheckedChange={(checked) => patch({ autoPauseOnFlood: checked })} /></Row>
      </section>

      <section className="panel overflow-hidden">
        <div className="px-4 pb-1 pt-4"><p className="text-sm font-medium">Minimum gap between actions</p><p className="mt-0.5 text-[11px] text-muted-foreground">Currently {(draft.minGapMs / 1000).toFixed(1)}s</p><Slider value={[draft.minGapMs]} min={0} max={30_000} step={500} className="my-4" onValueChange={(value) => patch({ minGapMs: value[0] ?? 0 })} /></div>
        <div className="border-t border-white/[0.05] px-4 pb-1 pt-4"><p className="text-sm font-medium">Per-minute cap</p><p className="mt-0.5 text-[11px] text-muted-foreground">Maximum {draft.perMinuteCap} Telegram actions each minute</p><Slider value={[draft.perMinuteCap]} min={1} max={60} step={1} className="my-4" onValueChange={(value) => patch({ perMinuteCap: value[0] ?? 1 })} /></div>
        <div className="grid border-t border-white/[0.05] sm:grid-cols-3">
          <div className="p-4"><label className="text-xs font-medium">Daily cap</label><Input type="number" min={1} max={10000} value={draft.dailyCap} onChange={(event) => patch({ dailyCap: Math.max(1, Number(event.target.value)) })} className="mt-2 h-9 rounded-xl bg-input/60 font-mono" /></div>
          <div className="border-white/[0.05] p-4 sm:border-l"><label className="text-xs font-medium">Per-chat cooldown · min</label><Input type="number" min={0} value={Math.round(draft.perChatCooldownMs / 60000)} onChange={(event) => patch({ perChatCooldownMs: Math.max(0, Number(event.target.value)) * 60000 })} className="mt-2 h-9 rounded-xl bg-input/60 font-mono" /></div>
          <div className="border-white/[0.05] p-4 sm:border-l"><label className="text-xs font-medium">Duplicate window · sec</label><Input type="number" min={0} value={Math.round(draft.dedupeWindowMs / 1000)} onChange={(event) => patch({ dedupeWindowMs: Math.max(0, Number(event.target.value)) * 1000 })} className="mt-2 h-9 rounded-xl bg-input/60 font-mono" /></div>
        </div>
      </section>

      <section className="panel p-4"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-accent" /><h2 className="text-sm font-semibold">Quiet hours</h2><Switch className="ml-auto" checked={draft.quietHours.enabled} onCheckedChange={(checked) => patch({ quietHours: { ...draft.quietHours, enabled: checked } })} /></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><div><label className="text-[11px] text-muted-foreground">Start</label><Input type="time" value={draft.quietHours.start} onChange={(event) => patch({ quietHours: { ...draft.quietHours, start: event.target.value } })} className="mt-1 h-9 rounded-xl bg-input/60" /></div><div><label className="text-[11px] text-muted-foreground">End</label><Input type="time" value={draft.quietHours.end} onChange={(event) => patch({ quietHours: { ...draft.quietHours, end: event.target.value } })} className="mt-1 h-9 rounded-xl bg-input/60" /></div><div><label className="text-[11px] text-muted-foreground">IANA time zone</label><Input value={draft.quietHours.timeZone} placeholder="UTC" onChange={(event) => patch({ quietHours: { ...draft.quietHours, timeZone: event.target.value } })} className="mt-1 h-9 rounded-xl bg-input/60 font-mono text-xs" /></div></div></section>

      <section className="panel p-4"><div className="flex items-center gap-2"><BellRing className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Redacted Telegram alerts</h2></div><p className="mt-1 text-[11px] text-muted-foreground">Receive connection, flood, risk and recovery alerts. Message content and diagnostics are never attached.</p><Input value={draft.alertChatId} placeholder="Alert chat ID or @username" onChange={(event) => patch({ alertChatId: event.target.value })} className="mt-3 h-10 rounded-xl bg-input/60 font-mono text-xs" /></section>

      <section className="panel p-4"><h2 className="text-sm font-semibold">Recipient allowlist</h2><p className="mt-1 text-[11px] text-muted-foreground">When populated, all other senders and chats are ignored. Enter one ID or username per line.</p><textarea value={draft.allowlist.join("\n")} onChange={(event) => patch({ allowlist: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} rows={5} className="mt-3 w-full resize-y rounded-xl border border-white/[0.06] bg-input/60 p-3 font-mono text-xs outline-none ring-offset-background focus:ring-1 focus:ring-primary" /></section>

      <section className="panel flex gap-3 border-destructive/20 bg-destructive/[0.04] p-4"><AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><p className="text-[13px] leading-relaxed text-muted-foreground">Telegram is strict about API automation. Use only consent-based conversations. ReplyFlow intentionally excludes scraping, cold outreach, account farming and destructive account operations.</p></section>
    </div>
  );
}
