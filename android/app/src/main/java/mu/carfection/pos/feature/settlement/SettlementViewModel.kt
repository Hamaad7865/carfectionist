package mu.carfection.pos.feature.settlement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.data.SaleRepository
import mu.carfection.pos.core.data.TillRepository
import mu.carfection.pos.core.data.consolidatedReceiptDoc
import mu.carfection.pos.core.data.saleReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptPrinter
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.pointsValueCents
import mu.carfection.pos.core.network.AccountInvoiceDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.uiMessage
import mu.carfection.pos.core.sync.ConnectivityObserver
import java.util.UUID
import javax.inject.Inject

data class SettlementState(
    val loading: Boolean = true,
    val error: String? = null,
    val invoices: List<AccountInvoiceDto> = emptyList(), // raw shop-wide fetch
    val openCustomerId: String? = null,
    val checked: Set<String> = emptySet(),
    val method: PayMethod = PayMethod.CASH,
    val pointsApplied: Boolean = false,
    val pointsText: String = "",
    val tenderedText: String = "",
    val ref: String = "",
    val busy: Boolean = false,
    val submitError: String? = null,
    val submitSuccess: String? = null,
    /** Non-empty once a settlement has just completed — the screen shows these instead of the
     *  picker until [SettlementViewModel.dismissReceipts] is called. One entry when a single
     *  invoice was settled; several, one per invoice, when it was a multi-invoice settlement. */
    val completedReceipts: List<ReceiptDoc> = emptyList(),
)

/**
 * Settle several of a customer's open invoices in one action — points (if any) then a chosen
 * method, walked oldest-first via [planSettlement] and applied one [SaleRepository.collectSplit]
 * call per invoice. Direct Kotlin sibling of the web's SettleAccountPanel/settleAccountAction;
 * see docs/superpowers/specs/2026-08-22-account-settlement-design.md.
 *
 * Deliberately online-only, same restriction the till already places on a points tender
 * ([mu.carfection.pos.feature.counter.CounterViewModel] line ~1044): this avoids layering a
 * multi-invoice loop on top of the offline outbox/replay machinery built for the single-sale
 * counter checkout, which is a separate, larger subsystem this feature does not need to touch.
 */
@HiltViewModel
class SettlementViewModel @Inject constructor(
    private val api: PosApi,
    private val saleRepo: SaleRepository,
    private val tillRepo: TillRepository,
    private val connectivity: ConnectivityObserver,
    private val printer: ReceiptPrinter,
    private val catalog: CatalogRepository,
) : ViewModel() {
    private val _s = MutableStateFlow(SettlementState())
    val state = _s.asStateFlow()

    val pointValueRupees = catalog.pointValueRupeesFlow.stateIn(viewModelScope, SharingStarted.Eagerly, 1.0)
    val pointsEnabled = catalog.pointsEnabledFlow.stateIn(viewModelScope, SharingStarted.Eagerly, true)

    /** Not fetched from init: this ViewModel is Activity-scoped and outlives the screen being
     *  on/off screen, so a stale first load would never refresh on a later visit. The screen
     *  calls this itself from a LaunchedEffect(Unit) every time it (re)enters composition —
     *  same pattern CounterScreen uses for loadLists(). */
    fun load() {
        _s.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { api.fetchAccountInvoices() }
                .onSuccess { rows -> _s.update { it.copy(loading = false, invoices = rows) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.uiMessage()) } }
        }
    }

    private fun refresh() {
        viewModelScope.launch {
            runCatching { api.fetchAccountInvoices() }.onSuccess { rows -> _s.update { it.copy(invoices = rows) } }
        }
    }

    fun openCustomer(id: String) = _s.update {
        it.copy(
            openCustomerId = id, checked = emptySet(), method = PayMethod.CASH, pointsApplied = false,
            pointsText = "", tenderedText = "", ref = "", submitError = null, submitSuccess = null,
        )
    }
    fun closeCustomer() = _s.update { it.copy(openCustomerId = null) }

    fun toggleInvoice(id: String) = _s.update {
        it.copy(checked = if (id in it.checked) it.checked - id else it.checked + id, submitError = null, submitSuccess = null)
    }

    private fun openInvoicesOf(st: SettlementState): List<SettleableInvoice> =
        settleableInvoices(st.invoices).filter { it.customerId == st.openCustomerId }

    fun selectAll() {
        val open = openInvoicesOf(_s.value)
        _s.update { it.copy(checked = open.map { i -> i.id }.toSet()) }
    }

    fun setMethod(m: PayMethod) = _s.update { it.copy(method = m, tenderedText = "", ref = "", submitError = null) }
    fun setTendered(v: String) = _s.update { it.copy(tenderedText = v, submitError = null) }
    fun setRef(v: String) = _s.update { it.copy(ref = v, submitError = null) }

    private fun pointsCapCents(st: SettlementState): Long {
        val selected = openInvoicesOf(st).filter { it.id in st.checked }
        val totalDueCents = selected.sumOf { it.outstandingCents }
        if (!pointsEnabled.value || selected.isEmpty()) return 0
        return minOf(totalDueCents, pointsValueCents(selected.first().customerPointsBalance, pointValueRupees.value))
    }

    fun togglePoints() {
        val st = _s.value
        val cap = pointsCapCents(st)
        val next = !st.pointsApplied
        _s.update { it.copy(pointsApplied = next, pointsText = if (next) "%.2f".format(cap / 100.0) else "", tenderedText = "") }
    }

    fun setPointsText(v: String) = _s.update { it.copy(pointsText = v, tenderedText = "") }

    fun submit() {
        val st = _s.value
        val open = openInvoicesOf(st)
        val selected = open.filter { it.id in st.checked }
        if (selected.isEmpty()) { _s.update { it.copy(submitError = "Select at least one invoice.") }; return }
        if (!connectivity.online.value) {
            _s.update { it.copy(submitError = "Account settlement needs a connection — try again once you're back online.") }
            return
        }
        val till = tillRepo.current.value
        if (till == null) { _s.update { it.copy(submitError = "Open the till before settling an account.") }; return }

        val totalDueCents = selected.sumOf { it.outstandingCents }
        val pointsAppliedCents = if (st.pointsApplied) {
            (parseMoneyToCents(st.pointsText) ?: 0L).coerceIn(0, pointsCapCents(st))
        } else 0L
        val methodDueCents = (totalDueCents - pointsAppliedCents).coerceAtLeast(0)

        var tenderedCents = parseMoneyToCents(st.tenderedText)
        if (methodDueCents > 0) {
            if (st.method == PayMethod.CASH) {
                tenderedCents = tenderedCents ?: methodDueCents
                if (tenderedCents < methodDueCents) { _s.update { it.copy(submitError = "Tendered is less than the amount due.") }; return }
            } else if (st.ref.isBlank()) {
                _s.update { it.copy(submitError = "A card / Juice / bank payment needs a reference.") }
                return
            }
        }

        val legs = planSettlement(selected, pointsAppliedCents, st.method, if (methodDueCents > 0) tenderedCents else null)
            .map { leg ->
                if (leg.tender.method != PayMethod.CASH && leg.tender.method != PayMethod.POINTS) {
                    leg.copy(tender = leg.tender.copy(ref = st.ref.trim()))
                } else leg
            }

        // planSettlement always emits one invoice's legs consecutively — group them so a whole
        // invoice's tenders go in one collectSplit call, and succeed together before the next.
        val groups = mutableListOf<Pair<String, MutableList<mu.carfection.pos.core.data.Tender>>>()
        for (leg in legs) {
            val last = groups.lastOrNull()
            if (last != null && last.first == leg.invoiceId) last.second.add(leg.tender)
            else groups.add(leg.invoiceId to mutableListOf(leg.tender))
        }

        _s.update { it.copy(busy = true, submitError = null, submitSuccess = null) }
        viewModelScope.launch {
            val settleKey = UUID.randomUUID().toString()
            var settledCount = 0
            var settledCents = 0L
            for ((invoiceId, tenders) in groups) {
                val inv = selected.first { it.id == invoiceId }
                try {
                    saleRepo.collectSplit(invoiceId, inv.number, tenders, till.id, "$settleKey-$invoiceId")
                    settledCount += 1
                    settledCents += tenders.sumOf { it.amountCents }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val plural = if (selected.size == 1) "" else "s"
                    _s.update {
                        it.copy(
                            busy = false,
                            submitError = "Settled $settledCount of ${selected.size} invoice$plural (${formatMUR(settledCents)}). " +
                                "Failed on ${inv.number ?: invoiceId}: ${e.uiMessage()}",
                        )
                    }
                    refresh()
                    return@launch
                }
            }
            // Every invoice settled — rebuild each one's slip from what the server now stores
            // (same "one builder" saleReceiptDoc every other collect uses), so the screen and
            // the printer show exactly the same thing. Built here, awaited, so the UI can
            // display it immediately; the ACTUAL print below stays fire-and-forget, same
            // invariant every other collect in this app follows (a printer failure can never
            // lose a sale that already committed above).
            val settledIds = groups.map { it.first }
            val perInvoice = settledIds.mapNotNull { invoiceId ->
                runCatching {
                    api.fetchInvoice(invoiceId)?.let { h ->
                        val pointsEarned = runCatching { api.pointsEarnedForDocument(invoiceId) }.getOrNull()
                        saleReceiptDoc(
                            h, catalog.receiptBiz(), catalog.vatDefault().toInt(),
                            pointsEarned = pointsEarned, pointsBalanceAfter = h.customers?.pointsBalance,
                        ).copy(isPayment = true)
                    }
                }.getOrNull()
            }
            // One invoice settled prints exactly like an ordinary collect-on-invoice slip.
            // Several are folded into ONE consolidated receipt — every invoice's own lines and
            // tax under its own number, one combined tax breakdown, grand total and tender
            // list — rather than several separate slips.
            val receipt = if (perInvoice.size > 1) consolidatedReceiptDoc(perInvoice) else perInvoice.firstOrNull()
            printReceipt(receipt)

            val plural = if (settledCount == 1) "" else "s"
            _s.update {
                it.copy(
                    busy = false, submitSuccess = "Settled $settledCount invoice$plural for ${formatMUR(settledCents)}.",
                    checked = emptySet(), pointsApplied = false, pointsText = "", tenderedText = "", ref = "",
                    completedReceipts = listOfNotNull(receipt),
                )
            }
            refresh()
        }
    }

    private fun printReceipt(receipt: ReceiptDoc?) {
        if (receipt == null) return
        viewModelScope.launch { runCatching { printer.printDoc(receipt) } }
    }

    /** "Print again" on the just-settled screen — re-sends the same slip already shown. */
    fun reprint() = printReceipt(_s.value.completedReceipts.firstOrNull())

    /** Back from the just-settled screen to the customer-balance list. */
    fun dismissReceipts() = _s.update {
        it.copy(completedReceipts = emptyList(), openCustomerId = null, submitSuccess = null)
    }
}
