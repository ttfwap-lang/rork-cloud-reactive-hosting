import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import type { ReactNode } from "react";

import { SourceOffer } from "@/components/SourceOffer";

/**
 * The shared front door for signing in and creating an account: one full-bleed
 * atmospheric field with a single softly-lit panel floating on it, so both routes
 * read as two handles on the same door rather than two different pages.
 */
export function AuthBackdrop({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1100px_620px_at_18%_-15%,hsl(168_82%_44%/0.20),transparent_62%)]" />
        <div className="animate-aurora absolute inset-0 bg-[radial-gradient(760px_520px_at_88%_8%,hsl(187_88%_52%/0.16),transparent_58%)]" />
        <div className="animate-aurora absolute inset-0 bg-[radial-gradient(620px_620px_at_45%_115%,hsl(168_70%_34%/0.16),transparent_60%)] [animation-delay:-13s]" />
        <div className="grid-noise absolute inset-0 opacity-70" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_35%,hsl(176_42%_4%/0.75))]" />
      </div>

      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:py-14">
        <div className="w-full max-w-[26rem]">
          <Link to="/" className="mb-6 flex items-center gap-3">
            <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 ring-1 ring-primary/30">
              <Activity className="h-5 w-5 text-primary" />
              <span className="animate-signal absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
            </div>
            <div className="leading-tight">
              <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{caption}</p>
            </div>
          </Link>

          <div className="panel p-6 shadow-[0_40px_120px_-40px_hsl(168_82%_44%/0.25)] sm:p-7">{children}</div>
        </div>
      </div>

      <SourceOffer compact />
    </div>
  );
}
