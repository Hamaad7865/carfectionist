package mu.carfection.pos.core.data

import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.money.computeTotals
import mu.carfection.pos.core.money.lineExclCents
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.pctOfCents
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.NewCustomerDto
import mu.carfection.pos.core.network.PosApi
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

enum class DiscountMode { PCT, AMT }

data class CartLine(
    val product: ProductEntity,
    val qty: Double,
    val discountMode: DiscountMode = DiscountMode.PCT,
    val discountPct: Int = 0, // PCT mode
    val discountAmtText: String = "", // AMT mode — raw input, parsed to cents
    val expanded: Boolean = false, // UI: line row opened for qty/discount editing
    val oversellOk: Boolean = false, // cashier confirmed selling past available stock (asked once per sale)
) {
    /** Ad-hoc (typed) lines carry a synthetic local id — they save with product_id = null. */
    val isAdhoc: Boolean get() = product.id.startsWith(ADHOC_PREFIX)

    /** Rs discount in cents, clamped to the line's gross so a line can never go negative. */
    val discountAmtCents: Long
        get() = (parseMoneyToCents(discountAmtText) ?: 0L).coerceIn(0L, lineExclCents(qty, product.sellingPriceCents))

    /** What this line nets to on the invoice (gross − its own discount), server-rounded. */
    val netCents: Long
        get() = when (discountMode) {
            DiscountMode.PCT -> lineExclCents(qty, product.sellingPriceCents, discountPct.toDouble())
            DiscountMode.AMT -> lineExclCents(qty, product.sellingPriceCents) - discountAmtCents
        }

    companion object { const val ADHOC_PREFIX = "adhoc:" }
}

/** One row of the document as it will be saved — shared by totals, receipt, and the draft JSON. */
data class SaleLineSpec(
    val productId: String?,
    val title: String,
    val qty: Double,
    val unitCents: Long, // negative for discount lines
    val discountPct: Double,
    val vatRatePct: Double,
)

/**
 * Expand the cart into the exact line set the invoice will carry. Rs discounts become explicit
 * negative "Discount" lines (schema-legal: unit_price has no lower bound, and the DB's generated
 * columns stay the rounding authority), so client display and server totals agree to the cent.
 * A basket discount is apportioned across the VAT rates present (largest-remainder, sums exactly)
 * so mixed-rate baskets keep their VAT split honest.
 */
fun expandSaleLines(
    cart: List<CartLine>,
    basketMode: DiscountMode = DiscountMode.PCT,
    basketPct: Int = 0,
    basketAmtCents: Long = 0,
): List<SaleLineSpec> {
    val specs = mutableListOf<SaleLineSpec>()
    cart.forEach { l ->
        val pid = if (l.isAdhoc) null else l.product.id
        when (l.discountMode) {
            DiscountMode.PCT -> specs += SaleLineSpec(pid, l.product.name, l.qty, l.product.sellingPriceCents, l.discountPct.toDouble(), l.product.vatRatePct)
            DiscountMode.AMT -> {
                specs += SaleLineSpec(pid, l.product.name, l.qty, l.product.sellingPriceCents, 0.0, l.product.vatRatePct)
                val amt = l.discountAmtCents
                if (amt > 0) specs += SaleLineSpec(null, "Discount — ${l.product.name.take(60)}", 1.0, -amt, 0.0, l.product.vatRatePct)
            }
        }
    }
    // Basket discount on the net-after-line-discounts subtotal.
    val interim = computeTotals(specs.map { LineInput(it.qty, it.unitCents, it.discountPct, it.vatRatePct) })
    val net = interim.subtotalCents
    if (net <= 0) return specs
    val basketAmt = when (basketMode) {
        DiscountMode.PCT -> pctOfCents(net, basketPct.coerceIn(0, 100))
        DiscountMode.AMT -> basketAmtCents.coerceIn(0, net)
    }
    if (basketAmt <= 0) return specs
    // Net per VAT rate (positive groups only), then largest-remainder apportionment.
    val groupNets = specs.indices.groupBy { specs[it].vatRatePct }
        .mapValues { (_, idxs) -> idxs.sumOf { interim.lines[it].exclCents } }
        .filterValues { it > 0 }
    val totalNet = groupNets.values.sum()
    val base = groupNets.mapValues { (_, g) -> basketAmt * g / totalNet }
    var leftover = basketAmt - base.values.sum()
    val byRemainder = groupNets.keys.sortedByDescending { (basketAmt * groupNets.getValue(it)) % totalNet }
    val title = if (basketMode == DiscountMode.PCT) "Basket discount ($basketPct%)" else "Basket discount"
    byRemainder.forEach { rate ->
        val amt = base.getValue(rate) + if (leftover > 0) { leftover--; 1L } else 0L
        if (amt > 0) specs += SaleLineSpec(null, title, 1.0, -amt, 0.0, rate)
    }
    return specs
}

enum class PayMethod(val rpcValue: String?, val label: String) {
    CASH("cash", "Cash"),
    CARD("card", "Card"),
    JUICE("juice", "Juice"),
    BANK("bank_transfer", "Bank"),
    CREDIT(null, "Credit"), // on-account: issue only, balance = receivable
}

data class SaleResult(
    val invoiceId: String,
    val number: String?,
    val totalCents: Long,
    val changeCents: Long,
    val onAccount: Boolean,
)

/**
 * A settle that already reached `issue_document`. The RPC may have committed before the call
 * failed — a lost response is indistinguishable from a lost request — so an invoice may exist
 * under this sale's idempotency key.
 *
 * Re-sending the IDENTICAL request is safe: the server replays it. Sending a DIFFERENT basket
 * under the same key is not — `issue_document` and `record_payment` both replay purely on
 * (tenant_id, key) and ignore their other arguments, so the customer would settle against the
 * stale document. The caller must freeze the basket until this resolves.
 */
sealed class SettleUncertain(cause: Throwable) : Exception(cause.message, cause)

/** `issue_document` failed. Whether the invoice exists is unknown. */
class SaleIssueUncertain(cause: Throwable) : SettleUncertain(cause)

/** The invoice was issued; `record_payment` failed. Retrying settles [invoiceId], idempotently. */
class SalePaymentUncertain(
    val invoiceId: String,
    val number: String?,
    cause: Throwable,
) : SettleUncertain(cause)

/**
 * The counter-sale write path: draft → issue → payment, all through the shared
 * idempotent RPCs. `saleKey` is minted once per sale and reused on retries, so
 * a flaky tap/network can never double-issue or double-charge (server replays
 * return the canonical stored result).
 *
 * That replay guarantee holds only while the request stays identical. Once a settle reaches
 * `issue_document` this throws [SettleUncertain] rather than a bare exception, so the caller
 * knows the basket is now pinned to whatever the server may hold under `saleKey`.
 */
@Singleton
class SaleRepository @Inject constructor(
    private val api: PosApi,
    private val catalog: CatalogRepository,
) {
    suspend fun completeSale(
        cart: List<CartLine>,
        method: PayMethod,
        tenderCents: Long?, // cash only
        externalRef: String?, // card/juice/bank
        customerId: String?, // required for CREDIT; optional otherwise
        walkInName: String?, // used when no customerId
        cashSessionId: String?, // open till (cash)
        saleKey: String,
        basketMode: DiscountMode = DiscountMode.PCT,
        basketPct: Int = 0,
        basketAmtCents: Long = 0,
    ): SaleResult {
        require(cart.isNotEmpty()) { "Add at least one product." }
        if (method == PayMethod.CREDIT) requireNotNull(customerId) { "Pick a customer for a credit sale." }

        // 1) Resolve the customer (invoices require one — same rule as the web).
        val custId = customerId ?: run {
            val name = walkInName?.trim().takeUnless { it.isNullOrEmpty() } ?: "Walk-in customer"
            api.findCustomerByName(name)?.id ?: run {
                val tenant = requireNotNull(catalog.tenantId()) { "Not synced yet — pull the catalogue first." }
                api.insertCustomer(NewCustomerDto(tenantId = tenant, name = name)).id
            }
        }

        // 2) Draft with the cart lines (rupee prices; the DB is the rounding authority).
        val doc = buildJsonObject {
            put("doc_type", "invoice")
            put("customer_id", custId)
            put("origin", "standalone")
        }
        val specs = expandSaleLines(cart, basketMode, basketPct, basketAmtCents)
        val lines = buildJsonArray {
            specs.forEachIndexed { i, sp ->
                add(buildJsonObject {
                    if (sp.productId == null) put("product_id", kotlinx.serialization.json.JsonNull) else put("product_id", sp.productId)
                    put("title", sp.title)
                    put("qty", sp.qty)
                    put("unit_price", centsToRupees(sp.unitCents))
                    put("discount_pct", sp.discountPct)
                    put("vat_rate", sp.vatRatePct)
                    put("sort_order", i)
                })
            }
        }
        // A draft costs nothing and carries no number: a failure here is safely retryable
        // with a different basket, so it propagates as an ordinary exception.
        val draft = api.saveDraft(doc, lines)

        // 3) Issue — draws the gapless INV number + fires stock movements. Point of no return.
        val issued = try {
            api.issueDocument(draft.id, "$saleKey:issue")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw SaleIssueUncertain(e)
        }
        val totalCents = rupeesToCents(issued.totalIncl) // server total is authoritative

        // 4) Payment (skipped for on-account credit).
        if (method == PayMethod.CREDIT) {
            return SaleResult(issued.id, issued.number, totalCents, 0, onAccount = true)
        }
        val tendered = if (method == PayMethod.CASH) (tenderCents ?: totalCents) else null
        try {
            api.recordPayment(
                invoiceId = issued.id,
                method = requireNotNull(method.rpcValue),
                amountRupees = centsToRupees(totalCents),
                tenderedRupees = tendered?.let { centsToRupees(it) },
                externalRef = if (method == PayMethod.CASH) null else (externalRef?.trim().takeUnless { it.isNullOrEmpty() } ?: "POS"),
                cashSessionId = if (method == PayMethod.CASH) cashSessionId else null,
                idempotencyKey = "$saleKey:pay",
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw SalePaymentUncertain(issued.id, issued.number, e)
        }
        val change = if (method == PayMethod.CASH && tendered != null) (tendered - totalCents).coerceAtLeast(0) else 0
        return SaleResult(issued.id, issued.number, totalCents, change, onAccount = false)
    }

    /**
     * Collect a payment on an EXISTING issued invoice (the "TO COLLECT" list) — no
     * new draft/issue, just record_payment against the open balance. Idempotent on
     * [payKey] so a flaky tap can't double-charge.
     */
    suspend fun collectOnInvoice(
        invoiceId: String,
        number: String?,
        amountCents: Long, // remaining balance
        method: PayMethod,
        tenderCents: Long?, // cash only
        externalRef: String?,
        cashSessionId: String?,
        payKey: String,
    ): SaleResult {
        require(method != PayMethod.CREDIT) { "Choose a payment method." }
        val tendered = if (method == PayMethod.CASH) (tenderCents ?: amountCents) else null
        api.recordPayment(
            invoiceId = invoiceId,
            method = requireNotNull(method.rpcValue),
            amountRupees = centsToRupees(amountCents),
            tenderedRupees = tendered?.let { centsToRupees(it) },
            externalRef = if (method == PayMethod.CASH) null else (externalRef?.trim().takeUnless { it.isNullOrEmpty() } ?: "POS"),
            cashSessionId = if (method == PayMethod.CASH) cashSessionId else null,
            idempotencyKey = "$payKey:collect",
        )
        val change = if (method == PayMethod.CASH && tendered != null) (tendered - amountCents).coerceAtLeast(0) else 0
        return SaleResult(invoiceId, number, amountCents, change, onAccount = false)
    }
}
