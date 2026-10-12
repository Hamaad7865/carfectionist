import { methodChangeTargets, type ChangeableMethod } from "@/features/jobs/change-method";

/**
 * Which corrections a row of the sales page's payments panel may offer — "Reverse this
 * payment" and "Change method". Pure and DB-free. It only keeps controls the RPCs are
 * going to refuse out of the way; the RPCs remain the rule.
 *
 * A credited invoice is the case nothing on the invoice itself gives away. The credit
 * note books the refund as NEGATIVE mirrors attached to the CREDIT NOTE
 * (create_and_issue_credit_note), so the invoice's own rows show no reversal: the
 * payment still stands, the bill still reads PAID — on purpose, the credit note is its
 * fiscal reversal. But the money has gone back: reverse_payment and
 * change_payment_method both answer "payment already reversed" (the mirror exists, on
 * the other document), every time — and change_payment_method refuses any payment on a
 * credited invoice besides.
 */

export interface PaymentControls {
  /** Offer "Reverse this payment". */
  reverse: boolean;
  /** What "Change method" may switch this payment to — empty hides the control. */
  methodTargets: ChangeableMethod[];
  /** The credit note that handed this payment back, when one did. */
  refundedBy: string | null;
}

export function paymentControls(
  p: { method: string; isReversal: boolean; wasReversed: boolean },
  opts: { creditedByNumber: string | null; canReverse: boolean; canChangeMethod: boolean },
): PaymentControls {
  // A mirror, or an original a mirror on this same bill already undid.
  const cancelled = p.isReversal || p.wasReversed;
  // The credit note mirrors every payment still standing when it is raised, and only
  // those — a pair cancelled beforehand was never money to hand back.
  const refundedBy = cancelled ? null : opts.creditedByNumber;
  const open = !cancelled && refundedBy == null;
  return {
    reverse: opts.canReverse && open,
    methodTargets:
      opts.canChangeMethod && open ? methodChangeTargets(p.method, { canManage: opts.canReverse }) : [],
    refundedBy,
  };
}
