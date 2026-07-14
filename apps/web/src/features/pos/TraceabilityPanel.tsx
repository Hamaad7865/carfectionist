import Link from "next/link";
import {
  BadgePercent,
  Ban,
  Banknote,
  CalendarCheck,
  CircleDot,
  Coins,
  Download,
  FileDown,
  Power,
  ReceiptText,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { formatMUR } from "@/lib/money";
import { muToday } from "@/lib/mu-date";

import {
  buildTraceCategoryHref,
  filterTraceEvents,
  groupTraceEventsByMauritiusDay,
  summarizeTraceEvents,
  type TraceCategory,
  type TraceEvent,
  type TraceFilter,
  type TraceQueryParams,
  type TraceState,
  type TraceStatus,
  type TraceTone,
} from "./traceability";

export interface TraceabilityPanelProps {
  events: readonly TraceEvent[];
  traceState: TraceState;
  activeCategory: TraceFilter;
  currentQuery: TraceQueryParams;
}

const FILTERS: ReadonlyArray<{ value: TraceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "payments", label: "Payments" },
  { value: "till", label: "Till" },
  { value: "receipts", label: "Receipts" },
  { value: "system", label: "System" },
  { value: "exceptions", label: "Exceptions" },
];

const KIND_ICON: Readonly<Record<string, LucideIcon>> = {
  terminal_started: Power,
  version_changed: Download,
  operator_signed_in: UserRound,
  device_enabled: Power,
  device_disabled: Ban,
  cash_out: Banknote,
  receipt_printed: ReceiptText,
  receipt_skipped: ReceiptText,
  receipt_emailed: ReceiptText,
  document_sent: ReceiptText,
  data_export: FileDown,
  till_opened: Wallet,
  till_closed: CalendarCheck,
  payment_received: Coins,
  payment_reversed: Coins,
  discount_applied: BadgePercent,
};

const TONE_CLASSES: Readonly<Record<TraceTone, string>> = {
  payment: "bg-[rgba(13,167,124,0.12)] text-mint",
  till: "bg-[rgba(245,166,35,0.16)] text-amber-ink",
  receipt: "bg-[rgba(43,140,255,0.12)] text-link",
  system: "bg-[rgba(15,23,32,0.05)] text-faint",
  warning: "bg-[rgba(214,59,80,0.1)] text-rose",
};

const CATEGORY_LABELS: Readonly<Record<TraceCategory, string>> = {
  payments: "Payments",
  till: "Till",
  receipts: "Receipts",
  system: "System",
};

const STATUS_LABELS: Readonly<
  Record<Exclude<TraceStatus, null>, string>
> = {
  reversed: "Reversed",
  receipt_skipped: "Receipt skipped",
  variance: "Variance",
  disabled: "Disabled",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function dayHeading(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(date) ||
    month < 1 ||
    month > 12 ||
    date < 1 ||
    date > 31
  ) {
    return day;
  }

  const calendarDay = new Date(Date.UTC(year, month - 1, date));
  const prefix = day === muToday()
    ? "Today"
    : WEEKDAYS[calendarDay.getUTCDay()];
  return `${prefix} · ${date} ${MONTHS[month - 1]}`;
}

function statusOrCategory(event: TraceEvent): string {
  return event.status === null
    ? CATEGORY_LABELS[event.category]
    : STATUS_LABELS[event.status];
}

interface EventField {
  key: string;
  label: string;
  value: string;
  numeric?: boolean;
}

function metadataUsesNumericFont(label: string, value: string): boolean {
  return (
    /^Rs -?[\d,]+\.\d{2}$/.test(value) ||
    /^-?[\d,.]+%$/.test(value) ||
    /^(?:app version|previous version|new version|session id|from|to)$/i.test(
      label,
    )
  );
}

function eventFields(event: TraceEvent): EventField[] {
  const fields: EventField[] = [];
  if (event.actorName !== null) {
    fields.push({ key: "actor", label: "Actor", value: event.actorName });
  }
  if (event.method !== null) {
    fields.push({ key: "method", label: "Method", value: event.method });
  }
  if (event.reference !== null) {
    fields.push({
      key: "reference",
      label: "Reference",
      value: event.reference,
      numeric: true,
    });
  }
  if (event.reason !== null) {
    fields.push({ key: "reason", label: "Reason", value: event.reason });
  }
  for (const [index, metadata] of event.metadata.entries()) {
    fields.push({
      key: `metadata:${index}:${metadata.label}`,
      label: metadata.label,
      value: metadata.value,
      numeric: metadataUsesNumericFont(metadata.label, metadata.value),
    });
  }
  return fields;
}

function TraceEventCard({ event }: { event: TraceEvent }) {
  const Icon = KIND_ICON[event.kind] ?? CircleDot;
  const fields = eventFields(event);
  const cardTone = event.tone === "warning"
    ? "border-[rgba(214,59,80,0.28)] bg-[rgba(214,59,80,0.035)]"
    : "border-line bg-card";
  const cardClass = `flex min-h-11 min-w-0 flex-col gap-3 rounded-[14px] border px-4 py-3 sm:flex-row sm:items-start ${cardTone}`;
  const linkedCardClass = `${cardClass} transition-colors hover:border-line-2 hover:bg-sub focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`;

  const content = (
    <>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${TONE_CLASSES[event.tone]}`}
        >
          <Icon aria-hidden="true" size={16} strokeWidth={2.1} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="break-words text-[13px] font-semibold text-ink">
              {event.title}
            </h4>
            <span
              className={`inline-flex min-h-5 items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${TONE_CLASSES[event.tone]}`}
            >
              {statusOrCategory(event)}
            </span>
          </div>

          {event.summary !== null && (
            <p className="mt-1 break-words text-[12px] text-muted">
              {event.summary}
            </p>
          )}

          {fields.length > 0 && (
            <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {fields.map((field) => (
                <div
                  key={field.key}
                  className="min-w-0 text-[10.5px] font-semibold text-faint"
                >
                  <dt>{field.label}</dt>
                  <dd
                    className={`${field.numeric ? "num " : ""}mt-0.5 break-words text-[12px] font-medium text-body`}
                  >
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-baseline justify-between gap-3 pl-12 sm:flex-col sm:items-end sm:pl-0">
        {event.amountCents !== null && (
          <span
            className={`num shrink-0 text-[13px] font-bold ${event.tone === "warning" ? "text-rose" : "text-ink"}`}
          >
            {formatMUR(event.amountCents)}
          </span>
        )}
        <time
          dateTime={event.at}
          className="num shrink-0 whitespace-nowrap text-[11px] text-faint"
        >
          {event.atLabel}
        </time>
      </div>
    </>
  );

  return event.href !== null ? (
    <Link href={event.href} className={linkedCardClass}>
      {content}
    </Link>
  ) : (
    <article className={cardClass}>{content}</article>
  );
}

function PanelIntroduction({ range }: { range: TraceState["range"] }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-2xl text-[12.5px] text-muted">
        Everything this device did in the selected period — operators, tills,
        payments, discounts, receipts, and corrections.
      </p>
      <DateRangeFilter label={false} displayRange={range} />
    </div>
  );
}

export function TraceabilityPanel({
  events,
  traceState,
  activeCategory,
  currentQuery,
}: TraceabilityPanelProps) {
  if (traceState.status === "unavailable") {
    return (
      <div className="min-w-0 max-w-4xl space-y-4">
        <PanelIntroduction range={traceState.range} />
        <div
          role="alert"
          className="rounded-[14px] border border-[rgba(245,166,35,0.38)] bg-[rgba(245,166,35,0.08)] p-5"
        >
          <h3 className="font-display text-[15px] font-bold text-ink-strong">
            Audit trail unavailable
          </h3>
          <p className="mt-1 text-[12.5px] text-amber-ink">
            The audit trail could not be loaded. Refresh the page to retry.
          </p>
        </div>
      </div>
    );
  }

  const summary = summarizeTraceEvents(events);
  const visibleEvents = filterTraceEvents(events, activeCategory);
  const groups = groupTraceEventsByMauritiusDay(visibleEvents);
  const summaryItems = [
    { label: "Events", value: String(summary.events) },
    { label: "Net payments", value: formatMUR(summary.netPaymentsCents) },
    { label: "Receipts", value: String(summary.receipts) },
    { label: "Exceptions", value: String(summary.exceptions) },
  ] as const;

  return (
    <div className="min-w-0 max-w-4xl space-y-4">
      <PanelIntroduction range={traceState.range} />

      <div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="min-w-0 rounded-[13px] border border-line bg-card p-3 text-[11px] font-semibold text-muted"
            >
              <dt>{item.label}</dt>
              <dd className="num mt-1 break-words text-[19px] font-extrabold text-ink-strong">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
        {traceState.capped && (
          <p className="mt-1.5 text-right text-[10.5px] font-semibold text-faint">
            Based on the 150 events shown
          </p>
        )}
      </div>

      <nav
        aria-label="Traceability category filters"
        className="flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {FILTERS.map((filter) => {
          const active = filter.value === activeCategory;
          return (
            <Link
              key={filter.value}
              href={buildTraceCategoryHref(currentQuery, filter.value)}
              className={`inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 text-[12px] font-semibold ${active ? "border border-link bg-[rgba(43,140,255,0.12)] text-link" : "border border-line-2 bg-card text-muted hover:text-body"}`}
              aria-current={active ? "page" : undefined}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {events.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line-2 p-10 text-center text-[13px] text-faint">
          No events were recorded in the selected period.
        </div>
      ) : visibleEvents.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line-2 p-10 text-center text-[13px] text-faint">
          {traceState.capped
            ? "No loaded events match this filter. Narrow the date range to search beyond the 150 events shown."
            : "No events match the selected category."}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => {
            const headingId = `trace-day-${group.date}`;
            return (
              <section key={group.date} aria-labelledby={headingId}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3
                    id={headingId}
                    className="font-display text-[14px] font-bold text-ink-strong"
                  >
                    {dayHeading(group.date)}
                  </h3>
                  <span className="num text-[10.5px] font-semibold text-faint">
                    {group.events.length} {group.events.length === 1 ? "event" : "events"}
                  </span>
                </div>
                <ol className="mt-2 space-y-2">
                  {group.events.map((event) => (
                    <li key={event.key} className="min-w-0">
                      <TraceEventCard event={event} />
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}

      {traceState.capped && (
        <footer className="rounded-[12px] border border-line bg-band px-4 py-3 text-center text-[11.5px] text-th">
          Only the 150 most recent events in the selected period are loaded.
          Filters apply only to these loaded events. Narrow the date range to
          search further.
        </footer>
      )}
    </div>
  );
}
