import { Scale } from "lucide-react";

const SOURCE_URL = "https://github.com/ttfwap-lang/rork-cloud-reactive-hosting";

/**
 * The always-on connector is built on MadelineProto, which is AGPL: offering the
 * service to other people over a network obliges us to offer the source too.
 * This link is that offer, and it has to stay reachable from every page.
 */
export function SourceOffer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? "px-4 py-5 text-center" : "border-t border-white/[0.06] px-4 py-6 text-center"}>
      <p className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-muted-foreground">
        <Scale className="h-3 w-3 shrink-0" />
        <span>ReplyFlow&apos;s Telegram connector is built on MadelineProto and covered by the AGPL.</span>
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Complete corresponding source
        </a>
        <span>· Automating a personal Telegram account can get it banned.</span>
      </p>
    </footer>
  );
}
