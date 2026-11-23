package mu.carfection.pos.feature.stock

import androidx.compose.runtime.Composable

// Carfectionist keeps its classic stock grid: the tyre centre's stock screen lives only in the
// tyrecentre flavor (src/tyrecentre/.../TyreStock.kt). This stub is never called here.

internal const val TYRE_STOCK = false

@Composable
internal fun TyreStock(s: StockState, vm: StockViewModel) = Unit
