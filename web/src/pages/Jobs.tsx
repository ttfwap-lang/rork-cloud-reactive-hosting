import { CheckCircle2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEngine } from "@/lib/engine-store";

export default function Jobs() {
  const { snapshot, retryJob } = useEngine();
  const jobs = snapshot?.jobs ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Failed jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Replies that could not be delivered are held here instead of being dropped.
        </p>
      </header>

      {jobs.length === 0 ? (
        <div className="panel px-4 py-14 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-3 text-sm font-medium">Queue is clean</p>
          <p className="mt-1 text-xs text-muted-foreground">Every reply has gone through.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {jobs.map((job, index) => (
            <div
              key={job.id}
              className="panel animate-row-in flex flex-wrap items-center gap-3 p-4"
              style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  job.status === "resolved" ? "bg-primary" : "bg-destructive",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{job.reason}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  chat:{job.chatKey} · {new Date(job.ts).toLocaleString()} · {job.attempts} attempt
                  {job.attempts === 1 ? "" : "s"}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 shrink-0 gap-1.5 rounded-full text-xs"
                disabled={job.status === "resolved"}
                onClick={() => retryJob(job.id)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {job.status === "resolved" ? "Replayed" : "Replay"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
