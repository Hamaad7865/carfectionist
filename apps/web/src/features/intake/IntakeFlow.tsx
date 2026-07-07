"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, ArrowRight, Check } from "lucide-react";
import type { IntakeCustomer } from "@/lib/supabase/queries/intake";
import { CarDiagram } from "./CarDiagram";
import { PhotoUploader, type IntakePhoto } from "./PhotoUploader";
import { MARKER_TYPES, type Marker, type MarkerType } from "./damage";
import { createIntakeQuoteAction } from "./actions";

const field = "h-10 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";
const lbl = "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-faint";

export function IntakeFlow({ tenantId, customers }: { tenantId: string; customers: IntakeCustomer[] }) {
  const router = useRouter();
  const [custMode, setCustMode] = useState<"pick" | "new">("pick");
  const [custQuery, setCustQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [vehNew, setVehNew] = useState(false);
  const [newPlate, setNewPlate] = useState("");
  const [newMake, setNewMake] = useState("");

  const [service, setService] = useState("");
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [activeType, setActiveType] = useState<MarkerType>("scratch");
  const [photos, setPhotos] = useState<IntakePhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = customers.find((c) => c.id === customerId) ?? null;
  const custMatches = useMemo(() => {
    const s = custQuery.trim().toLowerCase();
    return s && !customerId
      ? customers.filter((c) => c.name.toLowerCase().includes(s) || (c.phone ?? "").includes(s)).slice(0, 6)
      : [];
  }, [custQuery, customerId, customers]);

  function pickCustomer(c: IntakeCustomer) {
    setCustomerId(c.id);
    setCustQuery(c.name);
    setVehicleId(c.vehicles.length === 1 ? c.vehicles[0].id : null);
    setVehNew(c.vehicles.length === 0);
  }
  function resetCustomer() {
    setCustomerId(null); setCustQuery(""); setVehicleId(null); setVehNew(false);
  }

  const hasCustomer = custMode === "new" ? newCustName.trim().length > 1 : !!customerId;
  const hasVehicle = vehNew || custMode === "new" ? newPlate.trim().length >= 4 : !!vehicleId;
  const canStart = hasCustomer && hasVehicle && !busy;

  async function start() {
    setError(null);
    if (!canStart) return;
    setBusy(true);
    const r = await createIntakeQuoteAction({
      customerId: custMode === "pick" ? customerId ?? undefined : undefined,
      newCustomerName: custMode === "new" ? newCustName : undefined,
      newCustomerPhone: custMode === "new" ? newCustPhone : undefined,
      vehicleId: !vehNew && custMode === "pick" ? vehicleId ?? undefined : undefined,
      newVehiclePlate: vehNew || custMode === "new" ? newPlate : undefined,
      newVehicleMake: vehNew || custMode === "new" ? newMake : undefined,
      service: service.trim() || undefined,
      markers,
      photos: photos.map((p) => ({ path: p.path })),
    });
    if (r.ok && r.data) router.push(`/sales/${r.data.id}/edit`);
    else { setBusy(false); setError(r.ok ? "Could not start the quotation." : r.error); }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)]">
      {/* left: customer + vehicle */}
      <div className="flex flex-col gap-4">
        {/* customer */}
        <div className="rounded-[15px] border border-line bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className={lbl + " mb-0"}>Customer</span>
            <button
              onClick={() => { setCustMode(custMode === "pick" ? "new" : "pick"); resetCustomer(); }}
              className="text-[12px] font-bold text-link hover:underline"
            >
              {custMode === "pick" ? "+ New customer" : "Pick existing"}
            </button>
          </div>
          {custMode === "pick" ? (
            selected ? (
              <div className="flex items-center gap-3 rounded-[11px] border border-link bg-[rgba(43,140,255,0.06)] px-3 py-2.5">
                <span className="flex-1">
                  <span className="block text-[14px] font-bold text-ink">{selected.name}</span>
                  <span className="num text-[12px] text-muted">{selected.phone ?? "—"} · {selected.vehicles.length} vehicle{selected.vehicles.length === 1 ? "" : "s"}</span>
                </span>
                <button onClick={resetCustomer} className="text-[12px] font-semibold text-muted hover:text-body">Change</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                  <input className={`${field} pl-9`} placeholder="Search name or phone…" value={custQuery} onChange={(e) => setCustQuery(e.target.value)} autoFocus />
                </div>
                {custMatches.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {custMatches.map((c) => (
                      <button key={c.id} onClick={() => pickCustomer(c)} className="flex items-center justify-between rounded-[9px] border border-line bg-sub px-3 py-2 text-left hover:border-brand">
                        <span className="text-[13px] font-semibold text-body">{c.name}</span>
                        <span className="num text-[11px] text-faint">{c.vehicles.map((v) => v.plate).join(", ") || "no vehicle"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input className={field} placeholder="Full name" value={newCustName} onChange={(e) => setNewCustName(e.target.value)} autoFocus />
              <input className={field} placeholder="Mobile" value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} inputMode="tel" />
            </div>
          )}
        </div>

        {/* vehicle */}
        <div className={`rounded-[15px] border border-line bg-card p-4 ${hasCustomer ? "" : "pointer-events-none opacity-45"}`}>
          <div className="mb-2 flex items-center justify-between">
            <span className={lbl + " mb-0"}>Vehicle</span>
            {custMode === "pick" && (selected?.vehicles.length ?? 0) > 0 && (
              <button onClick={() => { setVehNew(!vehNew); setVehicleId(null); }} className="text-[12px] font-bold text-link hover:underline">
                {vehNew ? "Pick existing" : "+ Add vehicle"}
              </button>
            )}
          </div>
          {custMode === "pick" && !vehNew && (selected?.vehicles.length ?? 0) > 0 ? (
            <div className="flex flex-col gap-1.5">
              {selected!.vehicles.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVehicleId(v.id)}
                  className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left ${vehicleId === v.id ? "border-link bg-[rgba(43,140,255,0.08)]" : "border-line bg-sub hover:border-brand"}`}
                >
                  <span className="rounded-[5px] bg-[#F0C542] px-1.5 py-0.5 num text-[11px] font-bold text-[#151208]">{v.plate}</span>
                  <span className="text-[13px] font-semibold text-body">{v.label}</span>
                  {vehicleId === v.id && <Check size={14} className="ml-auto text-link" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input className={`${field} num uppercase`} placeholder="Plate — 2087 JL 25" value={newPlate} onChange={(e) => setNewPlate(e.target.value.toUpperCase())} />
              <input className={field} placeholder="Make / model" value={newMake} onChange={(e) => setNewMake(e.target.value)} />
            </div>
          )}
        </div>

        {/* service */}
        <div className="rounded-[15px] border border-line bg-card p-4">
          <span className={lbl}>Service requested</span>
          <input className={field} placeholder="e.g. Full decontamination & body polish" value={service} onChange={(e) => setService(e.target.value)} />
        </div>
      </div>

      {/* right: condition & damage + photos */}
      <div className="rounded-[15px] border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className={lbl + " mb-0"}>Condition &amp; Damage</span>
          <span className="rounded-full bg-sub px-2.5 py-1 text-[11.5px] font-semibold text-muted">
            {markers.length ? `${markers.length} marked` : "No damage marked"}
          </span>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {MARKER_TYPES.map((t) => (
            <button
              key={t.type}
              onClick={() => setActiveType(t.type)}
              className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold ${activeType === t.type ? "border-[1.5px] border-ink/40 bg-sub text-ink" : "border-[1.5px] border-line-2 text-body"}`}
            >
              <span className="size-2.5 rounded-full" style={{ background: t.color }} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <CarDiagram
              markers={markers}
              editable
              activeType={activeType}
              onAdd={(x, y) => setMarkers((m) => [...m, { x, y, type: activeType }])}
              onRemove={(i) => setMarkers((m) => m.filter((_, j) => j !== i))}
              maxWidth={260}
            />
            <p className="mt-2 text-center text-[11.5px] leading-snug text-faint">
              Tap the diagram to mark pre-existing damage.<br />Tap a marker to remove it.
            </p>
          </div>
          <div className="sm:w-[200px]">
            <PhotoUploader tenantId={tenantId} folder="intake" photos={photos} label="Before photos" onAdd={(p) => setPhotos((ps) => [...ps, p])} onRemove={(i) => setPhotos((ps) => ps.filter((_, j) => j !== i))} />
          </div>
        </div>
      </div>

      {/* action bar */}
      <div className="lg:col-span-2">
        {error && <p className="mb-2 rounded-[10px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[13px] text-rose">{error}</p>}
        <div className="flex items-center justify-between gap-4 rounded-[15px] border border-line bg-card px-5 py-3">
          <span className="text-[12.5px] text-muted">
            {[hasCustomer && (custMode === "new" ? newCustName : selected?.name), markers.length ? `${markers.length} damage mark${markers.length === 1 ? "" : "s"}` : null, photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : null]
              .filter(Boolean)
              .join("  ·  ") || "Find or create the customer to begin"}
          </span>
          <button onClick={start} disabled={!canStart} className="grad-brand shadow-brand inline-flex h-12 items-center gap-2 rounded-[13px] px-7 text-[15px] font-extrabold text-white disabled:opacity-50">
            {busy ? "Starting…" : <>Start quotation <ArrowRight size={17} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
