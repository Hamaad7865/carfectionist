import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface OpenTill {
  id: string;
  deviceId: string;
  openingFloatCents: number;
  openedAt: string;
  cashCollectedCents: number;
  expectedCents: number;
}
export interface ClosedTill {
  id: string;
  deviceId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloatCents: number;
  countedCents: number;
  expectedCents: number;
  varianceCents: number;
}

export async function getCashSessions(): Promise<{ open: OpenTill | null; recent: ClosedTill[] }> {
  const sb = await createClient();
  const { data: sessions } = await sb.from("cash_sessions").select("*").order("opened_at", { ascending: false }).limit(20);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (sessions ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openRow = rows.find((s) => s.status === "open");

  let open: OpenTill | null = null;
  if (openRow) {
    const [{ data: pays }, movesRes] = await Promise.all([
      sb.from("payments").select("amount").eq("cash_session_id", openRow.id).eq("method", "cash"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.from("till_movements" as any) as any).select("amount").eq("cash_session_id", openRow.id),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cash = ((pays ?? []) as any[]).reduce((s, p) => s + rupeesToCents(Number(p.amount)), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const moves = ((movesRes.data ?? []) as any[]).reduce((s, m) => s + rupeesToCents(Number(m.amount)), 0);
    const floatCents = rupeesToCents(Number(openRow.opening_float));
    open = {
      id: openRow.id,
      deviceId: openRow.device_id,
      openingFloatCents: floatCents,
      openedAt: openRow.opened_at,
      cashCollectedCents: cash,
      // Drawer truth: float + cash payments + petty movements (negative).
      expectedCents: floatCents + cash + moves,
    };
  }

  const recent: ClosedTill[] = rows
    .filter((s) => s.status === "closed")
    .map((s) => ({
      id: s.id,
      deviceId: s.device_id,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      openingFloatCents: rupeesToCents(Number(s.opening_float)),
      countedCents: rupeesToCents(Number(s.closing_count ?? 0)),
      expectedCents: rupeesToCents(Number(s.expected_cash ?? 0)),
      varianceCents: rupeesToCents(Number(s.variance ?? 0)),
    }));

  return { open, recent };
}
