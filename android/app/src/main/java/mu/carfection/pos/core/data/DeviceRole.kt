package mu.carfection.pos.core.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import mu.carfection.pos.ui.PosTab

/**
 * Does this tablet take money?
 *
 * Reception's tablet does not — it takes cars in, builds quotations, and sends them.
 * The owner marks it "Quotation only" in Points of Sale; `register_device` returns the
 * flag on login and on every heartbeat, so a switch flipped on the web reaches the
 * tablet within minutes without a re-login.
 *
 * Unknown means TRUE. A real till that has never reached the server, or is offline on
 * first launch, must still be able to sell — so the fallback fails toward selling, not
 * toward a dead counter.
 */
fun takesPaymentsOf(row: JsonObject?): Boolean =
    runCatching { row?.get("takes_payments")?.jsonPrimitive?.booleanOrNull }.getOrNull() ?: true

/** The nav rail. A device that cannot take money has no business showing Checkout. */
fun visibleTabs(takesPayments: Boolean): List<PosTab> =
    if (takesPayments) PosTab.entries.toList() else PosTab.entries.filter { it != PosTab.SALE }

/** Where the app opens, and where a sign-out returns to. */
fun landingTab(takesPayments: Boolean): PosTab =
    if (takesPayments) PosTab.SALE else PosTab.INTAKE

/**
 * The role can change under a running app (the owner flips the switch; the heartbeat
 * brings it back). Move the operator off a tab that just disappeared — and only then.
 */
fun tabAfterRoleChange(current: PosTab, takesPayments: Boolean): PosTab =
    if (!takesPayments && current == PosTab.SALE) PosTab.INTAKE else current
