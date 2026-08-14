import * as rpc from "./rpc";

/** The back office is its own till — Cashmag calls it a device, and cash rung here is real cash. */
export const BACK_OFFICE_DEVICE = "back-office";

/**
 * The till a payment taken IN THE BACK OFFICE belongs to.
 *
 * This used to be `.eq("status","open").limit(1)` with no device filter: with a tablet till
 * open in the shop, a cash payment taken at the desk was attributed to a RANDOM till, and
 * corrupted that till's cash-up as well as this one's. A payment belongs to the drawer it was
 * actually put in.
 *
 * Cash cannot be taken with no till at all (record_payment refuses it — that is how cash used
 * to disappear from the cash-up), so if the desk has no open till we open one. It starts with
 * a float of 0.00: nothing was counted into it.
 *
 * Resolved server-side (back_office_till RPC) so the desk till is always on TODAY. Reusing the
 * open back-office session in JS meant a session opened once stayed open for ever and, from the
 * next morning, tripped the stale-till guard on every desk invoice ("close that service on the
 * till, then open a new one") — a close the virtual desk till has no UI for. The RPC rolls a
 * stale session forward for us; "today" is the DB's Mauritius calendar, never the browser's.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function backOfficeTillId(sb: any): Promise<string> {
  const sess = await rpc.backOfficeTill(sb);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sess as any).id as string;
}
