"use client";

import { useMemo, useState } from "react";
import { CarFront, UserRound, UserX } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { SaleCustomer, SaleVehicle } from "@/lib/supabase/queries/tyrecentre-sale";

export interface PickedCustomer {
  customer: SaleCustomer | null;
  vehicle: SaleVehicle | null;
  /** A walk-in typed by name, not on file. */
  walkInName?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
export const carLabel = (v: SaleVehicle) => [v.make, v.model].filter(Boolean).join(" ");

/** Who the sale is for: a customer and one of their cars, found by name, phone or plate. */
export function CustomerPicker({
  open,
  onOpenChange,
  customers,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customers: SaleCustomer[];
  onPick: (p: PickedCustomer) => void;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const sn = norm(q);
    const out: { key: string; customer: SaleCustomer; vehicle: SaleVehicle | null }[] = [];
    for (const c of customers) {
      const nameHit = !s || c.name.toLowerCase().includes(s) || (c.phone ?? "").replace(/\s/g, "").includes(sn);
      if (c.vehicles.length === 0) {
        if (nameHit) out.push({ key: c.id, customer: c, vehicle: null });
      } else {
        for (const v of c.vehicles) {
          if (nameHit || norm(v.plate).includes(sn)) out.push({ key: `${c.id}:${v.id}`, customer: c, vehicle: v });
        }
      }
      if (out.length >= 60) break;
    }
    return out;
  }, [customers, q]);

  const close = () => {
    onOpenChange(false);
    setQ("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="overflow-hidden rounded-[20px] p-0 sm:max-w-[520px]" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Who is this sale for?</DialogTitle>
          <DialogDescription>Search by name, phone or plate</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Name, phone or plate…" className="h-12 text-[14px]" />
          <CommandList className="max-h-[380px]">
            <CommandEmpty>No customer or car matches.</CommandEmpty>
            <CommandGroup heading="Customers & cars">
              {rows.map((r) => (
                <CommandItem
                  key={r.key}
                  value={r.key}
                  onSelect={() => {
                    onPick({ customer: r.customer, vehicle: r.vehicle });
                    close();
                  }}
                  className="gap-3 rounded-[10px] py-2.5"
                >
                  {r.vehicle ? <CarFront className="size-4 text-tc-muted" /> : <UserRound className="size-4 text-tc-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-tc-ink">{r.customer.name}</span>
                    {r.vehicle && (
                      <span className="block truncate font-mono text-[11px] uppercase text-tc-muted">
                        {r.vehicle.plate}
                        {carLabel(r.vehicle) ? ` · ${carLabel(r.vehicle)}` : ""}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="No customer on file">
              {q.trim() && (
                <CommandItem
                  value="walk-in-named"
                  onSelect={() => {
                    onPick({ customer: null, vehicle: null, walkInName: q.trim() });
                    close();
                  }}
                  className="gap-3 rounded-[10px] py-2.5"
                >
                  <UserRound className="size-4 text-tc-muted" />
                  <span className="text-[13.5px] text-tc-ink">
                    Walk-in named “<b>{q.trim()}</b>”
                  </span>
                </CommandItem>
              )}
              <CommandItem
                value="walk-in"
                onSelect={() => {
                  onPick({ customer: null, vehicle: null });
                  close();
                }}
                className="gap-3 rounded-[10px] py-2.5"
              >
                <UserX className="size-4 text-tc-muted" />
                <span className="text-[13.5px] text-tc-ink">Walk-in customer</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
