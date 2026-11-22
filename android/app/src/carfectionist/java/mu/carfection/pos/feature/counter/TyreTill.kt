package mu.carfection.pos.feature.counter

import androidx.compose.runtime.Composable

// Carfectionist keeps its own checkout: the tyre centre's Till and Paid screens live only in the
// tyrecentre flavor (src/tyrecentre/.../TyreTill.kt). These stubs are never called here.

internal const val TYRE_TILL = false

@Composable
internal fun TyreTill(s: CounterUiState, vm: CounterViewModel, onOpenTill: () -> Unit) = Unit

@Composable
internal fun TyreCustomLineDialog(s: CounterUiState, vm: CounterViewModel) = Unit

@Composable
internal fun TyrePaid(s: CounterUiState, vm: CounterViewModel) = Unit
