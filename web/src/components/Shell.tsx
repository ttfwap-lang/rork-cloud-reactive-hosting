import { NavLink, Outlet } from "react-router-dom";
import { Activity, GitBranch, Link2, LogOut, ScrollText, SlidersHorizontal, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";
import { StatusStrip } from "@/components/StatusStrip";

const NAV = [
  { to: "/", label: "Overview", icon: Activity, end: true },
  { to: "/connection", label: "Connection", icon: Link2, end: false },
  { to: "/workflows", label: "Workflows", icon: GitBranch, end: false },
  { to: "/logs", label: "Logs", icon: ScrollText, end: false },
  { to: "/jobs", label: "Failed jobs", icon: RotateCcw, end: false },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal, end: false },
] as const;

export function Shell() {
  const { snapshot, signOut } = useEngine();
  const pending = snapshot?.jobs.filter((job) => job.status === "pending").length ?? 0;

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="hidden w-60 shrink-0 border-r border-white/[0.06] bg-sidebar/60 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">ReplyFlow</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">cloud</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary/12 text-foreground ring-1 ring-primary/25"
                    : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.to === "/jobs" && pending > 0 ? (
                <span className="rounded-full bg-destructive/20 px-1.5 py-0.5 font-mono text-[10px] text-destructive">
                  {pending}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={signOut}
          className="m-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Lock console
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <StatusStrip />
        <main className="flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-background/90 backdrop-blur-xl lg:hidden">
        <div className="grid grid-cols-6">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" />
              <span className="truncate px-0.5">{item.label.split(" ")[0]}</span>
              {item.to === "/jobs" && pending > 0 ? (
                <span className="absolute right-1/4 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
              ) : null}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
