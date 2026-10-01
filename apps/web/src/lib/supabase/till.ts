import * as rpc from "./rpc";

/** The back office is its own till — Cashmag calls it a device, and cash rung here is real cash. */
export const BACK_OFFICE_DEVICE = "back-office";

/**
 * The till a payment taken IN THE BACK OFFICE belongs to.
 *
 * One drawer: the desk joins the terminal's open till (or vice versa) — the
 * server's back_office_till RPC returns today's open session whoever opened it,
 * and refuses to open a parallel one. Cash cannot be taken with no till at all
 * (record_payment refuses it — that is how cash used to disappear from the
 * cash-up), so if the drawer is closed we open one. It starts with a float of
 * 0.00: nothing was counted into it.
 *
 * Resolved server-side (back_office_till RPC) so the desk till is always on TODAY.
 * A stale session (an earlier day still open) is refused, not rolled forward:
 * yesterday's drawer must be counted and closed on the terminal first, otherwise
 * one physical drawer would span two sessions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function backOfficeTillId(sb: any): Promise<string> {
  const sess = await rpc.backOfficeTill(sb);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sess as any).id as string;
}
