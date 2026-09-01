package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.PayMethod

/**
 * The methods a recorded payment currently in [current] may be switched to.
 * Empty ⇒ hide the "change method" control. Mirrors `change_payment_method`'s
 * server guards: never `points`/`credit` on either side; a `CASH` source row is
 * owner/manager only (changing away from cash removes a drawer expectation).
 * `CREDIT` is not a real payment row, so it never reaches this.
 */
fun methodChangeTargets(current: PayMethod, canManage: Boolean): List<PayMethod> {
    if (current == PayMethod.POINTS || current == PayMethod.CREDIT) return emptyList()
    if (current == PayMethod.CASH && !canManage) return emptyList()
    return listOf(PayMethod.CASH, PayMethod.CARD, PayMethod.JUICE, PayMethod.BANK, PayMethod.CHEQUE)
        .filter { it != current }
}

/** Resolve a `payments.method` wire string to its [PayMethod]; null if unknown. */
fun payMethodOfWire(wire: String?): PayMethod? =
    PayMethod.entries.firstOrNull { it.rpcValue == wire }
