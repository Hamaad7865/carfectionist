"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CarFront, FileText, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { SearchHit } from "@/app/api/search/route";

const ICON = { invoice: FileText, customer: UserRound, vehicle: CarFront } as const;
const GROUP: Record<SearchHit["type"], string> = { invoice: "Documents", customer: "Customers", vehicle: "Cars" };

/** ⌘K / Ctrl+K anywhere: documents, customers and cars, via the same /api/search the
 *  Carfectionist topbar uses (RLS-scoped). The server already filtered, so cmdk doesn't. */
export function TyreCommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results for a too-short query
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (res.ok) setHits(((await res.json()) as { hits?: SearchHit[] }).hits ?? []);
      } catch {
        /* aborted or offline — keep the last answer */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  const groups = (["invoice", "customer", "vehicle"] as const)
    .map((type) => ({ type, items: hits.filter((h) => h.type === type) }))
    .filter((g) => g.items.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ("");
      }}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription>Find a document, customer or car</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden rounded-[20px] p-0 sm:max-w-[560px]" showCloseButton={false}>
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-tc-fainter">
          <CommandInput value={q} onValueChange={setQ} placeholder="Search invoices, customers or a plate…" className="h-12 text-[14px]" />
          <CommandList className="max-h-[360px]">
            {q.trim().length >= 2 && !loading && <CommandEmpty>Nothing matches “{q.trim()}”.</CommandEmpty>}
            {groups.map((g) => (
              <CommandGroup key={g.type} heading={GROUP[g.type]}>
                {g.items.map((h) => {
                  const Icon = ICON[h.type];
                  return (
                    <CommandItem
                      key={`${h.type}-${h.id}`}
                      value={`${h.type}-${h.id}`}
                      onSelect={() => {
                        onOpenChange(false);
                        setQ("");
                        router.push(h.href);
                      }}
                      className="gap-3 rounded-[10px] py-2.5"
                    >
                      <Icon className="size-4 text-tc-muted" />
                      <span className="text-[13.5px] font-semibold text-tc-ink">{h.label}</span>
                      <span className="ml-auto truncate text-[12px] text-tc-muted">{h.sub}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
