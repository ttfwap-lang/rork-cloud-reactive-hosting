import { NavLink, Outlet } from "react-router-dom";
import { Activity, Crown, GitBranch, ImagePlus, Link2, LogOut, RotateCcw, ScrollText, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import { StatusStrip } from "@/components/StatusStrip";
import { SourceOffer } from "@/components/SourceOffer";

const NAV = [
  { to: "/", label: "Overview", icon: Activity, end: true, ownerOnly: false },
  { to: "/connection", label: "Connection", icon: Link2, end: false, ownerOnly: false },
  { to: "/workflows", label: "Workflows", icon: GitBranch, end: false, ownerOnly: false },
  { to: "/import", label: "AI Import", icon: ImagePlus, end: false, ownerOnly: false },
  { to: "/logs", label: "Logs", icon: ScrollText, end: false, ownerOnly: false },
  { to: "/jobs", label: "Failed jobs", icon: RotateCcw, end: false, ownerOnly: false },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal, end: false, ownerOnly: false },
  { to: "/owner", label: "Owner", icon: Crown, end: false, ownerOnly: true },
] as const;

export function Shell() {
  const { snapshot, signOut, account, isOwner } = useEngine();
  const pending = snapshot?.jobs.filter((job) => job.status === "pending").length ?? 0;
  const items = NAV.filter((item) => !item.ownerOnly || isOwner);
  const allowance = account?.allowance;

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="hidden w-60 shrink-0 border-r border-white/[0.06] bg-sidebar/60 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">ReplyFlow</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">cloud control</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                isActive ? "bg-primary/12 text-foreground ring-1 ring-primary/25" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.to === "/jobs" && pending > 0 ? (
                <span className="rounded-full bg-destructive/20 px-1.5 py-0.5 font-mono text-[10px] text-destructive">{pending}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="m-3 space-y-2 rounded-xl bg-secondary/40 p-3">
          <div className="flex items-center gap-2.5">
            <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold uppercase", isOwner ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary")}>
              {(account?.username ?? "?").slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-semibold">{account?.username ?? "—"}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{isOwner ? "owner" : "member"}</p>
            </div>
          </div>
          {allowance ? (
            <div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>AI imports</span>
                <span className="font-mono tabular-nums">{allowance.used}/{allowance.limit}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-background/60">
                <div
                  className={cn("h-full rounded-full transition-all duration-500", allowance.remaining === 0 ? "bg-destructive" : "bg-primary")}
                  style={{ width: `${Math.min(100, (allowance.used / Math.max(1, allowance.limit)) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <StatusStrip />
        <main className="flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10"><Outlet /></main>
        <div className="hidden lg:block"><SourceOffer /></div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 overflow-x-auto border-t border-white/[0.06] bg-background/90 backdrop-blur-xl lg:hidden">
        <div className="flex min-w-max">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                "relative flex w-[72px] flex-col items-center gap-1 py-2.5 text-[9px] transition-colors",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
              {item.to === "/jobs" && pending > 0 ? (
                <span className="absolute right-3 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
              ) : null}
            </NavLink>
          ))}
          <button onClick={signOut} className="flex w-[72px] flex-col items-center gap-1 py-2.5 text-[9px] text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
