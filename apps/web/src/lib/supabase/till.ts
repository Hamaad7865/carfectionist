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
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function backOfficeTillId(sb: any): Promise<string> {
  const { data } = await sb
    .from("cash_sessions")
    .select("id")
    .eq("device_id", BACK_OFFICE_DEVICE)
    .eq("status", "open")
    .maybeSingle();
  if (data?.id) return data.id as string;

  const opened = await rpc.openCashSession(sb, BACK_OFFICE_DEVICE, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (opened as any).id as string;
}
