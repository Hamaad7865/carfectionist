package mu.carfection.pos.feature.dash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.PosApi
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import mu.carfection.pos.core.network.StockProductDto
import mu.carfection.pos.core.network.uiMessage
import mu.carfection.pos.feature.stock.DEFAULT_LOW_THRESHOLD
import mu.carfection.pos.feature.stock.MAX_LOW_THRESHOLD
import javax.inject.Inject
import kotlin.math.roundToInt
import kotlin.math.roundToLong

private val MU = ZoneOffset.ofHours(4)

data class Kpi(val label: String, val value: String, val sub: String, val accent: Boolean = false, val warn: Boolean = false)
/** A stocked item under its reorder level — the shop-floor alert on the dashboard. */
data class LowStockRow(val name: String, val category: String, val onHand: Int, val threshold: Int)
data class TopSeller(val name: String, val value: String, val pct: Int)
data class TechRow(val init: String, val name: String, val jobs: String, val hours: String, val rev: String, val pct: Int)
data class MixRow(val label: String, val value: String, val pct: Int, val colorArgb: Long)

data class DashData(
    val kpis: List<Kpi> = emptyList(),
    val lowStock: List<LowStockRow> = emptyList(),
    val lowCount: Int = 0,
    val top: List<TopSeller> = emptyList(),
    val techs: List<TechRow> = emptyList(),
    val mix: List<MixRow> = emptyList(),
    val split: List<MixRow> = emptyList(),
)

data class DashState(val loading: Boolean = true, val data: DashData = DashData(), val error: String? = null)

@HiltViewModel
class DashViewModel @Inject constructor(private val api: PosApi) : ViewModel() {
    private val _s = MutableStateFlow(DashState())
    val state = _s.asStateFlow()

    init { load() }

    private fun compact(cents: Long): String {
        val r = cents / 100.0
        return if (r >= 1000) "Rs " + (Math.round(r / 100.0) / 10.0).let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() } + "k" else "Rs " + r.roundToLong()
    }
    private fun muDay(iso: String): LocalDate? = runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(MU).toLocalDate() }.getOrNull()
    private fun cents(r: Double): Long = rupeesToCents(r)

    fun load() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
            runCatching {
                val today = LocalDate.now(MU)
                val sevenAgoIso = today.minusDays(6).atStartOfDay(MU).toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                coroutineScope {
                    val payments = async { api.fetchPaymentsSince(sevenAgoIso) }
                    val open = async { api.fetchOpenInvoices() }
                    val paid = async { api.fetchPaidInvoicesWithLines(sevenAgoIso) }
                    val jobs = async { api.fetchJobs() }
                    val techs = async { api.fetchTechnicians() }
                    // Stock for the low-stock alert — counted at the selling floor, the same
                    // location the Stock screen adjusts, so both screens report the same number.
                    val stock = async {
                        runCatching {
                            val prods = api.fetchStockProducts()
                            val oh = api.fetchStockOnHand(api.fetchShopLocationId())
                                .groupBy { it.productId }
                                .mapValues { (_, rows) -> rows.sumOf { it.qtyOnHand }.roundToInt() }
                            prods to oh
                        }.getOrDefault(emptyList<StockProductDto>() to emptyMap())
                    }
                    build(today, payments.await(), open.await(), paid.await(), jobs.await(), techs.await(), stock.await())
                }
            }.onSuccess { d -> _s.update { it.copy(loading = false, data = d) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.uiMessage()) } }
        }
    }

    private fun build(
        today: LocalDate,
        payments: List<mu.carfection.pos.core.network.PaymentRowDto>,
        open: List<mu.carfection.pos.core.network.OpenInvoiceDto>,
        paid: List<mu.carfection.pos.core.network.PaidInvoiceDto>,
        jobs: List<JobBoardDto>,
        technicians: List<mu.carfection.pos.core.network.TechnicianDto>,
        stock: Pair<List<StockProductDto>, Map<String, Int>>,
    ): DashData {
        // ── payments: today turnover, 7-day bars, mix ──
        val payByDay = payments.groupBy { muDay(it.receivedAt) }
        val turnoverToday = (payByDay[today] ?: emptyList()).sumOf { cents(it.amount) }
        val paymentsTodayCount = (payByDay[today] ?: emptyList()).size

        // ── mix today ──
        // Points are a tender and belong here. mixTotal already sums EVERY method taken, so
        // omitting the points row did not merely hide a line — it made the percentages stop
        // adding up to 100 on the owner's own dashboard, with nothing to say why.
        val MC = mapOf(
            "cash" to 0xFF1FA361L, "card" to 0xFF2A6FDBL, "juice" to 0xFFC17A00L,
            "bank_transfer" to 0xFF7C5CE8L, "points" to 0xFF9B59B6L,
        )
        val labels = mapOf(
            "cash" to "Cash", "card" to "Card", "juice" to "Juice (MCB)",
            "bank_transfer" to "Bank transfer", "points" to "Points",
        )
        val mixMap = (payByDay[today] ?: emptyList()).groupBy { it.method }.mapValues { (_, ps) -> ps.sumOf { cents(it.amount) } }
        val mixTotal = mixMap.values.sum().coerceAtLeast(1L)
        // The four cash-like methods always show, so the card keeps its shape on a quiet
        // day. Anything else — points today, whatever is added later — joins only once it
        // has actually been taken, rather than silently skewing the split.
        val CORE = listOf("cash", "card", "juice", "bank_transfer")
        val mix = (CORE + mixMap.keys.filterNot { it in CORE }.sorted()).map { m ->
            val v = mixMap[m] ?: 0L
            MixRow(labels[m] ?: m, formatMUR(v), (v * 100 / mixTotal).toInt(), MC[m] ?: 0xFF8494A3L)
        }

        // ── outstanding ──
        val outstanding = open.sumOf { (cents(it.totalIncl) - cents(it.amountPaid)).coerceAtLeast(0) }

        // ── counter vs workshop (today) ──
        // Same rule as the web dashboard: workshop is work done to a car, whether
        // or not there was paperwork. A service rung up at the till with no job
        // card still counts — only the paperwork is missing, not the work.
        val todaysInvoices = paid.filter { it.issuedAt?.let { at -> muDay(at) == today } == true }
        val workshopCents = todaysInvoices.filter { it.isWorkshop }.sumOf { cents(it.totalIncl) }
        val counterCents = todaysInvoices.filterNot { it.isWorkshop }.sumOf { cents(it.totalIncl) }
        val splitTotal = (workshopCents + counterCents).coerceAtLeast(1L)
        val split = listOf(
            MixRow("Workshop", formatMUR(workshopCents), (workshopCents * 100 / splitTotal).toInt(), 0xFF7C5CE8L),
            MixRow("Counter", formatMUR(counterCents), (counterCents * 100 / splitTotal).toInt(), 0xFF2A6FDBL),
        )

        // ── jobs ──
        val jobsDone = jobs.count { it.status == "delivered" }
        val inProgress = jobs.count { it.status == "in_progress" }

        // ── best sellers (paid invoice service lines, 7d) ──
        val sellerMap = LinkedHashMap<String, Long>()
        paid.forEach { inv -> inv.lines.forEach { l ->
            val line = (l.qty * l.unitPrice * (1.0 - l.discountPct / 100.0))
            sellerMap[l.title] = (sellerMap[l.title] ?: 0L) + cents(line)
        } }
        val topSorted = sellerMap.entries.sortedByDescending { it.value }.take(5)
        val topMax = (topSorted.firstOrNull()?.value ?: 0L).coerceAtLeast(1L)
        val top = topSorted.map { TopSeller(it.key, compact(it.value), Math.max(4, (it.value * 100 / topMax).toInt())) }

        // ── technicians (jobs done, hours, revenue via job_id) ──
        val revByJob = paid.filter { it.jobId != null }.groupBy { it.jobId }.mapValues { (_, invs) -> invs.sumOf { cents(it.totalIncl) } }
        val jobById = jobs.associateBy { it.id }
        val techRows = technicians.map { u ->
            val theirs = jobs.filter { it.technicianId == u.id }
            val done = theirs.count { it.status == "delivered" }
            val secs = theirs.sumOf { elapsedSecs(it) }
            val rev = revByJob.filterKeys { jid -> jobById[jid]?.technicianId == u.id }.values.sum()
            Triple(u, Triple(done, secs, rev), theirs.size)
        }
        val revMax = (techRows.maxOfOrNull { it.second.third } ?: 0L).coerceAtLeast(1L)
        val techRowsOut = techRows.map { (u, stats, _) ->
            val (done, secs, rev) = stats
            val name = u.displayName.replace(Regex("\\s*\\(.*\\)$"), "").trim().split(" ").firstOrNull().orEmpty()
            TechRow(
                init = name.take(1).uppercase(),
                name = name,
                jobs = "$done ${if (done == 1) "job" else "jobs"} done",
                hours = "${Math.round(secs / 360.0) / 10.0} h",
                rev = formatMUR(rev),
                pct = Math.max(2, (rev * 100 / revMax).toInt()),
            )
        }

        // ── low stock — the same rule the Stock screen counts by, so both agree ──
        val (stockProducts, onHand) = stock
        val lowAll = stockProducts.mapNotNull { p ->
            val have = onHand[p.id] ?: 0
            val threshold = (p.lowStockThreshold ?: DEFAULT_LOW_THRESHOLD).coerceAtMost(MAX_LOW_THRESHOLD)
            if (have < threshold) LowStockRow(p.name, p.category ?: "—", have, threshold.roundToInt()) else null
        }.sortedWith(compareBy({ it.onHand }, { it.name })) // emptiest shelf first
        val outCount = lowAll.count { it.onHand == 0 }

        val kpis = listOf(
            Kpi("TURNOVER TODAY", formatMUR(turnoverToday), "$paymentsTodayCount payment${if (paymentsTodayCount == 1) "" else "s"} settled", accent = true),
            Kpi("OUTSTANDING", formatMUR(outstanding), "${open.size} unpaid invoice${if (open.size == 1) "" else "s"}", warn = outstanding > 0),
            Kpi("JOBS COMPLETED", jobsDone.toString(), "$inProgress in progress now"),
            Kpi("LOW STOCK", lowAll.size.toString(), if (outCount > 0) "$outCount out of stock" else "below reorder level", warn = lowAll.isNotEmpty()),
        )
        return DashData(kpis, lowAll.take(30), lowAll.size, top, techRowsOut, mix, split)
    }

    private fun elapsedSecs(j: JobBoardDto): Long {
        val start = runCatching { OffsetDateTime.parse(j.startedAt).toInstant().toEpochMilli() }.getOrNull() ?: return 0
        val end = when (j.status) {
            "in_progress" -> System.currentTimeMillis()
            else -> runCatching { OffsetDateTime.parse(j.readyAt).toInstant().toEpochMilli() }.getOrNull()
                ?: runCatching { OffsetDateTime.parse(j.deliveredAt).toInstant().toEpochMilli() }.getOrNull() ?: return 0
        }
        return ((end - start) / 1000).coerceAtLeast(0)
    }
}
