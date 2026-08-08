import type { ReactNode } from "react";
import { AlertOctagon } from "lucide-react";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useEngine } from "@/lib/engine-store";

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-white/[0.05] px-4 py-4 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { snapshot, saveSettings } = useEngine();
  const settings = snapshot?.settings;
  if (!settings) return null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pacing keeps your account looking human. Leave these on.
        </p>
      </header>

      <section className="panel overflow-hidden">
        <Row title="Global kill switch" hint="Halts every outgoing reply instantly, everywhere.">
          <Switch
            checked={settings.killSwitch}
            onCheckedChange={(checked) => saveSettings({ killSwitch: checked })}
          />
        </Row>
        <Row title="Auto-pause on slow-down" hint="Pause and auto-resume when Telegram asks us to wait.">
          <Switch
            checked={settings.autoPauseOnFlood}
            onCheckedChange={(checked) => saveSettings({ autoPauseOnFlood: checked })}
          />
        </Row>
      </section>

      <section className="panel overflow-hidden">
        <div className="px-4 pb-1 pt-4">
          <p className="text-sm font-medium">Minimum gap between sends</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Currently {(settings.minGapMs / 1000).toFixed(1)}s
          </p>
          <Slider
            value={[settings.minGapMs]}
            min={0}
            max={30_000}
            step={500}
            className="my-4"
            onValueChange={(next) => saveSettings({ minGapMs: next[0] ?? 0 })}
          />
        </div>

        <div className="border-t border-white/[0.05] px-4 pb-1 pt-4">
          <p className="text-sm font-medium">Per-minute cap</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Max {settings.perMinuteCap} replies each minute
          </p>
          <Slider
            value={[settings.perMinuteCap]}
            min={1}
            max={60}
            step={1}
            className="my-4"
            onValueChange={(next) => saveSettings({ perMinuteCap: next[0] ?? 1 })}
          />
        </div>

        <div className="border-t border-white/[0.05] px-4 pb-5 pt-4">
          <p className="text-sm font-medium">Duplicate window</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Identical messages inside {(settings.dedupeWindowMs / 1000).toFixed(0)}s never fire twice
          </p>
          <Slider
            value={[settings.dedupeWindowMs]}
            min={0}
            max={600_000}
            step={5_000}
            className="my-4"
            onValueChange={(next) => saveSettings({ dedupeWindowMs: next[0] ?? 0 })}
          />
        </div>
      </section>

      <section className="panel flex gap-3 border-destructive/20 bg-destructive/[0.04] p-4">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Telegram is strict about automation. Keep the pacing limits on, and only automate
          conversations you are allowed to automate.
        </p>
      </section>
    </div>
  );
}
