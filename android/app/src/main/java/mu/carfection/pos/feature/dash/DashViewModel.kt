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
import java.time.format.TextStyle
import java.util.Locale
import javax.inject.Inject
import kotlin.math.roundToInt
import kotlin.math.roundToLong

private val MU = ZoneOffset.ofHours(4)

data class Kpi(val label: String, val value: String, val sub: String, val accent: Boolean = false, val warn: Boolean = false)
data class Bar(val label: String, val value: String, val heightPct: Int, val today: Boolean)
data class TopSeller(val name: String, val value: String, val pct: Int)
data class TechRow(val init: String, val name: String, val jobs: String, val hours: String, val rev: String, val pct: Int)
data class MixRow(val label: String, val value: String, val pct: Int, val colorArgb: Long)

data class DashData(
    val kpis: List<Kpi> = emptyList(),
    val bars: List<Bar> = emptyList(),
    val top: List<TopSeller> = emptyList(),
    val techs: List<TechRow> = emptyList(),
    val mix: List<MixRow> = emptyList(),
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
                    build(today, payments.await().let { it }, open.await(), paid.await(), jobs.await(), techs.await())
                }
            }.onSuccess { d -> _s.update { it.copy(loading = false, data = d) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.message) } }
        }
    }

    private fun build(
        today: LocalDate,
        payments: List<mu.carfection.pos.core.network.PaymentRowDto>,
        open: List<mu.carfection.pos.core.network.OpenInvoiceDto>,
        paid: List<mu.carfection.pos.core.network.PaidInvoiceDto>,
        jobs: List<JobBoardDto>,
        technicians: List<mu.carfection.pos.core.network.TechnicianDto>,
    ): DashData {
        // ── payments: today turnover, 7-day bars, mix ──
        val payByDay = payments.groupBy { muDay(it.receivedAt) }
        val turnoverToday = (payByDay[today] ?: emptyList()).sumOf { cents(it.amount) }
        val paymentsTodayCount = (payByDay[today] ?: emptyList()).size

        val bars = (6 downTo 0).map { d ->
            val day = today.minusDays(d.toLong())
            val sum = (payByDay[day] ?: emptyList()).sumOf { cents(it.amount) }
            val label = if (d == 0) "Today" else day.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)
            Triple(label, sum, d == 0)
        }
        val barMax = (bars.maxOfOrNull { it.second } ?: 0L).coerceAtLeast(1L)
        val barRows = bars.map { (label, sum, isToday) -> Bar(label, compact(sum), Math.max(3, (sum * 100 / barMax).toInt()), isToday) }

        // ── mix today ──
        val MC = mapOf("cash" to 0xFF1FA361L, "card" to 0xFF2A6FDBL, "juice" to 0xFFC17A00L, "bank_transfer" to 0xFF7C5CE8L)
        val labels = mapOf("cash" to "Cash", "card" to "Card", "juice" to "Juice (MCB)", "bank_transfer" to "Bank transfer")
        val mixMap = (payByDay[today] ?: emptyList()).groupBy { it.method }.mapValues { (_, ps) -> ps.sumOf { cents(it.amount) } }
        val mixTotal = mixMap.values.sum().coerceAtLeast(1L)
        val mix = listOf("cash", "card", "juice", "bank_transfer").map { m ->
            val v = mixMap[m] ?: 0L
            MixRow(labels[m] ?: m, formatMUR(v), (v * 100 / mixTotal).toInt(), MC[m] ?: 0xFF8494A3L)
        }

        // ── outstanding ──
        val outstanding = open.sumOf { (cents(it.totalIncl) - cents(it.amountPaid)).coerceAtLeast(0) }

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

        val kpis = listOf(
            Kpi("TURNOVER TODAY", formatMUR(turnoverToday), "$paymentsTodayCount payment${if (paymentsTodayCount == 1) "" else "s"} settled", accent = true),
            Kpi("GROSS PROFIT (EST.)", formatMUR((turnoverToday * 0.62).roundToLong()), "est. 62% blended margin"),
            Kpi("OUTSTANDING", formatMUR(outstanding), "${open.size} unpaid invoice${if (open.size == 1) "" else "s"}", warn = outstanding > 0),
            Kpi("JOBS COMPLETED", jobsDone.toString(), "$inProgress in progress now"),
        )
        return DashData(kpis, barRows, top, techRowsOut, mix)
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
