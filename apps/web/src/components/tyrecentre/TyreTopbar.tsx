"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CircleHelp, Keyboard, Map, Plus, Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { NotificationBell } from "@/components/ui/notification-bell";
import { ProductTour, type TourStep } from "@/components/ui/product-tour";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLiveNotifications } from "@/components/shell/Topbar";
import { breadcrumbTrail, NEW_SALE_HREF, type TcNav } from "@/lib/tyrecentre/nav";
import { SEARCH_GROUP, SEARCH_ICON, useSearchHits } from "./TyreCommandSearch";
import { TyreThemeMenu } from "./TyreThemeMenu";

/** Inline search in the bar: Easy UI's expandable pill, with live results under it. */
function BarSearch({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { hits, loading } = useSearchHits(q);
  const show = open && q.trim().length >= 2;

  const go = (href: string) => {
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
    router.push(href);
  };

  return (
    <div
      className="relative"
      data-tour="search"
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <ExpandableSearch
        inputRef={inputRef}
        placeholder="Invoice no., customer or plate…"
        collapsedWidth={190}
        expandedWidth={320}
        onSearch={(v) => {
          setQ(v);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && hits[active]) {
            e.preventDefault();
            go(hits[active].href);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {show && (
        <div
          role="listbox"
          aria-label="Search results"
          className="absolute right-0 top-11 z-50 w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-tc-line bg-tc-card p-1.5 shadow-[0_16px_40px_rgba(15,23,32,0.12)]"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-tc-faint">{loading ? "Searching…" : `Nothing matches “${q.trim()}”.`}</p>
          ) : (
            (["invoice", "customer", "vehicle"] as const).map((type) => {
              const group = hits.filter((h) => h.type === type);
              if (group.length === 0) return null;
              const Icon = SEARCH_ICON[type];
              return (
                <div key={type} className="py-1">
                  <div className="px-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-tc-fainter">{SEARCH_GROUP[type]}</div>
                  {group.map((h) => {
                    const i = hits.indexOf(h);
                    return (
                      <button
                        key={`${h.type}-${h.id}`}
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(h.href)}
                        className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left ${i === active ? "bg-tc-sub" : ""}`}
                      >
                        <Icon className="size-4 shrink-0 text-tc-muted" />
                        <span className="truncate text-[13px] font-semibold text-tc-ink">{h.label}</span>
                        <span className="ml-auto truncate text-[11.5px] text-tc-muted">{h.sub}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ["Ctrl", "K"], what: "Search invoices, customers and cars" },
  { keys: ["F2"], what: "Start a new sale" },
  { keys: ["/"], what: "Search the catalogue (on New sale)" },
  { keys: ["Ctrl", "B"], what: "Show or hide the menu" },
];

/** The tyre-centre top bar: breadcrumb, search, alerts, help and New sale. */
export function TyreTopbar({
  nav,
  shop,
  canSell,
  onOpenSearch,
}: {
  nav: TcNav;
  shop: string;
  canSell: boolean;
  /** The full ⌘K palette — on phones the bar shows an icon instead of the pill. */
  onOpenSearch: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const trail = useMemo(() => breadcrumbTrail(pathname, nav, shop), [pathname, nav, shop]);
  const { items, dismiss, dismissAll } = useLiveNotifications(pathname);
  const searchRef = useRef<HTMLInputElement>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourSteps, setTourSteps] = useState<TourStep[]>([]);
  const [keysOpen, setKeysOpen] = useState(false);
  const onNewSale = pathname.startsWith(NEW_SALE_HREF);

  const startTour = () => {
    const all: TourStep[] = [
      { title: `Welcome to ${shop || "the back office"}`, body: "A quick look around — it takes under a minute. Use the arrow keys or Next." },
      { target: '[data-tour="sidebar"]', title: "Your menu", body: "Everything lives here: sales, jobs, customers, stock and the till. Ctrl+B folds it away.", placement: "right" },
      { target: '[data-tour="search"]', title: "Find anything", body: "Type an invoice number, a customer's name or a plate. Ctrl+K opens the full search.", placement: "bottom" },
      { target: '[data-tour="new-sale"]', title: "Ring up a sale", body: "Tyres, parts and services in one cart. F2 gets you there from any screen.", placement: "bottom" },
      { target: '[data-tour="stats"]', title: "Your numbers", body: "The last 30 days against the 30 before. Hover a card to read any single day.", placement: "bottom" },
      { target: '[data-tour="notifications"]', title: "What needs you", body: "Unpaid invoices, low stock and new enquiries. Clear one once you've seen it.", placement: "bottom" },
      { target: '[data-tour="help"]', title: "Help is here", body: "Come back to this tour or the keyboard shortcuts any time.", placement: "bottom" },
    ];
    // Only the parts of the screen that are actually showing (the sidebar is a drawer on phones).
    setTourSteps(all.filter((s) => !s.target || (typeof s.target === "string" && document.querySelector(s.target)?.getClientRects().length)));
    setTourOpen(true);
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-tc-line bg-tc-app/85 px-3 backdrop-blur-md sm:px-5">
      <SidebarTrigger className="size-8 rounded-full text-tc-body hover:bg-tc-card sm:size-9" />
      <Separator orientation="vertical" className="mx-0.5 !h-5 bg-tc-line sm:mx-1" />
      <Breadcrumb items={trail} as={Link} separator="chevron" className="hidden min-w-0 text-[13px] sm:block" />
      <span className="truncate text-[14px] font-semibold text-tc-ink sm:hidden">{trail.at(-1)?.label}</span>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="hidden md:block">
          <BarSearch inputRef={searchRef} />
        </div>
        <button type="button" onClick={onOpenSearch} aria-label="Search" className="grid size-8 place-items-center rounded-full text-tc-body hover:bg-tc-card md:hidden">
          <Search className="size-[18px]" />
        </button>

        <span data-tour="notifications">
          <NotificationBell
            notifications={items.map((n) => ({
              id: n.key,
              message: n.label,
              timestamp: n.detail,
              read: false,
              action: () => {
                void dismiss(n.key);
                router.push(n.href);
              },
            }))}
            onMarkAsRead={(id) => void dismiss(id)}
            onMarkAllAsRead={() => void dismissAll()}
            className="[&>button]:rounded-full [&>button]:p-1.5 sm:[&>button]:p-2"
          />
        </span>

        <TyreThemeMenu />

        <DropdownMenu>
          <DropdownMenuTrigger
            data-tour="help"
            aria-label="Help"
            className="grid size-8 place-items-center rounded-full border border-tc-line-2 bg-tc-card text-tc-body hover:border-tc-dot hover:text-tc-ink sm:size-9"
          >
            <CircleHelp className="size-[18px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 rounded-[14px] p-1.5">
            <DropdownMenuLabel className="text-[12px] font-semibold text-tc-faint">Help</DropdownMenuLabel>
            <DropdownMenuItem onSelect={startTour} className="gap-2.5 rounded-[10px] py-2">
              <Map className="size-4" />
              <div>
                <div className="text-[13px] font-semibold text-tc-ink">Take the tour</div>
                <div className="text-[11.5px] text-tc-muted">A one-minute look around</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setKeysOpen(true)} className="gap-2.5 rounded-[10px] py-2">
              <Keyboard className="size-4" />
              <div>
                <div className="text-[13px] font-semibold text-tc-ink">Keyboard shortcuts</div>
                <div className="text-[11.5px] text-tc-muted">Work faster at the counter</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11px] text-tc-faint">{shop ? `${shop} · ` : ""}powered by HAZ Software</div>
          </DropdownMenuContent>
        </DropdownMenu>

        {canSell && !onNewSale && (
          <Link
            href={NEW_SALE_HREF}
            data-tour="new-sale"
            className="inline-flex size-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-tc-primary text-[13px] font-semibold text-tc-on-primary hover:opacity-95 sm:h-9 sm:w-auto sm:px-3.5"
          >
            <Plus className="size-4" strokeWidth={2.4} />
            <span className="hidden sm:inline">New sale</span>
          </Link>
        )}
      </div>

      <ProductTour steps={tourSteps} open={tourOpen} onClose={() => setTourOpen(false)} />

      <Dialog open={keysOpen} onOpenChange={setKeysOpen}>
        <DialogContent className="rounded-[22px] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>On a Mac, use ⌘ instead of Ctrl.</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col">
            {SHORTCUTS.map((s) => (
              <li key={s.what} className="flex items-center justify-between gap-4 border-b border-tc-line py-2.5 last:border-0">
                <span className="text-[13.5px] text-tc-body">{s.what}</span>
                <span className="flex gap-1">
                  {s.keys.map((k) => (
                    <Kbd key={k} className="font-mono">
                      {k}
                    </Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </header>
  );
}
