package mu.carfection.pos.core.data

import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.AllowanceLineInput
import mu.carfection.pos.core.money.DiscountPolicy
import mu.carfection.pos.core.money.DocLineIn
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.money.computeTotals
import mu.carfection.pos.core.money.grossCents
import mu.carfection.pos.core.money.lineAllowanceCents
import mu.carfection.pos.core.money.lineExclCents
import mu.carfection.pos.core.money.netFromGrossCents
import mu.carfection.pos.core.money.netWithinGross
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.pctOfCents
import mu.carfection.pos.core.money.policyOf
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.NewCustomerDto
import mu.carfection.pos.core.network.PosApi
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

enum class DiscountMode { PCT, AMT }

/**
 * The customer an unnamed counter sale is billed to. One spelling, shared: the offline
 * path resolves it against the cached customer list, and a mismatch there would mint a
 * duplicate "Walk-in" customer on every outage instead of reusing the real one.
 */
const val WALK_IN_CUSTOMER = "Walk-in customer"

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

    /** The line before its own discount, in the ledger's net cents. */
    val lineExclCents: Long get() = lineExclCents(qty, product.sellingPriceCents)

    /** The same line at the shelf price the cashier and the customer see. */
    val lineGrossCents: Long get() = grossCents(lineExclCents, product.vatRatePct)

    /**
     * 'none' | 'carwash' | 'free' — the most this line may be discounted, from the product's
     * own discount_policy (an ad-hoc line's synthetic product carries kind="adhoc", which
     * — like a real service — is neither 'product' nor 'consumable', so [policyOf] withholds
     * a discount the same way it would for a service with no stated kind at all).
     */
    val discountPolicy: DiscountPolicy
        get() = policyOf(product.discountPolicy, product.kind)

    /**
     * Rs discount in cents as TYPED — i.e. VAT-inclusive, what comes off the bill, matching the
     * basket discount and the web's order discount. Clamped to the line's gross, so a line can
     * never go negative — and, on a carwash line, to [lineAllowanceCents], so a typed figure can
     * never ask for more than the owner's 5% rule permits.
     */
    val discountAmtCents: Long
        get() {
            val typed = (parseMoneyToCents(discountAmtText) ?: 0L).coerceIn(0L, lineGrossCents)
            if (discountPolicy != "carwash") return typed
            val cap = lineAllowanceCents(AllowanceLineInput(qty, product.sellingPriceCents, product.vatRatePct, discountPolicy))
            return typed.coerceAtMost(cap)
        }

    /** This line as one document row: [DocLineIn] is the DB's own line-discount arithmetic. */
    val docLine: DocLineIn
        get() = DocLineIn(
            qty = qty,
            unitCents = product.sellingPriceCents,
            discountKind = if (discountMode == DiscountMode.AMT) "amount" else "percent",
            discountPct = discountPct.toDouble(),
            discountAmtInclCents = if (discountMode == DiscountMode.AMT) discountAmtCents else 0L,
            vatRatePct = product.vatRatePct,
        )

    /** This line as the allowance module wants it — the same fields [docLine] assembles. */
    val allowanceInput: AllowanceLineInput
        get() = AllowanceLineInput(
            qty = qty,
            unitCents = product.sellingPriceCents,
            vatRatePct = product.vatRatePct,
            policy = discountPolicy,
            discountKind = if (discountMode == DiscountMode.AMT) "amount" else "percent",
            discountPct = discountPct.toDouble(),
            discountAmountCents = if (discountMode == DiscountMode.AMT) discountAmtCents else 0L,
        )

    companion object { const val ADHOC_PREFIX = "adhoc:" }
}

/**
 * One row of the document as it will be saved — shared by totals, receipt, and the draft JSON.
 * Every price here is POSITIVE: see [expandSaleLines].
 */
data class SaleLineSpec(
    val productId: String?,
    val title: String,
    val qty: Double,
    val unitCents: Long,
    val discountPct: Double,
    val vatRatePct: Double,
    val discountKind: String = "percent",
    val discountAmountInclCents: Long = 0, // VAT-INCLUSIVE, exactly as the cashier typed it
)

/**
 * The cart as one saveable draft: the rows, plus the basket discount carried on the DOCUMENT.
 * [orderDiscountValue] is a percentage for "percent" and RUPEES for "amount".
 *
 * [discountReason] rides along so an offline capture can replay it: app.assert_discount_allowed
 * re-checks the reason at issue time exactly as it did when the cashier typed it, and a sale
 * captured with a reason on file must not lose it just because the network was down.
 */
data class SaleDraft(
    val specs: List<SaleLineSpec>,
    val orderDiscountKind: String?,
    val orderDiscountValue: Double,
    val discountReason: String? = null,
)

/**
 * Expand the cart into the draft the invoice will carry.
 *
 * Discounts ride the DB's OWN columns — document_lines.discount_kind/discount_amount for a line,
 * documents.discount_kind/discount_value for the basket — never synthesised negative rows. The
 * previous scheme emitted a negative "Discount" line on the claim that "unit_price has no lower
 * bound"; that stopped being true on 2026-07-15, when 20260715000010_audit_fixes.sql added
 * document_lines_unit_price_nonneg CHECK (unit_price >= 0). Since then the DB has REJECTED every
 * discounted sale the counter tried to save, and no negative row has ever reached the table.
 *
 * Riding the real columns also ends the arithmetic drift: app.discounted_vat_groups is now the one
 * authority for what a discount takes off, so the tablet, the web counter and the quote builder
 * agree to the cent instead of each apportioning its own way.
 */
fun expandSaleLines(
    cart: List<CartLine>,
    basketMode: DiscountMode = DiscountMode.PCT,
    basketPct: Int = 0,
    basketAmtCents: Long = 0,
    discountReason: String? = null,
): SaleDraft {
    val specs = cart.map { l ->
        SaleLineSpec(
            productId = if (l.isAdhoc) null else l.product.id,
            title = l.product.name,
            qty = l.qty,
            unitCents = l.product.sellingPriceCents,
            discountPct = if (l.discountMode == DiscountMode.PCT) l.discountPct.toDouble() else 0.0,
            vatRatePct = l.product.vatRatePct,
            discountKind = if (l.discountMode == DiscountMode.AMT) "amount" else "percent",
            // The typed figure goes over as-is: the DB divides it by (1 + rate/100) itself and
            // clamps the line at zero, so there is no client-side conversion left to round wrong.
            discountAmountInclCents = if (l.discountMode == DiscountMode.AMT) l.discountAmtCents else 0L,
        )
    }
    // The basket discount is a DOCUMENT-level figure. The DB clamps it to the bill (least(v, gross)),
    // so "make it free" lands exactly on zero without a client clamp of its own.
    val kind = when {
        basketMode == DiscountMode.PCT && basketPct > 0 -> "percent"
        basketMode == DiscountMode.AMT && basketAmtCents > 0 -> "amount"
        else -> null
    }
    val value = when (kind) {
        "percent" -> basketPct.coerceIn(0, 100).toDouble()
        "amount" -> centsToRupees(basketAmtCents)
        else -> 0.0
    }
    return SaleDraft(specs, kind, value, discountReason?.trim()?.takeUnless { it.isEmpty() })
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
    // Set only when this result is a COLLECT on an existing invoice (a deposit / part or
    // full payment). Lets the done panel reverse just this payment instead of credit-noting
    // the whole live invoice (audit #6). Null for a walk-in sale.
    val paymentId: String? = null,
    // A COLLECT's undo must never void the job's fiscal invoice — an on-account collect
    // walks the HANDOVER back (undo_on_account) and a paid collect reverses the payment.
    val fromCollect: Boolean = false,
    // Who owes the money — the BILL's customer on a collect. The walk-in cart's customer
    // text is unrelated state and used to mislabel the done panel ("owed by Walk-in").
    val debtor: String? = null,
    // A SPLIT records several payments — their ids, so the done panel's undo reverses each
    // one (a collect) rather than trying to reverse a single fake "split" id.
    val paymentIds: List<String> = emptyList(),
    // Set when the sale was rung with NO network: the device reference the customer's slip
    // carries until the sale reaches the server and is given a real number. While this is
    // set there is nothing on the server to void, reverse or credit-note — the sale exists
    // only on this tablet.
    val offlineRef: String? = null,
)

/**
 * One line of a SPLIT payment — a single method applied for a specific amount against the
 * bill (e.g. Rs 500 Juice + Rs 500 Cash on a Rs 1,000 invoice). Each tender becomes one
 * record_payment call; the last one closes the invoice and, if it carries a job, delivers it.
 */
data class Tender(
    val method: PayMethod,
    val amountCents: Long,           // applied to the invoice
    val tenderedCents: Long? = null, // cash only; >= amount, change = tendered - amount
    val ref: String? = null,         // card / juice / bank reference
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

/**
 * Rejections that are DEFINITIVE: the server refused before anything costing money
 * committed. These must surface as plain errors — freezing the basket behind a false
 * "couldn't confirm the sale reached the server" left the cashier retrying a request
 * the server would deterministically refuse forever.
 */
private val DETERMINISTIC_ISSUE_REJECTIONS = listOf(
    "the day is closed",                    // app.assert_day_open
    "closed — reopen it",                   // day gate, dated variant
    "still on the day of",                  // app.assert_till_day_current — till left open since yesterday
    "unknown or closed cash session",       // the till went stale mid-sale
    "must be taken on an open till",        // till gate
    "no stock location",
    "cannot issue a document with no lines",
    "an invoice requires a customer",
    "insufficient privileges",
    // app.assert_discount_allowed (20260810000040/50) — the tablet's own discount clamp is
    // meant to stop these before a sale is ever queued (see Allowance.kt and the discount
    // guards in QuoteScreen/CounterScreen), so reaching the server at all here means the
    // policy changed, or a price drifted, between the till and this replay. Either way,
    // retrying identically will never succeed — the cashier has to ring it again.
    "discount exceeds allowance",
    "a reason is required for a carwash discount",
)

internal fun isDeterministicRejection(e: Throwable): Boolean {
    val m = e.message ?: return false
    return DETERMINISTIC_ISSUE_REJECTIONS.any { m.contains(it, ignoreCase = true) }
}

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
    companion object {
        /**
         * The deterministic draft/invoice id a counter sale will be issued under, derived
         * from its [saleKey] — the SAME formula [issueWalkInInvoice] uses, factored out so
         * an "Ask the owner" override taken out before the draft is ever saved still names
         * the exact document issue_document will later produce. No I/O, pure function of
         * the key, safe to call from a ViewModel with no repository instance at hand.
         */
        fun draftIdFor(saleKey: String): String =
            UUID.nameUUIDFromBytes("carfection:draft:$saleKey".toByteArray()).toString()
    }

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
        comment: String? = null, // internal note; stored on the invoice, never on the receipt
        // Why — required once the discount reaches into a carwash allowance. See Allowance.kt;
        // the tablet clamps and blocks Record payment before this is ever missing, but it still
        // has to travel to save_draft as discount_reason so issue_document's own check agrees.
        discountReason: String? = null,
        // The retry path: a previous attempt already ISSUED this sale's invoice (the
        // pendingSettle held its id). Skip draft+issue — re-issuing was impossible anyway
        // (each retry minted a new draft, and the idempotency guard rightly refused it,
        // trapping the cashier in a frozen basket) — and settle THAT invoice directly.
        knownInvoiceId: String? = null,
    ): SaleResult {
        if (knownInvoiceId != null) {
            return settleIssued(knownInvoiceId, method, tenderCents, externalRef, cashSessionId, saleKey)
        }
        if (method == PayMethod.CREDIT) requireNotNull(customerId) { "Pick a customer for a credit sale." }

        val issued = issueWalkInInvoice(
            expandSaleLines(cart, basketMode, basketPct, basketAmtCents, discountReason),
            customerId, null, walkInName, cashSessionId, saleKey, comment,
        )
        val totalCents = issued.totalCents

        // Payment (skipped for on-account credit).
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
                cashSessionId = cashSessionId,
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

    /** id/number/total of a freshly-issued (or retry-fetched) walk-in invoice. */
    private data class IssuedInvoice(val id: String, val number: String?, val totalCents: Long)

    /**
     * A customer the cashier typed while the tablet was offline, so the cache could not be
     * asked and the server could not be told. The id is minted on the tablet: inserting it
     * at replay is replay-safe, because a second attempt collides with the row the first
     * one wrote (primary key) rather than creating a twin.
     */
    data class NewOfflineCustomer(val id: String, val name: String)

    /**
     * Draft → issue a walk-in invoice from an already-expanded draft (no payment yet).
     * Extracted so single, split and OFFLINE-REPLAY settle paths share ONE issue path —
     * same deterministic draft id, same issue idempotency, same "cannot edit an issued
     * document" replay. The server total is authoritative (its rounding wins).
     *
     * It takes the [SaleDraft] rather than the cart because a replayed sale no longer has
     * a cart: it has the prices the customer actually paid, frozen when they paid them.
     */
    private suspend fun issueWalkInInvoice(
        draft: SaleDraft,
        customerId: String?,
        newCustomer: NewOfflineCustomer?,
        walkInName: String?,
        cashSessionId: String?,
        saleKey: String,
        comment: String?,
    ): IssuedInvoice {
        require(draft.specs.isNotEmpty()) { "Add at least one product." }

        // 1) Resolve the customer (invoices require one — same rule as the web).
        val custId = newCustomer?.let { pending ->
            val tenant = requireNotNull(catalog.tenantId()) { "Not synced yet — pull the catalogue first." }
            try {
                api.insertCustomerWithId(pending.id, tenant, pending.name)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Its own id can only collide with ITSELF — a previous replay that landed.
                if (!isDuplicateKey(e)) throw e
            }
            pending.id
        } ?: customerId ?: run {
            val name = walkInName?.trim().takeUnless { it.isNullOrEmpty() } ?: WALK_IN_CUSTOMER
            api.findCustomerByName(name)?.id ?: run {
                val tenant = requireNotNull(catalog.tenantId()) { "Not synced yet — pull the catalogue first." }
                api.insertCustomer(NewCustomerDto(tenantId = tenant, name = name)).id
            }
        }

        // 2) Draft with the cart lines (rupee prices; the DB is the rounding authority).
        // The draft id is DETERMINISTIC per sale: a retry re-locks the SAME draft row
        // (save_draft upserts by id), so failed attempts litter no orphan drafts and the
        // issue replay's same-document check lines up instead of refusing forever.
        val draftId = draftIdFor(saleKey)
        val draftSale = draft
        val draftDiscountKind = draftSale.orderDiscountKind
        val draftDiscountValue = draftSale.orderDiscountValue
        val doc = buildJsonObject {
            put("id", draftId)
            put("doc_type", "invoice")
            put("customer_id", custId)
            put("origin", "standalone")
            comment?.trim()?.takeIf { it.isNotEmpty() }?.let { put("comment", it) }
            // ALWAYS sent, JsonNull included. The counter reuses one deterministic draft id per
            // sale, and save_draft's UPDATE branch keeps the stored discount when the key is
            // absent — so omitting it after the cashier CLEARED a discount would silently
            // re-apply the one they just removed.
            if (draftDiscountKind == null) put("discount_kind", kotlinx.serialization.json.JsonNull)
            else put("discount_kind", draftDiscountKind)
            put("discount_value", draftDiscountValue)
            // Same "always sent" rule as discount_kind above, and for the same reason: a
            // cashier who typed a reason and then cleared it must actually clear it, not
            // have save_draft's absent-key branch quietly keep the old one.
            val reason = draftSale.discountReason?.trim()
            if (reason.isNullOrEmpty()) put("discount_reason", kotlinx.serialization.json.JsonNull)
            else put("discount_reason", reason)
        }
        val lines = buildJsonArray {
            draftSale.specs.forEachIndexed { i, sp ->
                add(buildJsonObject {
                    if (sp.productId == null) put("product_id", kotlinx.serialization.json.JsonNull) else put("product_id", sp.productId)
                    put("title", sp.title)
                    put("qty", sp.qty)
                    put("unit_price", centsToRupees(sp.unitCents))
                    put("discount_pct", sp.discountPct)
                    put("discount_kind", sp.discountKind)
                    put("discount_amount", centsToRupees(sp.discountAmountInclCents))
                    put("vat_rate", sp.vatRatePct)
                    put("sort_order", i)
                })
            }
        }
        // A draft costs nothing and carries no number: a failure here is safely retryable
        // with a different basket, so it propagates as an ordinary exception. One special
        // case: "cannot edit an issued document" means a PREVIOUS attempt already issued
        // this very draft and only the response was lost — fall through to the issue
        // replay, which returns that same document under "$saleKey:issue".
        val draft = try {
            api.saveDraft(doc, lines)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e.message?.contains("cannot edit an issued document") == true) null else throw e
        }

        // 3) Issue — draws the gapless INV number + fires stock movements. Point of no return.
        // Counter sales move the Shop's on-hand (walk-in front), never the Warehouse default.
        // Resolved before the point of no return, so a failed lookup is safely retryable.
        val shopLocationId = api.fetchShopLocationId()
        val issued = try {
            // The till that rang it — this is what puts the sale under its service on the
            // cash-up. Same session the payment is booked to, so money and ticket agree.
            api.issueDocument(draft?.id ?: draftId, "$saleKey:issue", shopLocationId, cashSessionId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // A definitive refusal (day closed, stale till, …) committed nothing costing
            // money — surface it plainly so the basket stays live and editable.
            if (isDeterministicRejection(e)) throw e
            throw SaleIssueUncertain(e)
        }
        return IssuedInvoice(issued.id, issued.number, rupeesToCents(issued.totalIncl)) // server total is authoritative
    }

    /**
     * A SPLIT walk-in sale: issue the invoice once, then record each tender (Juice, Cash, …)
     * against it. The last tender closes the bill. Retry-safe: a lost response after issue
     * freezes the basket (SalePaymentUncertain), and re-running with the same tenders replays
     * the issue and each per-index payment key idempotently, recording only what didn't land.
     */
    suspend fun completeSaleSplit(
        cart: List<CartLine>,
        tenders: List<Tender>,
        customerId: String?,
        walkInName: String?,
        cashSessionId: String?,
        saleKey: String,
        basketMode: DiscountMode = DiscountMode.PCT,
        basketPct: Int = 0,
        basketAmtCents: Long = 0,
        comment: String? = null,
        discountReason: String? = null,
        knownInvoiceId: String? = null,
    ): SaleResult {
        val issued = if (knownInvoiceId != null) {
            val inv = try { api.fetchInvoice(knownInvoiceId) } catch (e: CancellationException) { throw e } catch (e: Exception) { throw SalePaymentUncertain(knownInvoiceId, null, e) }
                ?: throw SalePaymentUncertain(knownInvoiceId, null, IllegalStateException("invoice not found"))
            IssuedInvoice(inv.id, inv.number, rupeesToCents(inv.totalIncl))
        } else {
            issueWalkInInvoice(
                expandSaleLines(cart, basketMode, basketPct, basketAmtCents, discountReason),
                customerId, null, walkInName, cashSessionId, saleKey, comment,
            )
        }
        return recordTenders(issued.id, issued.number, targetCents = issued.totalCents, tenders, cashSessionId, saleKey)
    }

    /**
     * Settle a sale that was rung OFFLINE and is only now reaching the server.
     *
     * Deliberately the same road as a live split sale: same draft id derived from the same
     * [saleKey], same `$saleKey:issue` and `$saleKey:pay:i` keys. That is what makes a
     * replay safe to attempt any number of times — the server either applies it once or
     * hands back what it already applied. The only difference from a live sale is WHEN the
     * fiscal number is minted: now, rather than at the counter.
     *
     * [targetCents] is the total the tablet computed and PRINTED for the customer. It is
     * passed so the last tender absorbs any cent of drift against the server's own
     * arithmetic — the customer already paid the printed figure, so the invoice must land
     * exactly settled rather than a cent short and stuck in `partly_paid`.
     */
    suspend fun settleCapturedSale(
        draft: SaleDraft,
        tenders: List<Tender>,
        customerId: String?,
        newCustomer: NewOfflineCustomer?,
        walkInName: String?,
        cashSessionId: String?,
        saleKey: String,
        comment: String?,
    ): SaleResult {
        val issued = issueWalkInInvoice(draft, customerId, newCustomer, walkInName, cashSessionId, saleKey, comment)
        return recordTenders(issued.id, issued.number, targetCents = issued.totalCents, tenders, cashSessionId, saleKey)
    }

    /** A replayed insert of a client-minted id collides with itself: that is success, not failure. */
    private fun isDuplicateKey(e: Throwable): Boolean {
        val m = e.message ?: return false
        return m.contains("23505") || m.contains("duplicate key", ignoreCase = true)
    }

    /**
     * Collect an EXISTING invoice's outstanding across several methods (split), or a partial
     * of it (a deposit spread over methods). The bill's balance is already server-authoritative
     * (dueCents came from the fetched invoice), and a partial is deliberate — so NO rounding
     * adjustment: record exactly the tenders entered.
     */
    suspend fun collectSplit(
        invoiceId: String,
        number: String?,
        tenders: List<Tender>,
        cashSessionId: String?,
        saleKey: String,
    ): SaleResult = recordTenders(invoiceId, number, targetCents = null, tenders, cashSessionId, saleKey)

    /**
     * Record a list of tenders against one invoice. When [targetCents] is given (a walk-in, whose
     * client cart total can drift from the server invoice total by a rounding cent), the LAST
     * tender is nudged by the delta so the invoice lands exactly paid — never a cent short
     * (which would leave it partly_paid and undelivered). Idempotent per tender index.
     */
    private suspend fun recordTenders(
        invoiceId: String,
        number: String?,
        targetCents: Long?,
        tenders: List<Tender>,
        cashSessionId: String?,
        saleKey: String,
    ): SaleResult {
        require(tenders.isNotEmpty()) { "No payment entered." }
        // Close to the penny against the SERVER total (walk-in only): adjust the last tender.
        // Only apply a delta that keeps the last tender positive — a wild delta (client vs
        // server totals wildly out of step) would be a bug elsewhere, not something to paper
        // over by zeroing or negating a tender.
        val rawDelta = if (targetCents == null) 0L else targetCents - tenders.sumOf { it.amountCents }
        val delta = if (rawDelta != 0L && tenders.last().amountCents + rawDelta > 0L) rawDelta else 0L
        val adjusted = if (delta == 0L) tenders else tenders.toMutableList().also {
            val last = it.last()
            it[it.lastIndex] = last.copy(
                amountCents = last.amountCents + delta,
                tenderedCents = last.tenderedCents?.let { t -> (t + delta).coerceAtLeast(last.amountCents + delta) },
            )
        }
        var change = 0L
        val ids = mutableListOf<String>()
        adjusted.forEachIndexed { i, t ->
            try {
                val pay = api.recordPayment(
                    invoiceId = invoiceId,
                    method = requireNotNull(t.method.rpcValue),
                    amountRupees = centsToRupees(t.amountCents),
                    tenderedRupees = t.tenderedCents?.let { centsToRupees(it) },
                    externalRef = if (t.method == PayMethod.CASH) null else (t.ref?.trim().takeUnless { it.isNullOrEmpty() } ?: "POS"),
                    cashSessionId = cashSessionId,
                    idempotencyKey = "$saleKey:pay:$i",
                )
                ids += pay.id
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // A definitive refusal (stale till, day closed, …) committed nothing —
                // surface it plainly; only a LOST response earns the uncertain-retry flow.
                if (isDeterministicRejection(e)) throw e
                throw SalePaymentUncertain(invoiceId, number, e)
            }
            if (t.method == PayMethod.CASH && t.tenderedCents != null) change += (t.tenderedCents - t.amountCents).coerceAtLeast(0)
        }
        return SaleResult(invoiceId, number, adjusted.sumOf { it.amountCents }, change, onAccount = false, paymentIds = ids)
    }

    /**
     * The tail of a sale whose invoice ALREADY exists (a retry after the payment call
     * failed). Fetches the invoice for the authoritative figures, then either recognises
     * it as already settled (the "failed" payment had in fact committed — the lost
     * response was the only casualty) or records the outstanding balance under the same
     * "$saleKey:pay" key, which replays safely.
     */
    private suspend fun settleIssued(
        invoiceId: String,
        method: PayMethod,
        tenderCents: Long?,
        externalRef: String?,
        cashSessionId: String?,
        saleKey: String,
    ): SaleResult {
        val inv = try {
            api.fetchInvoice(invoiceId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw SalePaymentUncertain(invoiceId, null, e)
        } ?: throw SalePaymentUncertain(invoiceId, null, IllegalStateException("invoice not found"))

        val totalCents = rupeesToCents(inv.totalIncl)
        if (method == PayMethod.CREDIT) return SaleResult(invoiceId, inv.number, totalCents, 0, onAccount = true)
        val outstandingCents = (totalCents - rupeesToCents(inv.amountPaid)).coerceAtLeast(0)
        val tendered = if (method == PayMethod.CASH) (tenderCents ?: outstandingCents) else null
        if (outstandingCents == 0L) {
            val change = if (tendered != null) (tendered - totalCents).coerceAtLeast(0) else 0
            return SaleResult(invoiceId, inv.number, totalCents, change, onAccount = false)
        }
        try {
            api.recordPayment(
                invoiceId = invoiceId,
                method = requireNotNull(method.rpcValue),
                amountRupees = centsToRupees(outstandingCents),
                tenderedRupees = tendered?.let { centsToRupees(it) },
                externalRef = if (method == PayMethod.CASH) null else (externalRef?.trim().takeUnless { it.isNullOrEmpty() } ?: "POS"),
                cashSessionId = cashSessionId,
                idempotencyKey = "$saleKey:pay",
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw SalePaymentUncertain(invoiceId, inv.number, e)
        }
        val change = if (method == PayMethod.CASH && tendered != null) (tendered - outstandingCents).coerceAtLeast(0) else 0
        return SaleResult(invoiceId, inv.number, totalCents, change, onAccount = false)
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
        /** The bill is still a DRAFT — raised when the car was marked ready, left open so
         *  anything the customer picks up on their way out can go on it. Issuing is the last
         *  thing that happens before the money: it takes the fiscal number, moves the stock,
         *  and stamps THIS till and trading day, which is where the sale actually happened. */
        needsIssue: Boolean = false,
    ): SaleResult {
        require(method != PayMethod.CREDIT) { "Choose a payment method." }
        val tendered = if (method == PayMethod.CASH) (tenderCents ?: amountCents) else null

        // Keyed off the same saleKey as the payment, so a retry after a lost response
        // replays the issue rather than minting a second number.
        var issuedNumber = number
        if (needsIssue) {
            issuedNumber = try {
                api.issueDocument(invoiceId, "$payKey:issue", sessionId = cashSessionId).number ?: number
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Nothing has been charged yet: the bill is still a draft and the drawer has
                // not opened, so this is a clean refusal rather than an uncertain payment.
                throw e
            }
        }
        // The invoice already exists; a lost response after record_payment lands is
        // indistinguishable from a lost request. Surface it as SalePaymentUncertain (like
        // completeSale) so the caller freezes and the retry replays under "$payKey:collect".
        val payment = try {
            api.recordPayment(
                invoiceId = invoiceId,
                method = requireNotNull(method.rpcValue),
                amountRupees = centsToRupees(amountCents),
                tenderedRupees = tendered?.let { centsToRupees(it) },
                externalRef = if (method == PayMethod.CASH) null else (externalRef?.trim().takeUnless { it.isNullOrEmpty() } ?: "POS"),
                // ALL methods link to the till session (see completeSale) — device traceability.
                cashSessionId = cashSessionId,
                idempotencyKey = "$payKey:collect",
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw SalePaymentUncertain(invoiceId, issuedNumber, e)
        }
        val change = if (method == PayMethod.CASH && tendered != null) (tendered - amountCents).coerceAtLeast(0) else 0
        return SaleResult(invoiceId, issuedNumber, amountCents, change, onAccount = false, paymentId = payment.id)
    }
}
