package mu.carfection.pos.core.hardware

import android.util.Log
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import mu.carfection.pos.core.data.SaleResult
import mu.carfection.pos.core.money.formatMUR
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Hardware seams. The tablet/printer/drawer/scanner are separate devices (models
 * TBD), so M1 ships log-only implementations behind these interfaces — the sale
 * logic never changes when the real DantSu ESC/POS transport lands.
 *
 * Invariant: the sale COMMITS BEFORE printing — a printer failure can never
 * lose a sale (callers must treat print/kick as fire-and-forget).
 */
interface ReceiptPrinter {
    suspend fun printReceipt(text: String)
}

interface CashDrawer {
    /** ESC p pulse via the printer, once wired. */
    suspend fun kick()
}

/** Plain-text receipt for M1 (preview/log). The ESC/POS ReceiptBuilder with
 *  golden-byte tests replaces the rendering when the printer model is known. */
object ReceiptText {
    fun forSale(tradingName: String, result: SaleResult, lines: List<Pair<String, Long>>): String = buildString {
        appendLine(tradingName.uppercase())
        appendLine("VAT INVOICE ${result.number ?: ""}")
        appendLine("-".repeat(32))
        lines.forEach { (name, cents) ->
            appendLine(name.take(22).padEnd(22) + formatMUR(cents).padStart(10))
        }
        appendLine("-".repeat(32))
        appendLine("TOTAL".padEnd(22) + formatMUR(result.totalCents).padStart(10))
        if (result.changeCents > 0) appendLine("CHANGE".padEnd(22) + formatMUR(result.changeCents).padStart(10))
        if (result.onAccount) appendLine("ON ACCOUNT — BALANCE DUE")
    }
}

@Singleton
class LogPrinter @Inject constructor() : ReceiptPrinter {
    override suspend fun printReceipt(text: String) {
        Log.i("POS-Printer", "\n$text")
    }
}

@Singleton
class LogDrawer @Inject constructor() : CashDrawer {
    override suspend fun kick() {
        Log.i("POS-Drawer", "kick! (ESC p once the printer is wired)")
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class HardwareModule {
    @Binds abstract fun printer(impl: LogPrinter): ReceiptPrinter
    @Binds abstract fun drawer(impl: LogDrawer): CashDrawer
}
