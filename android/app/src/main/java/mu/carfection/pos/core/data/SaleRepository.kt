package mu.carfection.pos.core.data

import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.NewCustomerDto
import mu.carfection.pos.core.network.PosApi
import javax.inject.Inject
import javax.inject.Singleton

data class CartLine(val product: ProductEntity, val qty: Double)

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
 * The counter-sale write path: draft → issue → payment, all through the shared
 * idempotent RPCs. `saleKey` is minted once per sale and reused on retries, so
 * a flaky tap/network can never double-issue or double-charge (server replays
 * return the canonical stored result).
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
        val lines = buildJsonArray {
            cart.forEachIndexed { i, l ->
                add(buildJsonObject {
                    put("product_id", l.product.id)
                    put("title", l.product.name)
                    put("qty", l.qty)
                    put("unit_price", centsToRupees(l.product.sellingPriceCents))
                    put("discount_pct", 0)
                    put("vat_rate", l.product.vatRatePct)
                    put("sort_order", i)
                })
            }
        }
        val draft = api.saveDraft(doc, lines)

        // 3) Issue — draws the gapless INV number + fires stock movements.
        val issued = api.issueDocument(draft.id, "$saleKey:issue")
        val totalCents = rupeesToCents(issued.totalIncl) // server total is authoritative

        // 4) Payment (skipped for on-account credit).
        if (method == PayMethod.CREDIT) {
            return SaleResult(issued.id, issued.number, totalCents, 0, onAccount = true)
        }
        val tendered = if (method == PayMethod.CASH) (tenderCents ?: totalCents) else null
        api.recordPayment(
            invoiceId = issued.id,
            method = requireNotNull(method.rpcValue),
            amountRupees = centsToRupees(totalCents),
            tenderedRupees = tendered?.let { centsToRupees(it) },
            externalRef = if (method == PayMethod.CASH) null else (externalRef?.trim().takeUnless { it.isNullOrEmpty() } ?: "POS"),
            cashSessionId = if (method == PayMethod.CASH) cashSessionId else null,
            idempotencyKey = "$saleKey:pay",
        )
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
