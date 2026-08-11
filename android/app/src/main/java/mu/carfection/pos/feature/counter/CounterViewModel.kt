package mu.carfection.pos.feature.counter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.CartLine
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.data.SaleIssueUncertain
import mu.carfection.pos.core.data.SaleLineSpec
import mu.carfection.pos.core.data.SalePaymentUncertain
import mu.carfection.pos.core.data.SERVICES_TAB
import mu.carfection.pos.core.data.SaleRepository
import mu.carfection.pos.core.data.SaleResult
import mu.carfection.pos.core.data.Tender
import mu.carfection.pos.core.data.WALK_IN_CUSTOMER
import mu.carfection.pos.core.data.expandSaleLines
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.data.TillRepository
import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.network.NewCustomerDto
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.hardware.CashDrawer
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptLine
import mu.carfection.pos.core.hardware.ReceiptPrinter
import mu.carfection.pos.core.hardware.ReceiptVatGroup
import mu.carfection.pos.core.money.Allowance
import mu.carfection.pos.core.money.DocDiscount
import mu.carfection.pos.core.money.DocDiscountTotals
import mu.carfection.pos.core.money.DocTotals
import mu.carfection.pos.core.money.computeAllowance
import mu.carfection.pos.core.money.computeDocTotals
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.centsToPlainText
import mu.carfection.pos.core.money.computeTotals
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.grossCents
import mu.carfection.pos.core.money.lineExclCents
import mu.carfection.pos.core.money.netFromGrossCents
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.pointsValueCents
import mu.carfection.pos.core.money.rupeesToCents
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.JobServiceDetailDto
import mu.carfection.pos.core.network.OutstandingInvoiceDto
import mu.carfection.pos.core.network.OverrideApi
import mu.carfection.pos.core.network.OverrideOutcome
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.data.billRef
import mu.carfection.pos.core.data.saleReceiptDoc
import mu.carfection.pos.core.network.SaleHistoryDto
import mu.carfection.pos.core.network.SaleHistoryLineDto
import mu.carfection.pos.core.network.TodayPaymentDto
import mu.carfection.pos.core.network.UserNameDto
import mu.carfection.pos.core.network.pinErrorCopy
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import mu.carfection.pos.core.network.uiMessage
import javax.inject.Inject

/** Everything the counter screen renders. Totals are always derived, never stored. */
data class CounterUiState(
    val query: String = "",
    val tab: String = "All", // category filter
    val catQuery: String = "", // narrows the category rail (189 accessories ≠ browsable)
    val categories: List<String> = listOf("All"),
    val catCounts: Map<String, Int> = emptyMap(), // category → product count (rail scanning aid)
    val railOpen: Boolean = true, // category rail expanded / collapsed to a slim strip
    val onHand: Map<String, Int> = emptyMap(), // productId → stock at the selling floor, where this till sells from
    val adhocOpen: Boolean = false,
    val products: List<ProductEntity> = emptyList(),
    val cart: List<CartLine> = emptyList(),
    // basket-level discount (applies after line discounts; emitted as negative lines)
    val basketMode: DiscountMode = DiscountMode.PCT,
    val basketText: String = "",
    // Why — required once the discount reaches into a carwash allowance (Allowance.kt).
    val discountReason: String = "",
    // Priced by the DB's OWN discount arithmetic, so the footer, the pay panel and the slip all
    // read one figure and it is the figure the server will store.
    val docTotals: DocDiscountTotals = computeDocTotals(emptyList(), null, 0.0, 0),
    // customer (optional walk-in name; picked id required for credit)
    val customerText: String = "",
    val customerId: String? = null,
    val customerMatches: List<CustomerEntity> = emptyList(),
    // till
    val till: CashSessionDto? = null,
    // payment pad
    val padOpen: Boolean = false,
    val method: PayMethod = PayMethod.CASH,
    val tenderText: String = "", // numpad-owned; empty = exact
    // How much of the bill is being settled now. Empty = all of it. Only a collect can
    // carry a balance, so only a collect can type here.
    val payText: String = "",
    val padField: PadField = PadField.TENDER, // which display the numpad is typing into
    val refText: String = "",
    val comment: String = "", // internal note for the sale — shown in the back office, never on the receipt
    val busy: Boolean = false,
    val error: String? = null,
    val done: SaleResult? = null,
    val receipt: ReceiptDoc? = null, // what just printed — post-sale preview / reprint
    // checkout mode: the TO COLLECT / PAID TODAY list, or a walk-in cart
    val mode: CheckoutMode = CheckoutMode.LIST,
    val bills: List<OutstandingInvoiceDto> = emptyList(),
    val paidToday: List<TodayPaymentDto> = emptyList(),
    val listBusy: Boolean = false,
    val collect: OutstandingInvoiceDto? = null, // when set, the pad collects on this invoice
    val paymentAction: TodayPaymentDto? = null, // a tapped PAID TODAY row → reverse / refund
    val notice: String? = null, // transient corrections feedback
    val oversell: OversellPrompt? = null, // adding this would drive stock negative — confirm first
    val pendingSettle: PendingSettle? = null, // a settle reached the server — basket is frozen
    // sales history (past sales + reprint)
    val historyOpen: Boolean = false,
    val history: List<SaleHistoryDto> = emptyList(),
    val historyQuery: String = "",
    val historyBusy: Boolean = false,
    val viewDoc: ReceiptDoc? = null, // a past sale's receipt, rebuilt for preview/reprint
    // Split bill: an allocation table — how much the customer pays on each method. Off by
    // default; the amounts are typed per row (splitFocus is the row the numpad types into).
    val splitMode: Boolean = false,
    val splitFocus: PayMethod = PayMethod.CASH,
    val splitText: Map<PayMethod, String> = emptyMap(),
    // studio identity for the payment screen's bill panel (Cashmag-style header)
    val bizName: String = "",
    val bizAddress: String? = null,
    // The shop quotes VAT-INCLUSIVE shelf prices — show gross on screen. Prices stay stored
    // net and the totals below stay net + VAT; this only changes what staff read.
    val pricesInclVat: Boolean = false,
    // What one point is worth when spent (business_settings.point_value_rupees) — a shop-wide
    // setting, loaded once like pricesInclVat, not per-customer.
    val pointValueRupees: Double = 1.0,
    // The named customer's CURRENT points balance — derived in `state` from whichever source
    // has one: the collect bill's own embed, or the walk-in cart's picked customer in the
    // synced cache. 0 when nobody is named (the Points tender is not offered then anyway).
    val pointsBalance: Int = 0,
    /** Points the cashier has put against this bill, in cents. Settled alongside
     *  whatever method covers the rest — see [dueAfterPointsCents]. */
    val pointsAppliedCents: Long = 0,
    /** The why-was-this-discounted box, opened from the pad's own refusal. */
    val reasonDialogOpen: Boolean = false,
    // The bill panel's real detail for a collect: the invoice's own lines + (for a job) the
    // service performed. Fetched when the pad opens; empty while in flight or for a walk-in.
    val collectLines: List<SaleHistoryLineDto> = emptyList(),
    val collectJob: JobServiceDetailDto? = null,
    val collectDetailFailed: Boolean = false, // the item fetch errored — offer a retry, not a forever "loading"
    // Sales rung on this tablet during an outage. They stay listed after they land so the
    // cashier can see the invoice number each one was finally given.
    val offlineSales: List<mu.carfection.pos.core.sync.OfflineSaleRow> = emptyList(),
    val heldOpen: Boolean = false,

    // ── "Ask the owner": on-the-spot PIN approval when a discount is over its ceiling ──
    // Mirrors the web's OwnerOverrideDialog and the quote builder's own copy of this same
    // machinery — see QuoteViewModel. The counter sale has no document row yet when this
    // can be tapped (it drafts+issues in one go at Record payment), so the override names
    // the sale's own DETERMINISTIC id (SaleRepository.draftIdFor(saleKey)) ahead of time;
    // issue_document is later called under that exact same id, so assert_discount_allowed
    // finds the approval waiting for it.
    /** Fed into computeAllowance's third argument (see [allowance] below) — never
     *  re-derived from the RPC's rupee round trip. Reset the instant the cart empties
     *  (see [withCart]), same moment saleKey itself rotates, so an approval can never
     *  leak onto the next sale. */
    val approvedMaxCents: Long? = null,
    val overrideOpen: Boolean = false,
    val overrideOwners: List<UserNameDto>? = null, // null = loading
    val overrideOwnersError: String? = null,
    val overrideOwnerId: String? = null,
    val overridePin: String = "",
    val overrideReason: String = "",
    val overrideAmountText: String = "",
    val overrideBusy: Boolean = false,
    val overrideError: String? = null,
    val overrideDone: Boolean = false,
) {
    /** Sales the server has not seen — money the books are still missing. */
    val heldSales: List<mu.carfection.pos.core.sync.OfflineSaleRow>
        get() = offlineSales.filter { it.status != mu.carfection.pos.core.sync.OfflineSaleRow.STATUS_SYNCED }

    /** Held sales whose till or day closed under them — these need a person, not a retry. */
    val blockedSales: List<mu.carfection.pos.core.sync.OfflineSaleRow>
        get() = offlineSales.filter { it.status == mu.carfection.pos.core.sync.OfflineSaleRow.STATUS_BLOCKED }

    val heldTotalCents: Long get() = heldSales.sumOf { it.totalCents }

    /** The whole balance the pad COULD settle: an invoice's outstanding, or the cart total. */
    val dueCents: Long get() = collect?.let { rupeesToCents(it.totalIncl) - rupeesToCents(it.amountPaid) } ?: totals.totalCents

    /**
     * The most this method can take in one go. Every method can cover the whole balance
     * except POINTS, which can only ever cover what the customer's balance is worth.
     *
     * Without this the pad told the cashier the limit and then refused to help: picking
     * Points left the full bill in the box, printed "Points can cover up to Rs 5.00" in
     * red underneath, and greyed the button out. Everything about the rule was correct
     * and the cashier still could not spend the points. Reported from the shop floor,
     * 2026-08-11.
     */
    val methodCeilingCents: Long
        get() = dueAfterPointsCents

    /**
     * What is being taken RIGHT NOW in single-method mode — a deposit, or the lot. Capped at
     * what the method can actually cover. Empty = that ceiling, so an untouched walk-in
     * still settles in full, and picking Points fills in what the points are worth.
     */
    val payCents: Long
        get() {
            val typed = if (payText.isBlank()) null else parseMoneyToCents(payText)
            return (typed ?: methodCeilingCents).coerceIn(0, methodCeilingCents.coerceAtLeast(0))
        }

    /** Money still owed after this entry lands — what stays in TO COLLECT. */
    val balanceAfterCents: Long get() = (dueCents - payCents).coerceAtLeast(0)
    val isPartPayment: Boolean get() = collect != null && payCents in 1 until dueCents

    val tenderCents: Long? get() = if (tenderText.isBlank()) null else parseMoneyToCents(tenderText)
    val effectiveTenderCents: Long get() = tenderCents ?: payCents // pad opens "exact"
    val changeCents: Long get() = (effectiveTenderCents - payCents).coerceAtLeast(0)

    // ── split allocation (Cash / Card / Juice / Bank — never Credit) ────────────
    /** Cents allocated to a method in the split table (0 if blank). */
    fun splitCents(m: PayMethod): Long = (splitText[m]?.let { if (it.isBlank()) null else parseMoneyToCents(it) } ?: 0L).coerceAtLeast(0)
    /** Total allocated across every split row. */
    val allocatedCents: Long get() = SPLIT_METHODS.sumOf { splitCents(it) }
    /** What is still unallocated — the split's running balance. */
    // Against what is LEFT after points, not the bill — a split settles the rest.
    val splitBalanceCents: Long get() = dueAfterPointsCents - allocatedCents
    /** The split is ready when its rows sum EXACTLY to the bill and a till is open. */
    val splitCanRecord: Boolean get() = !busy && discountBlockReason == null && till != null && dueAfterPointsCents > 0 && allocatedCents == dueAfterPointsCents

    /**
     * Does this sale name a REAL customer — one the cashier picked or the bill was already
     * billed to — as opposed to a fresh walk-in cart nobody has attached anyone to yet?
     * Same test CREDIT already uses: a typed-but-unselected name doesn't count, because
     * there is no id yet to look a points balance up against.
     */
    val hasNamedCustomer: Boolean
        get() = (collect == null && customerId != null) || (collect?.customers != null)

    /** What the named customer's points balance is worth right now, in cents. */
    val pointsWorthCents: Long get() = pointsValueCents(pointsBalance, pointValueRupees)

    /** The most a Points tender may take off THIS bill: never more than is owed, and never
     *  more than the balance is worth. Zero when nobody is named — spend_points refuses
     *  outright otherwise ("a points payment needs a customer on the bill", 20260811000040). */
    val pointsCapCents: Long get() = if (hasNamedCustomer) minOf(dueCents, pointsWorthCents) else 0L

    /**
     * What the apply-points prompt should offer, or null when there is nothing to offer.
     * Null once they are already applied — the bar then reports rather than offers.
     */
    val applyPointsCents: Long?
        get() = pointsCapCents.takeIf { hasNamedCustomer && pointsBalance > 0 && it > 0 }

    /** Who the prompt is about. Falls back rather than printing an empty name. */
    val pointsCustomerLabel: String
        get() = (collect?.customers?.name ?: customerText).trim().ifBlank { "This customer" }

    /**
     * What the chosen method still has to cover once points have been applied.
     *
     * POINTS IS NOT A MEANS OF PAYMENT. It sat in the grid beside Cash and Card, which
     * made it a rival to them: to use Rs 5.00 of points against a Rs 1,282.49 bill you
     * picked Points, took Rs 5.00, and then went round again for the rest. That is not
     * how anyone thinks about a balance — points behave like a voucher. They come off
     * the total, and whatever is left is paid however the customer likes.
     *
     * So the tile is gone, the bar above the grid applies them, and this is what the
     * grid is then settling. Underneath they are still a tender, not a discount: the
     * bill total and its VAT never move (20260811000010), and Take records both the
     * points and the cash in one go.
     */
    val dueAfterPointsCents: Long get() = (dueCents - pointsAppliedCents).coerceAtLeast(0)

    /** The means of payment on offer. Points is applied above the grid, never in it. */
    val availableMethods: List<PayMethod>
        get() = PayMethod.entries.filterNot { it == PayMethod.POINTS }

    /** Does the current single entry satisfy its method's rules (till, tender, customer)? */
    private val entryValid: Boolean
        get() = when (method) {
            PayMethod.CASH -> effectiveTenderCents >= payCents && till != null
            PayMethod.CREDIT -> (collect == null && customerId != null) || (collect?.customers != null)
            else -> till != null // card/juice/bank
        }

    val canRecord: Boolean
        get() = !busy && discountBlockReason == null && (collect != null || cart.isNotEmpty()) && when (method) {
            PayMethod.CREDIT -> dueCents > 0 && entryValid
            // A COLLECT may take a partial (a deposit); a WALK-IN must be settled in full —
            // and "in full" now means the rest, since points have already covered their part.
            else -> payCents > 0 && entryValid && (collect != null || payCents == dueAfterPointsCents)
        }

    /** Why the pay button is dead, when the reason is the till and not the basket. */
    val cashNeedsTill: Boolean get() = (splitMode || method != PayMethod.CREDIT) && till == null && (payCents > 0 || allocatedCents > 0)

    /** Quick-tender chips: the round-ups a customer actually hands over, above what is being paid. */
    val quickTenders: List<Long>
        get() {
            val t = payCents
            fun up(step: Long) = ((t + step - 1) / step) * step
            return listOf(up(100_00), up(500_00), up(1000_00), up(5000_00))
                .filter { it > t }.distinct().take(3)
        }

    /**
     * Deposit chips — half or three-quarters of what THIS METHOD can take. Off the
     * balance for everything except points, where offering Rs 641 against a Rs 5.00
     * balance is just a button that cannot be pressed.
     */
    val depositChips: List<Long>
        get() = methodCeilingCents.let { ceiling ->
            if (ceiling <= 0) emptyList()
            else listOf(ceiling / 2, ceiling / 4 * 3).map { it / 100 * 100 }.filter { it in 1 until ceiling }.distinct()
        }

    // ── basket discount, derived from the raw input ─────────────────────────────
    val basketPct: Int get() = if (basketMode == DiscountMode.PCT) (basketText.toIntOrNull() ?: 0).coerceIn(0, 100) else 0
    val basketAmtCents: Long get() = if (basketMode == DiscountMode.AMT) (parseMoneyToCents(basketText) ?: 0L).coerceAtLeast(0) else 0

    /**
     * The tablet's mirror of app.document_discount_limits — the same arithmetic
     * [computeAllowance] runs on the quote builder. Advisory only: issue_document is the
     * real gate, but a sale blocked here never reaches it, so a rejection it would raise
     * is never queued offline either (see SaleRepository.DETERMINISTIC_ISSUE_REJECTIONS).
     *
     * Empty while [collect] is set: collectOn() does not clear [cart] (a walk-in built and
     * abandoned for a TO COLLECT bill stays in memory), and a collect settles an ALREADY-issued
     * invoice with no cart of its own — dueCents already reads the bill, not the cart, for
     * exactly this reason. Without this guard a stale cart's discount could block a payment
     * that has nothing to do with it.
     */
    val allowance: Allowance
        get() = if (collect != null) computeAllowance(emptyList(), null) else computeAllowance(
            cart.map { it.allowanceInput },
            docDiscount = orderDiscountKind?.let { DocDiscount(it, if (it == "percent") basketPct.toDouble() else basketAmtCents.toDouble()) },
            approvedMaxCents = approvedMaxCents,
        )

    /** Why Record payment is dead, when the reason is the discount and not the till/basket. */
    val discountBlockReason: String?
        get() = when {
            allowance.overCeiling -> "This discount is over the ${formatMUR(allowance.ceilingCents)} allowed on this bill — ask the owner."
            allowance.reasonRequired && discountReason.isBlank() -> "Add a reason for this discount before issuing."
            else -> null
        }

    /**
     * Every figure below comes from ONE call to the DB's own discount arithmetic
     * ([computeDocTotals] mirrors app.discounted_vat_groups line for line), so the footer, the
     * pay panel and the slip cannot disagree with each other or with what the server will store.
     */
    /** Subtotal / VAT / TOTAL, for the rows that only need the three headline figures. */
    val totals: DocTotals
        get() = DocTotals(emptyList(), docTotals.subtotalCents, docTotals.vatCents, docTotals.totalCents)

    /** Each cart row at the price it will be billed — line discount applied, VAT added. */
    fun rowGrossCents(i: Int): Long = grossCents(docTotals.lineExclCents[i], cart[i].product.vatRatePct)

    val orderDiscountKind: String?
        get() = when {
            basketMode == DiscountMode.PCT && basketPct > 0 -> "percent"
            basketMode == DiscountMode.AMT && basketAmtCents > 0 -> "amount"
            else -> null
        }

    /** Subtotal before the basket discount — what the "Subtotal" row shows, ex-VAT. */
    val preBasketSubtotalCents: Long get() = docTotals.lineExclCents.sum()

    /**
     * Subtotal on a gross-quoting shop: the sum of the very line amounts printed in the cart, so
     * the footer can never disagree with the list above it.
     */
    val grossSubtotalCents: Long
        get() = cart.indices.sumOf { rowGrossCents(it) }

    /** What the basket discount takes off the bill — now exactly what the DB will apply. */
    val basketAppliedGrossCents: Long get() = docTotals.orderDiscountInclCents

    /** The same figure ex-VAT, for the shop that quotes net. */
    val basketAppliedCents: Long get() = preBasketSubtotalCents - docTotals.subtotalCents
}

/**
 * A printed document reference, exactly as the slip's CODE128 barcode encodes it —
 * "INV-0031" for a sale, "A00024" for a quotation.
 *
 * Matched WHOLE, never as a prefix: the scanner delivers the complete code in one burst, and
 * requiring a full match means an operator typing into the product search only triggers a
 * lookup once they have typed a real reference — at which point that IS what they wanted.
 */
private val DOC_REF = Regex("^(INV-\\d{3,}|[A-Z]\\d{5,})$", RegexOption.IGNORE_CASE)

fun isDocumentRef(code: String): Boolean = DOC_REF.matches(code.trim())

/** "quote" → "quotation" — what to call a scanned reference that isn't a sale. */
fun docKindLabel(docType: String): String = when (docType) {
    "quote" -> "quotation"
    "credit_note" -> "credit note"
    else -> docType.replace('_', ' ')
}

enum class CheckoutMode { LIST, WALKIN }

/** The methods a split bill can be allocated across — Credit is a receivable, not a tender. */
val SPLIT_METHODS = listOf(PayMethod.CASH, PayMethod.CARD, PayMethod.JUICE, PayMethod.BANK)

/** Which figure the numpad is editing: what we're taking, or what the customer handed over. */
enum class PadField { AMOUNT, TENDER }

/** A tap that would sell past available stock, held until the cashier confirms. */
data class OversellPrompt(val product: ProductEntity, val targetQty: Double)

/**
 * A settle attempt that reached `issue_document`. An invoice may exist on the server under this
 * sale's idempotency key, and the client cannot tell. Until it resolves the basket is frozen:
 * both money RPCs replay purely on the key, so settling a *different* basket under it would
 * charge the customer for this one. Retrying the identical basket is safe — the server replays.
 *
 * [invoiceId] is null when `issue_document` itself failed (the invoice may or may not exist).
 */
data class PendingSettle(val invoiceId: String?, val number: String?)

internal const val SETTLE_LOCK_NOTICE = "Finish or cancel this sale before changing the basket."

/**
 * Single recompute path: every cart/basket change rebuilds the exact invoice line set
 * (expandSaleLines) and prices it with the shared money engine — the footer always shows
 * what the server will charge.
 */
internal fun CounterUiState.withCart(cart: List<CartLine>): CounterUiState {
    if (pendingSettle != null) return copy(notice = SETTLE_LOCK_NOTICE)
    // Emptying the cart ends the ticket, so the whole-sale discount — and why it was given,
    // and any owner override taken out for it — all go with it. Otherwise a discount (or its
    // reason, or an approval) from one walk-in silently re-prices, or pre-justifies, or
    // covers, the next basket built on this screen. Same moment CounterViewModel rotates
    // saleKey (mutateCart), which is what the override's own document id is derived from.
    val s = if (cart.isEmpty() && this.cart.isNotEmpty())
        copy(basketMode = DiscountMode.PCT, basketText = "", discountReason = "", approvedMaxCents = null, overrideOpen = false)
    else this
    val priced = s.copy(cart = cart, error = null)
    return priced.copy(
        docTotals = computeDocTotals(
            cart.map { it.docLine },
            priced.orderDiscountKind,
            priced.basketPct.toDouble(),
            priced.basketAmtCents,
        ),
    )
}

/** The whole-sale discount is part of the basket, so it freezes with it. */
internal fun CounterUiState.withBasket(mode: DiscountMode, text: String): CounterUiState {
    if (pendingSettle != null) return copy(notice = SETTLE_LOCK_NOTICE)
    return copy(basketMode = mode, basketText = text).withCart(cart)
}

/**
 * Where a settle died decides whether the cashier may keep editing. Anything before
 * `issue_document` has committed nothing that costs money, so the basket stays live.
 */
internal fun CounterUiState.withSettleFailure(e: Throwable): CounterUiState = when (e) {
    // Retrying is the safe act: the payment may in fact have committed, and re-sending the same
    // request replays it. Cancelling instead would hide a settled invoice and re-ring the sale.
    is SalePaymentUncertain -> copy(
        busy = false,
        // A retry may re-fail without knowing the number — never forget one we had.
        pendingSettle = PendingSettle(e.invoiceId, e.number ?: pendingSettle?.number),
        error = "${e.number?.let { "Invoice $it" } ?: "The invoice"} was issued but the payment " +
            "didn't confirm. Tap Record payment again — retrying can never charge twice. " +
            "Cancelling leaves it on the server.",
    )
    is SaleIssueUncertain -> copy(
        busy = false,
        // Keep a known invoiceId: overwriting it with nulls used to send the retry back
        // through draft+issue, which the idempotency guard rightly refused forever.
        pendingSettle = pendingSettle ?: PendingSettle(null, null),
        error = "Couldn't confirm the sale reached the server. Tap Record payment again to " +
            "finish it — don't change the basket.",
    )
    else -> copy(busy = false, error = e.uiMessage("Sale failed — try again."))
}

/**
 * Should this settle be CAPTURED on the tablet instead of sent to the server?
 *
 * With no network the customer has still paid, and refusing the sale is the one outcome
 * that actually loses the studio money — so a walk-in is captured and given a provisional
 * slip. Everything excluded here is excluded because capturing it would be WRONG, not
 * merely inconvenient:
 *
 *  - a COLLECT settles an invoice that lives on the server, whose outstanding balance
 *    cannot be read while offline; guessing at it could overpay a bill.
 *  - a sale with a PENDING SETTLE may already exist on the server under this sale key.
 *    That one must be retried, never re-rung as a second sale.
 *  - CREDIT takes no money at all, so there is nothing to lose by waiting for the network.
 *  - POINTS needs the server to check and debit a balance THIS INSTANT — a balance checked
 *    after the fact is not a check. Queuing a points payment offline could promise a
 *    customer a redemption their balance can no longer cover by the time it replays, so
 *    this is refused outright rather than captured (see CounterViewModel.confirm()).
 *  - with no TILL there is no service to file the money against, and `record_payment`
 *    requires one for every method — a captured sale would only block later.
 */
internal fun canCaptureOffline(s: CounterUiState, online: Boolean): Boolean =
    !online &&
        s.collect == null &&
        s.pendingSettle == null &&
        s.method != PayMethod.CREDIT &&
        // Points are applied above the grid now, not chosen as a method — so the test is
        // whether any are ON this bill, not which tile is lit.
        s.pointsAppliedCents == 0L &&
        s.till != null &&
        s.cart.isNotEmpty()

@HiltViewModel
class CounterViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val sales: SaleRepository,
    private val till: TillRepository,
    private val session: SessionRepository,
    private val printer: ReceiptPrinter,
    private val drawer: CashDrawer,
    private val api: PosApi,
    private val outbox: mu.carfection.pos.core.sync.OutboxRepository,
    private val collectBus: mu.carfection.pos.core.data.CollectBus,
    private val offlineSales: mu.carfection.pos.core.sync.OfflineSaleRepository,
    private val connectivity: mu.carfection.pos.core.sync.ConnectivityObserver,
    private val overrideApi: OverrideApi,
) : ViewModel() {

    private val local = MutableStateFlow(CounterUiState())

    val state: StateFlow<CounterUiState> =
        combine(local, catalog.products, catalog.customers) { s, products, customers ->
            // "All" always survives the rail search, so there is always a way back out.
            // "Services" is pinned beside it — same rule as the quote builder's rail.
            val catQ = s.catQuery.trim()
            val cats = listOf("All", SERVICES_TAB) + products.mapNotNull { it.category }.distinct().sorted()
                .filter { catQ.isEmpty() || it.contains(catQ, ignoreCase = true) }
            val counts = products.mapNotNull { it.category }.groupingBy { it }.eachCount() +
                ("All" to products.size) + (SERVICES_TAB to products.count { it.kind == "service" })
            val q = s.query.trim().lowercase()
            val filtered = products
                .filter {
                    when (s.tab) {
                        "All" -> true
                        SERVICES_TAB -> it.kind == "service"
                        else -> it.category == s.tab
                    }
                }
                .filter { q.isEmpty() || it.name.lowercase().contains(q) || (it.barcode ?: "").contains(q) }
            val cq = s.customerText.trim().lowercase()
            val matches = if (cq.isEmpty() || s.customerId != null) emptyList()
            else customers.filter { it.name.lowercase().contains(cq) }.take(6)
            // A collect bill carries its own (fresher, server-embedded) balance; a walk-in
            // reads its picked customer's balance off the synced cache. Neither when nobody
            // is named — the Points tender isn't offered then, so the figure is moot.
            val pointsBalance = s.collect?.customers?.pointsBalance
                ?: customers.firstOrNull { it.id == s.customerId }?.pointsBalance ?: 0
            s.copy(products = filtered, categories = cats, catCounts = counts, customerMatches = matches, pointsBalance = pointsBalance)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CounterUiState())

    // The whole catalogue, unfiltered — the scanner must find a barcode even while
    // the visible grid is filtered down by category tab or a half-typed search.
    private var allProducts: List<ProductEntity> = emptyList()

    // The cached customer list, for resolving a walk-in with no network to ask.
    private var allCustomers: List<CustomerEntity> = emptyList()

    init {
        refreshTill()
        loadLists()
        refreshStock()
        watchCollectRequests() // a deposit agreed at signing lands the pad on its bill
        viewModelScope.launch { catalog.products.collect { allProducts = it } }
        viewModelScope.launch { catalog.customers.collect { allCustomers = it } }
        // Sales held on this tablet — the cashier has to be able to see them, and see the
        // invoice number each one is finally given.
        viewModelScope.launch { offlineSales.all.collect { local.value = local.value.copy(offlineSales = it) } }
        // Studio identity for the payment screen's bill panel (Cashmag-style header).
        viewModelScope.launch {
            runCatching { catalog.receiptBiz() }.getOrNull()?.let { biz ->
                local.value = local.value.copy(bizName = biz.name, bizAddress = biz.address)
            }
        }
        // Does the shop quote gross? Collected, not read once — the settings sync below writes
        // this flag, and a snapshot would lose the race on the first launch after an update.
        viewModelScope.launch {
            catalog.pricesInclVatFlow.collect { incl -> local.value = local.value.copy(pricesInclVat = incl) }
        }
        // The Points tender's cap moves with the owner's rate — same "live, not a snapshot" rule.
        viewModelScope.launch {
            catalog.pointValueRupeesFlow.collect { rate -> local.value = local.value.copy(pointValueRupees = rate) }
        }
        // Track the shared session so opening/closing the till updates the chip immediately.
        viewModelScope.launch { till.current.collect { t -> local.value = local.value.copy(till = t) } }
        viewModelScope.launch { runCatching { catalog.refresh() } } // stale-while-revalidate
        // This ViewModel is activity-scoped and outlives a logout; wipe one operator's live cart,
        // customer and open pad so the next operator can't complete a stale sale under their name.
        viewModelScope.launch { session.isLoggedIn.collect { if (it == false) resetOnSignOut() } }
    }

    /** Hard reset on operator switch — unconditional (unlike newSale, which guards a settle). */
    private fun resetOnSignOut() {
        saleKey = UUID.randomUUID().toString()
        // Studio identity is not per-operator — keep it so the next login's payment screen
        // doesn't fall back to the hardcoded name (the ViewModel is activity-scoped; init
        // won't re-run to re-fetch it).
        val cur = local.value
        local.value = CounterUiState(
            till = cur.till, bizName = cur.bizName, bizAddress = cur.bizAddress,
            pricesInclVat = cur.pricesInclVat, pointValueRupees = cur.pointValueRupees,
        )
    }

    // ── checkout list: TO COLLECT + PAID TODAY ─────────────────────────────────
    fun loadLists() {
        local.value = local.value.copy(listBusy = true)
        viewModelScope.launch {
            val start = LocalDate.now(ZoneOffset.ofHours(4)).atStartOfDay(ZoneOffset.ofHours(4))
                .toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            // Only invoices with money actually owed: a zero-total (or fully settled)
            // issued invoice has nothing to collect — offering it opened a Rs 0.00
            // payment pad that could never succeed.
            // A FAILED fetch is not an empty till list. Swallowing it into emptyList() is how a
            // broken query read as "nothing awaiting payment" while real money was owed — the
            // cashier had no way to tell the difference. Say so instead.
            val billsResult = runCatching { api.fetchOutstandingInvoices() }
            billsResult.exceptionOrNull()?.let { e ->
                local.value = local.value.copy(listBusy = false, error = "Couldn't load the bills — ${e.uiMessage()}")
                return@launch
            }
            val bills = billsResult.getOrDefault(emptyList())
                .filter { rupeesToCents(it.totalIncl) - rupeesToCents(it.amountPaid) > 0 }
                // TO COLLECT means collect NOW. A draft belongs here only when it is a job's
                // bill and that car is finished — a bill opened mid-service so the counter
                // could add something to it is not yet a debt, and a draft typed in the back
                // office and abandoned never was.
                //
                // …with one exception: a bill raised from a quote that has NO job on the board.
                // Goods over the counter have no work to wait for, so there is no later moment
                // for it to appear — it would simply never be collectable, and the money would
                // be invisible to the till that has to take it.
                .filter {
                    it.status != "draft" ||
                        it.jobs?.status == "ready" || it.jobs?.status == "delivered" ||
                        (it.jobId == null && it.sourceDocumentId != null)
                }
            val paidRaw = runCatching { api.fetchTodayPayments(start) }.getOrDefault(emptyList())
            // PAID TODAY = money that actually stands. A mistake + its reversal
            // cancel out and BOTH disappear (the trail stays in History and the
            // back office), so a re-collected sale shows exactly once.
            val reversedIds = paidRaw.mapNotNull { it.reversesPaymentId }.toSet()
            val paid = paidRaw.filter { it.reversesPaymentId == null && it.id !in reversedIds }
            local.value = local.value.copy(bills = bills, paidToday = paid, listBusy = false)
        }
    }

    fun startWalkIn() {
        local.value = local.value.copy(mode = CheckoutMode.WALKIN, collect = null)
        refreshStock()
    }
    fun backToList() {
        // An unresolved settle may hold a real invoice under saleKey; abandoning it would orphan
        // the invoice with no idempotent path back. Retrying is the only safe exit — refuse.
        if (frozenBySettle()) return
        newSale(); local.value = local.value.copy(mode = CheckoutMode.LIST); loadLists()
    }

    /** On-hand counts for the product tiles (stock line + low-stock badge) and
     *  the oversell prompt — counted at the SELLING FLOOR, because that is the
     *  only stock this till can actually sell. Cached: the floor doesn't move
     *  between refreshes. */
    private var salesFloorId: String? = null
    private fun refreshStock() = viewModelScope.launch {
        runCatching {
            val floor = salesFloorId ?: api.fetchShopLocationId()?.also { salesFloorId = it }
            api.fetchStockOnHand(floor)
        }.onSuccess { rows ->
            val map = rows.groupBy { it.productId }.mapValues { (_, r) -> r.sumOf { it.qtyOnHand }.toInt() }
            local.value = local.value.copy(onHand = map)
        }
    }

    fun setTab(t: String) { local.value = local.value.copy(tab = t) }
    fun setCatQuery(q: String) { local.value = local.value.copy(catQuery = q) }
    fun toggleRail() { local.value = local.value.copy(railOpen = !local.value.railOpen) }

    // ── ad-hoc line (typed name + price; saves with product_id = null) ─────────
    fun openAdhoc() { local.value = local.value.copy(adhocOpen = true) }
    fun closeAdhoc() { local.value = local.value.copy(adhocOpen = false) }

    fun addAdhoc(name: String, priceCents: Long) {
        if (name.isBlank() || priceCents <= 0) { closeAdhoc(); return }
        viewModelScope.launch {
            val vat = catalog.vatDefault()
            // When the shop quotes gross, staff type what the customer pays — store the NET,
            // because the ledger adds VAT on top of whatever unit price it is handed.
            val unit = if (catalog.pricesInclVat()) netFromGrossCents(priceCents, vat) else priceCents
            val p = ProductEntity(
                id = CartLine.ADHOC_PREFIX + UUID.randomUUID(),
                name = name.trim(), kind = "adhoc", sellingPriceCents = unit,
                vatRatePct = vat, barcode = null, isStocked = false, category = null, lowStockThreshold = null,
            )
            local.value = local.value.copy(adhocOpen = false)
            mutateCart { cart -> cart + CartLine(p, 1.0) }
        }
    }

    // ── corrections (void / reverse / refund) — RLS enforces owner/manager ─────
    val canManage: Boolean get() = session.userRole.lowercase().let { it.contains("owner") || it.contains("manager") }

    // ── sales held on this tablet ─────────────────────────────────────────────
    fun openHeldSales() { local.value = local.value.copy(heldOpen = true); syncHeldNow() }
    fun closeHeldSales() { local.value = local.value.copy(heldOpen = false) }

    /** Try the queue again now — what the cashier reaches for the moment the Wi-Fi is back. */
    fun syncHeldNow() = viewModelScope.launch { runCatching { offlineSales.drain() } }

    /**
     * File a blocked sale against the till that is open NOW.
     *
     * Only reached when the original till (or its day) has closed, so the sale can no longer
     * go where it was rung. The money is unchanged and the sale keeps its key — if the
     * blocked attempt had in fact landed, the server hands back that invoice rather than
     * raising a second one. The true time of sale is written into the invoice's note,
     * because its fiscal date can now only be today.
     */
    fun refileHeldSale(saleKey: String) {
        if (!canManage) {
            local.value = local.value.copy(notice = "An owner or manager has to file this one.")
            return
        }
        val session = local.value.till?.id
        if (session == null) {
            local.value = local.value.copy(notice = "Open a till first — the sale has to be filed against one.")
            return
        }
        viewModelScope.launch {
            runCatching { offlineSales.refileOnTill(saleKey, session) }
                .onSuccess { local.value = local.value.copy(notice = "Filing it on this till…") }
                .onFailure { local.value = local.value.copy(notice = it.uiMessage("Couldn't file it — try again.")) }
        }
    }

    fun openPaymentAction(p: TodayPaymentDto) { local.value = local.value.copy(paymentAction = p) }
    fun closePaymentAction() { local.value = local.value.copy(paymentAction = null) }
    fun clearNotice() { local.value = local.value.copy(notice = null) }

    // ── sales history: view past sales + reprint their receipts ────────────────
    fun openHistory() {
        local.value = local.value.copy(historyOpen = true, historyBusy = true)
        viewModelScope.launch {
            val h = runCatching { api.fetchSalesHistory() }.getOrDefault(emptyList())
            local.value = local.value.copy(history = h, historyBusy = false)
        }
    }

    fun closeHistory() { local.value = local.value.copy(historyOpen = false, viewDoc = null, historyQuery = "") }
    fun closeViewDoc() { local.value = local.value.copy(viewDoc = null) }

    /** Rebuild a past sale's slip from the server's stored lines + payments and show it. */
    fun viewHistoryReceipt(h: SaleHistoryDto) {
        viewModelScope.launch {
            // saleReceiptDoc, not a second hand-rolled copy of it. This used to duplicate the
            // whole builder — and carried the OLD discount rule ("sum of the negative lines"),
            // which printed Rs 0.00 on any sale discounted per line or on the basket, beside a
            // Subtotal that then disagreed with the TOTAL underneath it.
            // Reprints declare themselves: this paper is not the original. The copy number
            // comes from the audit trail, so it keeps counting across reboots and devices.
            val printed = h.id?.let { api.receiptPrintCount(it) } ?: 0
            // A reprint states the same points lines the original did (saleReceiptDoc itself
            // withholds them for the anonymous walk-in bucket) — best-effort, like every
            // other lookup here: a failed read costs the slip a line, never the reprint.
            val pointsEarned = h.id?.let { runCatching { api.pointsEarnedForDocument(it) }.getOrNull() }
            val doc = saleReceiptDoc(
                h, catalog.receiptBiz(), catalog.vatDefault().toInt(),
                duplicataNo = if (printed > 0) printed + 1 else null,
                duplicataAt = if (printed > 0) java.time.LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")) else null,
                pointsEarned = pointsEarned,
                pointsBalanceAfter = h.customers?.pointsBalance,
            )
            local.value = local.value.copy(viewDoc = doc)
        }
    }

    /** Reprint the previewed past-sale slip. */
    fun printViewDoc() {
        val doc = local.value.viewDoc ?: return
        viewModelScope.launch { runCatching { printer.printDoc(doc) } }
        local.value = local.value.copy(notice = "Receipt sent to the printer")
    }

    private fun correction(label: String, block: suspend () -> Unit) {
        if (local.value.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { local.value = local.value.copy(busy = false, padOpen = false, collect = null, paymentAction = null, done = null, notice = label); loadLists() }
                .onFailure { e ->
                    val msg = if (e.message?.contains("privileges", true) == true) "Only an owner or manager can do that" else e.uiMessage("Couldn’t complete that — try again")
                    local.value = local.value.copy(busy = false, notice = msg)
                }
        }
    }

    /** "Start next sale" on the post-sale panel: clear the counter, straight into a fresh walk-in. */
    fun startNextSale() {
        newSale()
        local.value = local.value.copy(mode = CheckoutMode.WALKIN)
        refreshStock()
    }

    /** Reprint the slip shown in the post-sale panel. */
    fun reprint() {
        val doc = local.value.receipt ?: return
        viewModelScope.launch { runCatching { printer.printDoc(doc) } }
        local.value = local.value.copy(notice = "Receipt sent to the printer")
    }

    /**
     * Void the sale just completed: unpaid/on-account → void; paid → credit note (restocks).
     * [reason] is REQUIRED where it lands in the books (void_document / reverse_payment) —
     * the owner reads it in Activity/Traceability; "Voided at POS" told them nothing.
     */
    fun voidCompletedSale(reason: String?) {
        val r = local.value.done ?: return
        val why = reason?.trim().takeUnless { it.isNullOrEmpty() }
        // A sale rung offline exists only on this tablet — there is no document to void, no
        // payment to reverse and no credit note to raise, and r.invoiceId is empty. Undoing
        // it has to wait until it has actually reached the books.
        if (r.offlineRef != null) {
            local.value = local.value.copy(
                notice = "${r.offlineRef} hasn't reached the server yet — it can't be voided until it syncs.",
            )
            return
        }
        newSale() // clear the finished cart first; the sale itself is already committed
        when {
            // A SPLIT COLLECT: reverse each of THIS transaction's payments (not a credit note
            // over the whole invoice — that would refund a prior deposit too, audit #6).
            r.paymentIds.isNotEmpty() && r.fromCollect -> correction("Split reversed — ${r.number ?: "invoice"}") {
                r.paymentIds.forEach { api.reversePayment(it, why ?: "Reversed at POS") }
            }
            // A COLLECT (deposit / part payment on an existing invoice): reverse just THIS
            // payment. Credit-noting the whole invoice here would refund and restock an
            // entire live job after only a deposit was taken (audit #6).
            r.paymentId != null -> correction("Payment reversed — ${r.number ?: "invoice"}") {
                // 2-arg form: reverse_payment falls back to the device's open till for a cash
                // refund, which is the till this collect was just taken on.
                api.reversePayment(r.paymentId, why ?: "Reversed at POS")
            }
            // An on-account COLLECT's undo walks the HANDOVER back — the job returns to
            // READY and the bill stays open. Voiding here erased the receivable for a car
            // that had already left (and the job stayed delivered).
            r.onAccount && r.fromCollect -> correction("Handover walked back — ${r.number ?: "the bill"} stays owed") { api.undoOnAccount(r.invoiceId) }
            r.onAccount -> correction("${r.number ?: "Invoice"} voided") { api.voidDocument(r.invoiceId, why ?: "Voided at POS") }
            else -> correction("Refunded — credit note issued for ${r.number ?: "the sale"}") {
                // This till takes the refund out of its drawer (booked mirrors on the CN).
                api.issueCreditNote(r.invoiceId, restock = true, stockLocationId = api.fetchShopLocationId(), sessionId = local.value.till?.id)
            }
        }
    }

    fun voidInvoice(bill: OutstandingInvoiceDto, reason: String) =
        correction("${bill.number ?: "Invoice"} voided") { api.voidDocument(bill.id, reason.trim().ifEmpty { "Voided at POS" }) }
    /** Reason is REQUIRED — the owner reads it in Activity/Traceability/Cash Flow. */
    fun reverseThisPayment(p: TodayPaymentDto, reason: String) = correction("Payment reversed") { api.reversePayment(p.id, reason) }
    fun refundInvoice(p: TodayPaymentDto) = correction("Credit note issued — ${p.documents?.number ?: "invoice"}") {
        api.issueCreditNote(p.documentId, restock = true, stockLocationId = api.fetchShopLocationId(), sessionId = local.value.till?.id)
    }

    /** Tap an outstanding invoice → open the pad to collect its balance. */
    fun collectOn(bill: OutstandingInvoiceDto, amountCents: Long? = null) {
        // Starting a new collection would rotate saleKey and abandon an in-flight settle.
        if (frozenBySettle()) return
        saleKey = UUID.randomUUID().toString()
        local.value = local.value.copy(
            collect = bill, padOpen = true, method = PayMethod.CASH,
            collectLines = emptyList(), collectJob = null, collectDetailFailed = false,
            // Every bill opens at its full balance — unless a deposit was agreed at signing,
            // which dials the pad in for the cashier. A part payment typed for the LAST
            // customer must never ride along into this one's.
            tenderText = "",
            payText = amountCents?.let { centsToText(it) } ?: "",
            padField = PadField.TENDER,
            refText = "", error = null, splitMode = false, splitText = emptyMap(),
        )
        loadCollectDetail(bill)
    }

    /**
     * Fill the bill panel with what the client actually took: the invoice's own line items,
     * plus — for a job/service invoice — the service performed (its checklist). Best-effort;
     * the amount/customer/vehicle already render from the DTO in hand, so a failure just leaves
     * the itemised detail blank rather than blocking the collection.
     */
    private fun loadCollectDetail(bill: OutstandingInvoiceDto) {
        viewModelScope.launch {
            val fetched = runCatching { api.fetchInvoice(bill.id)?.lines.orEmpty().sortedBy { it.sortOrder } }
            val job = bill.jobId?.let { jid -> runCatching { api.fetchJobDetail(jid) }.getOrNull() }
            val st = local.value
            if (st.collect?.id != bill.id) return@launch // a newer bill (or none) is on the pad now
            local.value = st.copy(
                collectLines = fetched.getOrDefault(emptyList()),
                collectJob = job,
                collectDetailFailed = fetched.isFailure,
            )
        }
    }

    /** The item fetch failed (bad connection) — try again for the bill still on the pad. */
    fun retryCollectDetail() {
        val bill = local.value.collect ?: return
        local.value = local.value.copy(collectDetailFailed = false)
        loadCollectDetail(bill)
    }

    /**
     * A customer just signed a quote and left a deposit: the bill is waiting, the figure is
     * agreed. Land on it with the pad already open. Latched, so it survives the navigation
     * that creates this ViewModel in the first place.
     */
    private fun watchCollectRequests() {
        viewModelScope.launch {
            collectBus.pending.collect { req ->
                if (req == null) return@collect
                val bills = runCatching { api.fetchOutstandingInvoices() }.getOrDefault(emptyList())
                val bill = bills.firstOrNull { it.id == req.invoiceId }
                if (bill != null) {
                    local.value = local.value.copy(mode = CheckoutMode.LIST, bills = bills)
                    collectOn(bill, req.amountCents)
                }
                // Consume either way: a bill already settled (or a failed fetch) must not leave
                // the pad springing open on the next unrelated visit to Checkout.
                collectBus.consume()
            }
        }
    }

    /** The pad's confirm button: split allocation, collect on an invoice, or settle the cart. */
    fun confirm() {
        val s = local.value
        // The server has to check and debit the balance NOW — points queued for later replay
        // would be trusting a number that may no longer be true. Say so plainly and stop,
        // rather than fall through to captureOffline and fail on a generic network error
        // that doesn't explain why.
        if (s.pointsAppliedCents > 0 && !connectivity.online.value) {
            local.value = s.copy(error = "Points need a connection to check the balance — take them off to pay offline.")
            return
        }
        when {
            // Points applied means TWO tenders — the points and whatever covers the rest —
            // so it takes the same road a split does, whether or not the split UI is open.
            s.splitMode || s.pointsAppliedCents > 0 -> recordSplit()
            s.collect != null -> recordCollect()
            else -> record()
        }
    }

    /**
     * Commit the SPLIT allocation: one tender per non-zero row. Walk-in → issue once then
     * record each; collect → record each against the bill. The receipt is rebuilt from the
     * server invoice, so it shows every tender line.
     */
    private fun recordSplit() {
        val s = state.value
        // Points-with-a-single-method comes through here too, and satisfies canRecord
        // rather than splitCanRecord — the split grid is not open in that case.
        if (s.busy) return
        if (if (s.splitMode) !s.splitCanRecord else !s.canRecord) return
        val bill = s.collect
        // Points lead, so the ledger is debited before the rest of the money lands and a
        // half-finished settle can never leave cash taken against points that were not.
        val pointsTender = s.pointsAppliedCents.takeIf { it > 0 }?.let {
            mu.carfection.pos.core.data.Tender(method = PayMethod.POINTS, amountCents = it)
        }
        // One tender per method that has money on it, in a stable order (idempotency keys are
        // per-index, so the same allocation always maps to the same keys on a retry).
        val rest = if (s.splitMode) {
            SPLIT_METHODS.mapNotNull { m ->
                s.splitCents(m).takeIf { it > 0 }?.let { cents ->
                    mu.carfection.pos.core.data.Tender(
                        method = m,
                        amountCents = cents,
                        tenderedCents = if (m == PayMethod.CASH) cents else null, // split rows are exact
                        ref = if (m == PayMethod.CASH) null else "POS",
                    )
                }
            }
        } else {
            listOfNotNull(
                s.payCents.takeIf { it > 0 }?.let { cents ->
                    mu.carfection.pos.core.data.Tender(
                        method = s.method,
                        amountCents = cents,
                        tenderedCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else null,
                        ref = if (s.method == PayMethod.CASH) null else s.refText.ifBlank { "POS" },
                    )
                },
            )
        }
        val allTenders = listOfNotNull(pointsTender) + rest
        if (allTenders.isEmpty()) return
        if (canCaptureOffline(s)) { captureOffline(s, allTenders); return }
        val anyCash = allTenders.any { it.method == PayMethod.CASH }
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val result = if (bill != null) {
                    sales.collectSplit(bill.id, bill.number, allTenders, s.till?.id, saleKey)
                } else {
                    sales.completeSaleSplit(
                        cart = s.cart, tenders = allTenders, customerId = s.customerId, walkInName = s.customerText,
                        cashSessionId = s.till?.id, saleKey = saleKey,
                        basketMode = s.basketMode, basketPct = s.basketPct, basketAmtCents = s.basketAmtCents,
                        comment = s.comment, discountReason = s.discountReason, knownInvoiceId = s.pendingSettle?.invoiceId,
                    )
                }
                // Rebuild the slip from the server invoice — it now carries every tender row.
                val receipt = runCatching {
                    api.fetchInvoice(result.invoiceId)?.let {
                        // The ledger's own earn row for THIS document — best-effort, like
                        // ticketNo/terminalNo elsewhere: a failed read costs the slip a line,
                        // never the sale (already committed by this point).
                        val pointsEarned = runCatching { api.pointsEarnedForDocument(result.invoiceId) }.getOrNull()
                        saleReceiptDoc(
                            it, catalog.receiptBiz(), catalog.vatDefault().toInt(),
                            pointsEarned = pointsEarned, pointsBalanceAfter = it.customers?.pointsBalance,
                        ).copy(isPayment = bill != null)
                    }
                }.getOrNull()
                launch {
                    val printed = receipt != null && runCatching { printer.printDoc(receipt) }.isSuccess
                    if (anyCash) runCatching { drawer.kick() }
                    logReceiptOutcome(result.number, printed, result.invoiceId)
                }
                local.value = local.value.copy(
                    busy = false, padOpen = false, collect = null, pendingSettle = null,
                    splitMode = false, splitText = emptyMap(),
                    done = result.copy(fromCollect = bill != null, debtor = bill?.customers?.name),
                    receipt = receipt,
                )
                loadLists()
            } catch (e: Exception) {
                local.value = local.value.withSettleFailure(e)
            }
        }
    }

    private fun recordCollect() {
        val s = state.value
        val bill = s.collect ?: return
        if (!s.canRecord || s.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                // Credit on a collect: the customer takes the balance on their account. Record no
                // payment — the invoice simply stays outstanding (their receivable, on the
                // statement). Show the slip with what it was for, stamped "on account".
                if (s.method == PayMethod.CREDIT) {
                    // The handover happens NOW: the bill's READY job moves to delivered, on
                    // account. If the server refuses, the collect fails loudly — printing paper
                    // for a handover the server never saw is how a car leaves while its job
                    // sits at READY forever (the original bug).
                    try {
                        // On account is still the bill leaving the counter, so it is still the
                        // moment it becomes a real invoice. deliver_on_account refuses a draft
                        // outright — and rightly: you cannot owe money on a document that was
                        // never issued.
                        if (bill.status == "draft") api.issueDocument(bill.id, "$saleKey:issue", sessionId = s.till?.id)
                        api.deliverOnAccount(bill.id)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        local.value = local.value.copy(busy = false, error = "Couldn't record the handover — ${e.message ?: "try again"}")
                        return@launch
                    }
                    val creditSlip = runCatching {
                        api.fetchInvoice(bill.id)?.let {
                            saleReceiptDoc(it, catalog.receiptBiz(), catalog.vatDefault().toInt())
                                // A deposit on the bill makes the builder read it as a payment
                                // slip — this slip records credit, whatever came before.
                                .copy(isPayment = true, onAccount = true)
                        }
                    }.getOrNull()
                    launch {
                        val printed = creditSlip != null && runCatching { printer.printDoc(creditSlip) }.isSuccess
                        logReceiptOutcome(bill.number, printed, bill.id)
                    }
                    local.value = local.value.copy(
                        busy = false, padOpen = false, collect = null, pendingSettle = null,
                        done = SaleResult(bill.id, bill.number, s.dueCents, 0L, onAccount = true,
                            fromCollect = true, debtor = bill.customers?.name),
                        receipt = creditSlip,
                    )
                    loadLists()
                    return@launch
                }
                val result = sales.collectOnInvoice(
                    invoiceId = bill.id,
                    number = bill.number,
                    amountCents = s.payCents, // a deposit or a part payment, not always the lot
                    method = s.method,
                    tenderCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else null,
                    externalRef = s.refText,
                    cashSessionId = s.till?.id,
                    payKey = saleKey,
                    needsIssue = bill.status == "draft",
                )
                // The bill's items live on the server — the counter never held them, so this
                // slip carried a total and nothing else: the customer paid Rs 38,000 and the
                // paper never said what for. Rebuild it from the invoice that was just paid,
                // through the same builder the job screen and the reprint use, so all three
                // agree. If the line is down, fall back to the bare total — a slip without
                // items still beats no slip at all.
                val receipt = runCatching {
                    api.fetchInvoice(bill.id)?.let {
                        val pointsEarned = runCatching { api.pointsEarnedForDocument(bill.id) }.getOrNull()
                        saleReceiptDoc(
                            it, catalog.receiptBiz(), catalog.vatDefault().toInt(),
                            pointsEarned = pointsEarned, pointsBalanceAfter = it.customers?.pointsBalance,
                        ).copy(isPayment = true)
                    }
                }.getOrNull() ?: ReceiptDoc(
                    biz = catalog.receiptBiz(),
                    invoiceNo = bill.number,
                    dateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm")),
                    cashier = session.userName,
                    customer = bill.customers?.name ?: "Walk-in",
                    lines = emptyList(),
                    subtotalCents = s.dueCents, vatRatePct = catalog.vatDefault().toInt(),
                    vatCents = 0L, discountCents = 0L, totalCents = s.dueCents,
                    payLabel = s.method.label,
                    paidCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else s.payCents,
                    changeCents = s.changeCents,
                    onAccount = false, isPayment = true,
                    balanceDueCents = s.balanceAfterCents,
                )
                launch {
                    val printed = runCatching {
                        printer.printDoc(receipt) // instant payment slip
                    }.isSuccess
                    if (s.method == PayMethod.CASH) runCatching { drawer.kick() }
                    logReceiptOutcome(bill.number, printed, bill.id)
                }
                local.value = local.value.copy(
                    busy = false, padOpen = false, collect = null, pendingSettle = null,
                    done = result.copy(fromCollect = true, debtor = bill.customers?.name), receipt = receipt,
                )
                loadLists()
            } catch (e: Exception) {
                // A collect that reached record_payment may have committed; freeze exactly like a
                // walk-in settle so the retry replays under the same key instead of re-charging.
                local.value = local.value.withSettleFailure(e)
            }
        }
    }

    /** Re-reads the device's session; the `till.current` collector in `init` applies it. */
    /**
     * Which till is open. Asks the server, and falls back to the one this device last knew
     * was open — offline that question has no other answer, and a counter that doesn't know
     * its till refuses every payment, which is precisely when offline selling is needed.
     */
    fun refreshTill() = viewModelScope.launch {
        runCatching { till.restoreCached() }
        runCatching { till.openSession() }
    }

    // ── cart ──────────────────────────────────────────────────────────────────
    /**
     * The search box is also the barcode scanner's landing strip (the small checkout
     * tablet drives sales by scanner): a scanner is a keyboard that types the whole code
     * in one burst, so an EXACT barcode match rings the item straight into the cart and
     * clears the box — no tap, next scan ready. Typed text never equals a barcode, so
     * ordinary searching is untouched.
     */
    fun setQuery(q: String) {
        val code = q.trim()
        val hit = if (code.length >= 4) allProducts.firstOrNull { it.barcode == code } else null
        if (hit != null) {
            add(hit) // oversell prompt and settle-freeze rules apply exactly as a tap would
            local.value = local.value.copy(query = "", notice = "Scanned — ${hit.name}")
        } else if (isDocumentRef(code)) {
            // A RECEIPT was scanned, not a product — the slip's barcode carries the document
            // number. Pull the whole sale back up instead of searching the catalogue for a
            // code no product will ever carry.
            openScannedDocument(code)
        } else {
            local.value = local.value.copy(query = q)
        }
    }

    /** Same landing strip inside the history sheet — scanning there opens the sale directly. */
    fun setHistoryQuery(q: String) {
        val code = q.trim()
        if (isDocumentRef(code)) openScannedDocument(code)
        else local.value = local.value.copy(historyQuery = q)
    }

    /**
     * Look a scanned/typed document reference up and show its slip.
     *
     * Read-only, so it is safe mid-sale: it never touches the cart, and the preview is
     * dismissible. A miss leaves the code in the box rather than swallowing it, so the
     * operator can see what was actually read off the paper.
     */
    fun openScannedDocument(code: String) {
        val ref = code.trim().uppercase()
        local.value = local.value.copy(query = "", historyQuery = "", notice = "Looking up $ref…")
        viewModelScope.launch {
            val doc = runCatching { api.fetchDocumentByNumber(ref) }.getOrNull()
            when {
                doc == null ->
                    local.value = local.value.copy(query = ref, notice = "No sale found for $ref")
                // A quote's reference can be printed too; rendering it as a paid slip would be a lie.
                doc.docType != "invoice" ->
                    local.value = local.value.copy(query = ref, notice = "$ref is a ${docKindLabel(doc.docType)}, not a sale")
                else -> {
                    viewHistoryReceipt(doc)
                    local.value = local.value.copy(notice = null)
                }
            }
        }
    }

    fun add(p: ProductEntity) {
        val target = (local.value.cart.firstOrNull { it.product.id == p.id }?.qty ?: 0.0) + 1
        if (needsOversellPrompt(p, target)) { local.value = local.value.copy(oversell = OversellPrompt(p, target)); return }
        mutateCart { cart ->
            val i = cart.indexOfFirst { it.product.id == p.id }
            if (i >= 0) cart.toMutableList().also { it[i] = it[i].copy(qty = it[i].qty + 1) }
            else cart + CartLine(p, 1.0)
        }
    }

    fun setQty(productId: String, qty: Double) {
        val cur = local.value.cart.firstOrNull { it.product.id == productId }
        if (cur != null && qty > cur.qty && needsOversellPrompt(cur.product, qty)) {
            local.value = local.value.copy(oversell = OversellPrompt(cur.product, qty)); return
        }
        mutateCart { cart ->
            if (qty <= 0) cart.filterNot { it.product.id == productId }
            else cart.map { if (it.product.id == productId) it.copy(qty = qty) else it }
        }
    }

    /** True when selling [targetQty] would drive stock negative and the cashier hasn't OK'd it yet. */
    private fun needsOversellPrompt(p: ProductEntity, targetQty: Double): Boolean {
        if (!p.isStocked) return false // services / ad-hoc lines don't track stock
        if (local.value.cart.firstOrNull { it.product.id == p.id }?.oversellOk == true) return false
        return (local.value.onHand[p.id] ?: 0) - targetQty < 0
    }

    /** "Sell anyway" — apply the held quantity and stop asking for this product this sale. */
    fun confirmOversell() {
        val o = local.value.oversell ?: return
        local.value = local.value.copy(oversell = null)
        mutateCart { cart ->
            val i = cart.indexOfFirst { it.product.id == o.product.id }
            if (i >= 0) cart.toMutableList().also { it[i] = it[i].copy(qty = o.targetQty, oversellOk = true) }
            else cart + CartLine(o.product, o.targetQty, oversellOk = true)
        }
    }

    fun dismissOversell() { local.value = local.value.copy(oversell = null) }

    /** Tap a cart line → open its qty/discount editor (one open at a time, like the quote builder). */
    fun toggleLine(productId: String) = mutateCart { cart ->
        cart.map { if (it.product.id == productId) it.copy(expanded = !it.expanded) else it.copy(expanded = false) }
    }

    fun setDiscount(productId: String, pct: Int) = mutateCart { cart ->
        cart.map { if (it.product.id == productId) it.copy(discountPct = pct) else it }
    }

    fun setLineDiscountMode(productId: String, mode: DiscountMode) = mutateCart { cart ->
        cart.map { if (it.product.id == productId) it.copy(discountMode = mode) else it }
    }

    fun setLineDiscountAmt(productId: String, text: String) = mutateCart { cart ->
        cart.map { if (it.product.id == productId) it.copy(discountAmtText = text.filter { c -> c.isDigit() || c == '.' }) else it }
    }

    // ── basket discount ─────────────────────────────────────────────────────────
    fun setBasketMode(mode: DiscountMode) {
        local.value = local.value.withBasket(mode, "")
    }

    fun setBasketText(text: String) {
        val s = local.value
        local.value = s.withBasket(s.basketMode, text.filter { c -> c.isDigit() || c == '.' })
    }

    /** Why — required once the discount reaches into a carwash allowance (Allowance.kt). */
    fun setDiscountReason(t: String) { local.value = local.value.copy(discountReason = t) }

    /**
     * Open/close the reason box from the payment pad.
     *
     * The ticket panel has an inline field, but by the time the pad is open that panel is
     * behind it — so the cashier read "a reason is required for a carwash discount", found
     * the pay button dead, and had no way forward without backing out of the sale. The
     * refusal now carries its own way out.
     */
    fun openReasonDialog() { local.value = local.value.copy(reasonDialogOpen = true) }
    fun closeReasonDialog() { local.value = local.value.copy(reasonDialogOpen = false) }

    // ── "Ask the owner" — the tablet's side of OwnerOverrideDialog.tsx (counter copy;
    // QuoteViewModel carries the quote/bill copy of the same machinery) ────────────────

    /** This sale's deterministic document id, stable for as long as the cart keeps the
     *  current saleKey. Named here rather than after Record payment, because the override
     *  has to exist BEFORE issue_document names the same id — see the class doc above. */
    private fun currentSaleRefId(): String = SaleRepository.draftIdFor(saleKey)

    fun askOwner() {
        val s = local.value
        val requested = s.allowance.actualCents
        local.value = s.copy(
            overrideOpen = true, overrideOwnerId = null, overridePin = "", overrideReason = "",
            overrideAmountText = if (requested > 0) centsToPlainText(requested) else "",
            overrideBusy = false, overrideError = null, overrideDone = false,
        )
        loadOverrideOwners()
    }

    /**
     * Fetch the owners who may approve. Re-fetched every time the dialog opens.
     *
     * This used to cache on first success and never try again — but an RLS-scoped read
     * that runs before the session context is ready returns an EMPTY LIST, not an error.
     * That empty list was cached as "loaded", so the picker had nothing in it, no error
     * to show, and the dialog sat on "Loading owners…" for the rest of the app's life.
     * The owner stood there, the cashier tapped Approve, and nothing happened.
     *
     * The query is two columns filtered on an index. It does not need caching.
     */
    private fun loadOverrideOwners() {
        // null = "loading" to the dialog; clearing it means reopening always retries
        // rather than showing whatever the last attempt left behind.
        local.value = local.value.copy(overrideOwners = null, overrideOwnersError = null)
        viewModelScope.launch {
            runCatching { api.fetchApprovingOwners() }
                .onSuccess { list -> local.value = local.value.copy(overrideOwners = list, overrideOwnersError = null) }
                .onFailure { e -> local.value = local.value.copy(overrideOwnersError = e.uiMessage()) }
        }
    }

    fun closeOverrideDialog() { local.value = local.value.copy(overrideOpen = false) }
    fun pickOverrideOwner(id: String) { local.value = local.value.copy(overrideOwnerId = id, overrideError = null) }
    fun setOverridePin(p: String) { local.value = local.value.copy(overridePin = p.filter(Char::isDigit).take(4), overrideError = null) }
    fun setOverrideReason(r: String) { local.value = local.value.copy(overrideReason = r) }
    fun setOverrideAmountText(t: String) { local.value = local.value.copy(overrideAmountText = t.filter { c -> c.isDigit() || c == '.' }) }

    fun submitOverride() {
        val s = local.value
        val ownerId = s.overrideOwnerId ?: return
        val cents = parseMoneyToCents(s.overrideAmountText)?.takeIf { it > 0 } ?: return
        if (s.overridePin.length != 4 || s.overrideReason.isBlank()) return
        val refId = currentSaleRefId()
        local.value = local.value.copy(overrideBusy = true, overrideError = null)
        viewModelScope.launch {
            val result = overrideApi.requestOverride(
                appUserId = ownerId, pin = s.overridePin, kind = "discount", refType = "document",
                refId = refId, reason = s.overrideReason.trim(), maxDiscountCents = cents,
            )
            // Win or lose, the PIN just typed has done its job — it is never held longer than
            // the one request it rode in on.
            local.value = local.value.copy(overridePin = "")
            when (result) {
                is OverrideOutcome.Approved -> {
                    local.value = local.value.copy(overrideBusy = false, overrideDone = true, approvedMaxCents = cents)
                    // Let the "approved" flourish be seen, then close on its own — mirrors the
                    // web dialog's 1.6s auto-close so the cashier isn't left clicking anything
                    // with the owner still standing there.
                    kotlinx.coroutines.delay(1600)
                    if (local.value.overrideDone) closeOverrideDialog()
                }
                is OverrideOutcome.PinRejected ->
                    local.value = local.value.copy(overrideBusy = false, overrideError = pinErrorCopy(result.reason))
                OverrideOutcome.NotOwner ->
                    local.value = local.value.copy(overrideBusy = false, overrideError = "That didn't check out as an owner — try again.")
                is OverrideOutcome.Failed ->
                    local.value = local.value.copy(overrideBusy = false, overrideError = result.message)
            }
        }
    }

    private fun mutateCart(f: (List<CartLine>) -> List<CartLine>) {
        val s = local.value
        val next = s.withCart(f(s.cart))
        // An emptied cart ends the ticket. Mint a fresh idempotency namespace so the next basket
        // can never replay this one's invoice.
        if (next.cart.isEmpty() && s.cart.isNotEmpty()) saleKey = UUID.randomUUID().toString()
        local.value = next
    }

    // ── customer ─────────────────────────────────────────────────────────────
    fun setCustomerText(t: String) {
        if (frozenBySettle()) return
        local.value = local.value.copy(customerText = t, customerId = null)
    }
    fun pickCustomer(c: CustomerEntity) {
        if (frozenBySettle()) return
        local.value = local.value.copy(customerText = c.name, customerId = c.id)
    }

    /**
     * Create a brand-new customer from the typed name and select them — for an on-account
     * (credit) sale to someone not in the book yet, right from the payment screen.
     */
    fun createCustomer(name: String) {
        if (frozenBySettle()) return
        val clean = name.trim()
        if (clean.isEmpty() || local.value.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching {
                val tenant = requireNotNull(catalog.tenantId()) { "Not synced yet — pull the catalogue first." }
                // Reuse an existing customer of the same name rather than minting a duplicate.
                api.findCustomerByName(clean)?.id ?: api.insertCustomer(NewCustomerDto(tenantId = tenant, name = clean)).id
            }.onSuccess { id ->
                runCatching { catalog.refresh() } // so the new customer shows in later searches
                local.value = local.value.copy(busy = false, customerText = clean, customerId = id, customerMatches = emptyList())
            }.onFailure { e ->
                local.value = local.value.copy(busy = false, error = e.uiMessage("Couldn't create the customer"))
            }
        }
    }


    /** Who the invoice bills is baked into the issued document, so it freezes with the basket. */
    private fun frozenBySettle(): Boolean {
        if (local.value.pendingSettle == null) return false
        local.value = local.value.copy(notice = SETTLE_LOCK_NOTICE)
        return true
    }

    // ── payment pad ──────────────────────────────────────────────────────────
    fun openPad() {
        if (local.value.cart.isEmpty()) { local.value = local.value.copy(error = "Add at least one product."); return }
        // A pending settle pins method/tender/ref to what the frozen request already sent — the
        // retry MUST replay identically, so reopening the pad must NOT reset them (the server
        // ignores a retry's arguments; a reset would print a receipt that lies about the tender).
        if (local.value.pendingSettle != null) { local.value = local.value.copy(padOpen = true, error = settleError()); return }
        local.value = local.value.copy(padOpen = true, method = PayMethod.CASH, tenderText = "", refText = "", payText = "", error = null, splitMode = false, splitText = emptyMap())
    }
    fun closePad() {
        val st = local.value
        if (st.pendingSettle != null) {
            if (st.collect != null) {
                // A frozen COLLECTION is safe to cancel: there is no basket to mis-ring —
                // the invoice lives on the server, so drop the freeze and re-read the list.
                // If the payment did commit despite the lost response, the refreshed
                // balance shows it (and the bill leaves TO COLLECT); the idempotency key
                // is never reused, so a later retry can only collect what remains.
                local.value = st.copy(
                    padOpen = false, collect = null, pendingSettle = null, error = null,
                    collectLines = emptyList(), collectJob = null, collectDetailFailed = false,
                    notice = "Collection cancelled — list refreshed",
                )
                loadLists()
                return
            }
            // A frozen WALK-IN keeps its context: the retry must replay the identical basket.
            local.value = st.copy(padOpen = false)
            return
        }
        local.value = st.copy(padOpen = false, collect = null, collectLines = emptyList(), collectJob = null, collectDetailFailed = false)
    }
    fun setMethod(m: PayMethod) { if (frozenBySettle()) return; local.value = local.value.copy(method = m, error = settleError()) }

    /**
     * Put the customer's points against this bill, or take them back off it.
     *
     * Applying only ARMS them — nothing is debited until Take. Doing it in one tap was
     * the alternative and was rejected: reversing a payment is owner-only since rule 3,
     * so a stray finger would need the owner to undo it.
     *
     * The typed amount is cleared either way, because what the chosen method has to
     * cover has just changed. Leaving it would show the old figure while payCents had
     * quietly coerced to the new ceiling.
     */
    fun toggleApplyPoints() {
        if (frozenBySettle()) return
        val s = local.value
        val applied = if (s.pointsAppliedCents > 0) 0L else s.pointsCapCents
        if (applied == 0L && s.pointsAppliedCents == 0L) return
        local.value = s.copy(
            pointsAppliedCents = applied,
            payText = "", tenderText = "", splitText = emptyMap(),
            error = null,
        )
    }

    // ── split bill: the allocation table ────────────────────────────────────────
    /** Open / close the split table. Turning it on clears any single-method entry. */
    fun toggleSplit() {
        if (frozenBySettle()) return
        val s = local.value
        local.value = if (s.splitMode) s.copy(splitMode = false, splitText = emptyMap(), error = null)
        else s.copy(splitMode = true, splitFocus = PayMethod.CASH, splitText = emptyMap(),
            payText = "", tenderText = "", refText = "", error = null)
    }

    /** Focus a method row so the numpad types into it. */
    fun setSplitFocus(m: PayMethod) { if (frozenBySettle()) return; local.value = local.value.copy(splitFocus = m) }

    /** Type into the focused split row (same numpad grammar as the pad). */
    fun splitPadKey(key: String) {
        if (frozenBySettle()) return
        val s = local.value
        val cur = s.splitText[s.splitFocus] ?: ""
        val next = when (key) {
            "⌫" -> cur.dropLast(1)
            "." -> if (cur.contains('.')) cur else if (cur.isEmpty()) "0." else "$cur."
            else -> {
                val (int, dec) = cur.split('.').let { it[0] to it.getOrNull(1) }
                when { dec != null && dec.length >= 2 -> cur; dec == null && int.length >= 7 -> cur; else -> cur + key }
            }
        }
        local.value = s.copy(splitText = s.splitText + (s.splitFocus to next))
    }

    /** Fill the focused row with whatever is still unallocated (the "Rest" shortcut). */
    fun fillSplitRest() {
        if (frozenBySettle()) return
        val s = local.value
        val already = SPLIT_METHODS.filter { it != s.splitFocus }.sumOf { s.splitCents(it) }
        val rest = (s.dueCents - already).coerceAtLeast(0)
        local.value = s.copy(splitText = s.splitText + (s.splitFocus to centsToText(rest)))
    }

    /** An unresolved settle keeps its message: it is the cashier's only instruction for getting out. */
    private fun settleError(): String? = local.value.error.takeIf { local.value.pendingSettle != null }
    fun setRef(t: String) { if (frozenBySettle()) return; local.value = local.value.copy(refText = t) }
    fun setComment(t: String) { if (frozenBySettle()) return; local.value = local.value.copy(comment = t) }
    private fun centsToText(cents: Long) =
        (cents / 100).toString() + if (cents % 100 != 0L) "." + (cents % 100).toString().padStart(2, '0') else ""

    fun setTenderCents(cents: Long) { if (frozenBySettle()) return; local.value = local.value.copy(tenderText = centsToText(cents)) }

    /**
     * Take part of the bill now and leave the rest owing — a deposit at booking, a customer
     * paying half today. Only a collect reaches here; a counter sale has no balance to carry.
     * Clearing the field means the whole balance again.
     */
    fun setPayCents(cents: Long?) {
        if (frozenBySettle()) return
        local.value = local.value.copy(
            payText = cents?.let { centsToText(it) } ?: "",
            tenderText = "", // the tender was for the old figure; re-open it at "exact"
        )
    }

    fun focusPad(f: PadField) { if (frozenBySettle()) return; local.value = local.value.copy(padField = f) }

    /** Spec numpad rules: digits append; one '.'; ≤2 decimals; ≤7 integer digits; ⌫ deletes. */
    fun padKey(key: String) {
        if (frozenBySettle()) return
        val st = local.value
        // Which field the keys type into. Non-cash has no tender to count out, so the keys
        // always mean the amount; cash types the tender unless the AMOUNT card is focused.
        // (This is method-driven now — a WALK-IN can type an amount too, for a split. The old
        // `collect != null` guard silently routed a walk-in's typed amount into the tender.)
        val onAmount = st.padField == PadField.AMOUNT || st.method != PayMethod.CASH
        val t = if (onAmount) st.payText else st.tenderText
        val next = when (key) {
            "⌫" -> t.dropLast(1)
            "." -> if (t.contains('.')) t else if (t.isEmpty()) "0." else "$t."
            else -> { // digit
                val (int, dec) = t.split('.').let { it[0] to it.getOrNull(1) }
                when {
                    dec != null && dec.length >= 2 -> t
                    dec == null && int.length >= 7 -> t
                    else -> t + key
                }
            }
        }
        local.value = if (onAmount) st.copy(payText = next, tenderText = "") else st.copy(tenderText = next)
    }

    // ── settle ───────────────────────────────────────────────────────────────
    private var saleKey = UUID.randomUUID().toString() // stable per sale; rotates on reset

    private fun canCaptureOffline(s: CounterUiState): Boolean =
        canCaptureOffline(s, connectivity.online.value)

    fun record() {
        val s = state.value
        if (!s.canRecord || s.busy) return
        if (canCaptureOffline(s)) {
            captureOffline(
                s,
                listOf(
                    Tender(
                        method = s.method,
                        amountCents = s.payCents,
                        tenderedCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else null,
                        ref = s.refText.trim().takeUnless { it.isEmpty() },
                    ),
                ),
            )
            return
        }
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val result = sales.completeSale(
                    cart = s.cart,
                    method = s.method,
                    tenderCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else null,
                    externalRef = s.refText,
                    customerId = s.customerId,
                    walkInName = s.customerText,
                    cashSessionId = s.till?.id,
                    saleKey = saleKey,
                    basketMode = s.basketMode,
                    basketPct = s.basketPct,
                    basketAmtCents = s.basketAmtCents,
                    comment = s.comment,
                    discountReason = s.discountReason,
                    // Retry of a settle that already issued: go straight to the payment.
                    knownInvoiceId = s.pendingSettle?.invoiceId,
                )
                // Sale is committed — printing/drawer are fire-and-forget (can never lose it).
                // Receipt mirrors the SAVED lines (incl. discount lines) in the studio's slip format.
                // Each row at the price the INVOICE carries — line discount applied, VAT added.
                // It used to print the undiscounted list price, so a slip for a line-discounted
                // sale listed items that did not add up to the TOTAL printed beneath them, and
                // contradicted the counter screen it was printed from.
                // Each row at FULL price in the "UP" column and at what it actually cost in
                // "Total", so the slip can spell out the saving line by line. The line's own
                // discount comes from the cart, never from `full − charged`: VAT rounds once
                // per line, so that subtraction is a cent adrift on plenty of UNdiscounted
                // lines and would print a phantom "Discount 0.01" under them.
                val itemLines = s.cart.mapIndexed { i, l ->
                    val charged = s.rowGrossCents(i)
                    val discounted = l.discountPct > 0 || (l.discountMode == DiscountMode.AMT && l.discountAmtCents > 0)
                    ReceiptLine(
                        title = l.product.name,
                        qty = l.qty,
                        inclCents = charged,
                        unitInclCents = grossCents(l.product.sellingPriceCents, l.product.vatRatePct),
                        grossInclCents = if (discounted) l.lineGrossCents else charged,
                        discountPct = if (l.discountMode == DiscountMode.PCT) l.discountPct.toDouble() else 0.0,
                    )
                }
                val subtotalIncl = itemLines.sumOf { it.grossInclCents }
                val receipt = ReceiptDoc(
                    biz = catalog.receiptBiz(),
                    invoiceNo = result.number,
                    dateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm:ss")),
                    cashier = session.userName,
                    customer = s.customerText.trim().ifBlank { "Walk-in" },
                    lines = itemLines,
                    subtotalCents = subtotalIncl,
                    vatRatePct = catalog.vatDefault().toInt(),
                    vatCents = s.totals.vatCents,
                    discountCents = (subtotalIncl - result.totalCents).coerceAtLeast(0), // Subtotal − Discount = Total
                    totalCents = result.totalCents,
                    payLabel = if (result.onAccount) null else s.method.label,
                    paidCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else result.totalCents,
                    changeCents = result.changeCents,
                    onAccount = result.onAccount,
                    vatGroups = s.docTotals.let {
                        listOf(ReceiptVatGroup(catalog.vatDefault(), it.subtotalCents, it.vatCents))
                    },
                )
                launch {
                    // "No. N" and "Appareil N" are looked up off the hot path: the sale is
                    // already committed, so a slow or failed lookup costs the slip a line,
                    // never the sale. Both return null rather than a wrong number.
                    val terminal = api.terminalNo(session.deviceId())
                    // Points earned + the running balance — gated on s.customerId, the
                    // cashier's OWN pick, never on whatever customer the sale actually
                    // resolved to: an untouched walk-in still bills to a real "Walk-in
                    // customer" row (issueWalkInInvoice) and must print exactly as it did
                    // before points existed.
                    val custId = s.customerId
                    val pointsEarned = if (custId != null) api.pointsEarnedForDocument(result.invoiceId) else null
                    val pointsBalanceAfter = custId?.let { api.customerPointsBalance(it) }
                    val stamped = receipt.copy(
                        ticketNo = s.till?.id?.let { api.sessionTicketNo(it, result.invoiceId) },
                        billNo = billRef(api.billNoFor(result.invoiceId), terminal),
                        terminalNo = terminal,
                        pointsEarned = pointsEarned,
                        pointsBalanceAfter = pointsBalanceAfter,
                    )
                    val printed = runCatching {
                        printer.printDoc(stamped) // prints the moment the sale completes
                    }.isSuccess
                    if (s.method == PayMethod.CASH) runCatching { drawer.kick() }
                    logReceiptOutcome(result.number, printed, result.invoiceId)
                }
                local.value = local.value.copy(busy = false, padOpen = false, done = result, receipt = receipt, pendingSettle = null)
            } catch (e: Exception) {
                local.value = local.value.withSettleFailure(e)
            }
        }
    }

    /**
     * Take a sale with no network: freeze it whole, print a provisional slip, and let the
     * replay give it its invoice when the tablet can reach the server again.
     *
     * The prices, the discounts and the tenders are frozen HERE, at the moment the customer
     * paid them — the catalogue will have re-synced by the time this lands, and the customer
     * does not owe tomorrow's price. Nothing here is optimistic: the slip prints only after
     * the sale is durably on disk, so a tablet that dies between the two has either a record
     * of the sale or no slip, never a slip with no record.
     */
    private fun captureOffline(s: CounterUiState, tenders: List<mu.carfection.pos.core.data.Tender>) {
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val tenant = catalog.tenantId()
                    ?: throw IllegalStateException("This tablet hasn't synced yet — it can't ring a sale offline.")
                val typed = s.customerText.trim()
                val label = typed.ifBlank { "Walk-in" }
                // Resolve against the CACHE, since the server can't be asked. An unknown name
                // gets an id minted here; inserting it at replay is safe because a second
                // attempt collides with the row the first one wrote.
                val cachedId = s.customerId
                    ?: allCustomers.firstOrNull { it.name.equals(typed.ifBlank { WALK_IN_CUSTOMER }, ignoreCase = true) }?.id
                val mintedId = if (cachedId == null) UUID.randomUUID().toString() else null
                val draft = expandSaleLines(s.cart, s.basketMode, s.basketPct, s.basketAmtCents, s.discountReason)

                val row = offlineSales.capture(
                    saleKey = saleKey,
                    tenantId = tenant,
                    deviceId = session.deviceId(),
                    cashSessionId = s.till?.id,
                    customerId = cachedId,
                    newCustomerId = mintedId,
                    newCustomerName = if (mintedId != null) typed.ifBlank { WALK_IN_CUSTOMER } else null,
                    customerLabel = label,
                    lines = draft.specs,
                    orderDiscountKind = draft.orderDiscountKind,
                    orderDiscountValue = draft.orderDiscountValue,
                    tenders = tenders,
                    totalCents = s.totals.totalCents,
                    changeCents = tenders.sumOf { t ->
                        if (t.method == PayMethod.CASH && t.tenderedCents != null)
                            (t.tenderedCents - t.amountCents).coerceAtLeast(0) else 0L
                    },
                    comment = s.comment.trim().takeUnless { it.isEmpty() },
                    discountReason = draft.discountReason,
                    // The replay may run under a different account (offline sign-in never
                    // mints tokens) — record who actually rang it.
                    operatorId = session.operatorId,
                    operatorName = session.userName,
                )

                val result = SaleResult(
                    invoiceId = "", // there is nothing on the server yet to point at
                    number = null,
                    totalCents = row.totalCents,
                    changeCents = row.changeCents,
                    onAccount = false,
                    offlineRef = row.localRef,
                )
                val receipt = offlineReceipt(s, row.localRef, row.totalCents, row.changeCents, tenders)
                // The record is on disk; paper and drawer are fire-and-forget from here.
                launch {
                    val printed = runCatching { printer.printDoc(receipt) }.isSuccess
                    if (tenders.any { it.method == PayMethod.CASH }) runCatching { drawer.kick() }
                    logReceiptOutcome(row.localRef, printed, null)
                }
                local.value = local.value.copy(
                    busy = false, padOpen = false, splitMode = false, splitText = emptyMap(),
                    done = result, receipt = receipt, pendingSettle = null,
                )
            } catch (e: Exception) {
                local.value = local.value.copy(busy = false, error = e.uiMessage("Couldn't save the sale on this tablet — don't take the money."))
            }
        }
    }

    /** The provisional slip: the sale exactly as it was rung, with no fiscal number claimed. */
    private suspend fun offlineReceipt(
        s: CounterUiState,
        localRef: String,
        totalCents: Long,
        changeCents: Long,
        tenders: List<mu.carfection.pos.core.data.Tender>,
    ): ReceiptDoc {
        val itemLines = s.cart.mapIndexed { i, l ->
            val charged = s.rowGrossCents(i)
            val discounted = l.discountPct > 0 || (l.discountMode == DiscountMode.AMT && l.discountAmtCents > 0)
            ReceiptLine(
                title = l.product.name,
                qty = l.qty,
                inclCents = charged,
                unitInclCents = grossCents(l.product.sellingPriceCents, l.product.vatRatePct),
                grossInclCents = if (discounted) l.lineGrossCents else charged,
                discountPct = if (l.discountMode == DiscountMode.PCT) l.discountPct.toDouble() else 0.0,
            )
        }
        val subtotalIncl = itemLines.sumOf { it.grossInclCents }
        return ReceiptDoc(
            biz = catalog.receiptBiz(),
            invoiceNo = null, // there is no fiscal number yet, and none may be invented
            offlineRef = localRef,
            dateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm:ss")),
            cashier = session.userName,
            customer = s.customerText.trim().ifBlank { "Walk-in" },
            lines = itemLines,
            subtotalCents = subtotalIncl,
            vatRatePct = catalog.vatDefault().toInt(),
            vatCents = s.totals.vatCents,
            discountCents = (subtotalIncl - totalCents).coerceAtLeast(0),
            totalCents = totalCents,
            payLabel = tenders.singleOrNull()?.method?.label ?: "Split",
            paidCents = totalCents + changeCents,
            changeCents = changeCents,
            onAccount = false,
            vatGroups = s.docTotals.let { listOf(ReceiptVatGroup(catalog.vatDefault(), it.subtotalCents, it.vatCents)) },
        )
    }

    fun newSale() {
        // Never discard an unresolved settle — it may hold a committed invoice under saleKey.
        if (local.value.pendingSettle != null) { local.value = local.value.copy(notice = SETTLE_LOCK_NOTICE); return }
        saleKey = UUID.randomUUID().toString()
        val cur = local.value
        local.value = CounterUiState(
            till = cur.till, mode = cur.mode, bills = cur.bills, paidToday = cur.paidToday,
            bizName = cur.bizName, bizAddress = cur.bizAddress, pricesInclVat = cur.pricesInclVat, // studio identity is not per-sale
        )
        refreshTill()
    }

    fun signOut() = viewModelScope.launch { session.signOut() }

    /**
     * Traceability: record whether the customer walked away with a printed slip
     * (Cashmag's "non édition d'une note"). Queued through the outbox, not fired
     * at the network: a sale must never fail on its audit trail, but the trail
     * must also never silently LOSE an event to a Wi-Fi blip — the owner reads
     * this history as fact. The enqueue is a local Room write (fast, offline-safe);
     * the outbox retries delivery until it lands.
     */
    // [documentId] is what receiptPrintCount later counts BY (ref_id) to print "Duplicata N" —
    // without it every reprint of this sale looks like the original.
    private fun logReceiptOutcome(number: String?, printed: Boolean, documentId: String?) {
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: return@launch
                outbox.enqueueAuditEvent(
                    tenantId = tenant,
                    eventType = if (printed) "receipt_printed" else "receipt_skipped",
                    deviceId = session.deviceId(),
                    payload = buildJsonObject { if (number != null) put("number", number) },
                    label = "Receipt trace · ${number ?: "sale"}",
                    refType = if (documentId != null) "invoice" else null,
                    refId = documentId,
                )
            }
        }
    }
}
