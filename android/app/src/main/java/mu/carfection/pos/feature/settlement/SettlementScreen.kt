package mu.carfection.pos.feature.settlement

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.FilterChip
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.pointsValueCents
import mu.carfection.pos.core.money.rupeesToCents

@Composable
fun SettlementScreen(onBack: () -> Unit, viewModel: SettlementViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    val pointValueRupees by viewModel.pointValueRupees.collectAsState()
    val pointsEnabled by viewModel.pointsEnabled.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() } // refresh every time Settlement is (re)opened

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (s.openCustomerId != null) viewModel.closeCustomer() else onBack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Text("SETTLE ACCOUNT", style = MaterialTheme.typography.titleLarge)
        }

        when {
            s.loading -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator() }
            s.error != null -> Text(s.error ?: "", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
            s.openCustomerId == null -> CustomerBalanceList(customerBalances(settleableInvoices(s.invoices)), onPick = viewModel::openCustomer)
            else -> SettleInvoicesPanel(
                invoices = settleableInvoices(s.invoices).filter { it.customerId == s.openCustomerId },
                state = s,
                pointValueRupees = pointValueRupees,
                pointsEnabled = pointsEnabled,
                vm = viewModel,
            )
        }
    }
}

@Composable
private fun CustomerBalanceList(balances: List<CustomerBalance>, onPick: (String) -> Unit) {
    if (balances.isEmpty()) {
        Text("No customer owes anything right now.", modifier = Modifier.padding(24.dp))
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(balances, key = { it.customerId }) { b ->
            Card(Modifier.fillMaxWidth()) {
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(b.customerName, style = MaterialTheme.typography.titleMedium)
                        Text("Owes", style = MaterialTheme.typography.bodySmall)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(formatMUR(b.outstandingCents), style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = { onPick(b.customerId) }) { Text("Settle") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettleInvoicesPanel(
    invoices: List<SettleableInvoice>,
    state: SettlementState,
    pointValueRupees: Double,
    pointsEnabled: Boolean,
    vm: SettlementViewModel,
) {
    val selected = invoices.filter { it.id in state.checked }
    val totalDueCents = selected.sumOf { it.outstandingCents }
    val pointsCapCents = if (pointsEnabled && selected.isNotEmpty())
        minOf(totalDueCents, pointsValueCents(selected.first().customerPointsBalance, pointValueRupees))
    else 0L
    val pointsAppliedCents = if (state.pointsApplied) {
        (parseCents(state.pointsText) ?: 0L).coerceIn(0, pointsCapCents)
    } else 0L
    val methodDueCents = (totalDueCents - pointsAppliedCents).coerceAtLeast(0)

    LazyColumn(Modifier.fillMaxSize().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${invoices.size} open invoice${if (invoices.size == 1) "" else "s"}", style = MaterialTheme.typography.labelLarge)
                TextButton(onClick = vm::selectAll) { Text("Select all") }
            }
        }
        items(invoices, key = { it.id }) { inv ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = inv.id in state.checked, onCheckedChange = { vm.toggleInvoice(inv.id) })
                Text(inv.number ?: "—", modifier = Modifier.weight(1f))
                Text(inv.issueDate ?: "—", modifier = Modifier.padding(end = 12.dp))
                Text(formatMUR(inv.outstandingCents))
            }
        }

        if (selected.isNotEmpty()) {
            item { Divider(Modifier.padding(vertical = 8.dp)) }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Total due", style = MaterialTheme.typography.titleMedium)
                    Text(formatMUR(totalDueCents), style = MaterialTheme.typography.titleMedium)
                }
            }
            if (pointsCapCents > 0) {
                item {
                    FilterChip(
                        selected = state.pointsApplied,
                        onClick = vm::togglePoints,
                        label = { Text(if (state.pointsApplied) "${formatMUR(pointsAppliedCents)} in points applied" else "Apply loyalty points") },
                    )
                }
                if (state.pointsApplied) {
                    item {
                        OutlinedTextField(
                            value = state.pointsText, onValueChange = vm::setPointsText,
                            label = { Text("Points to use (Rs)") }, modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(PayMethod.CASH, PayMethod.CARD, PayMethod.JUICE, PayMethod.BANK).forEach { m ->
                        FilterChip(selected = state.method == m, onClick = { vm.setMethod(m) }, label = { Text(m.label) })
                    }
                }
            }
            item { Text("Amount due: ${formatMUR(methodDueCents)}") }
            if (state.method == PayMethod.CASH) {
                item {
                    OutlinedTextField(
                        value = state.tenderedText, onValueChange = vm::setTendered,
                        label = { Text("Tendered (Rs)") }, modifier = Modifier.fillMaxWidth(),
                    )
                }
                val tendered = parseCents(state.tenderedText)
                if (tendered != null) item { Text("Change: ${formatMUR((tendered - methodDueCents).coerceAtLeast(0))}") }
            } else if (methodDueCents > 0) {
                item {
                    OutlinedTextField(
                        value = state.ref, onValueChange = vm::setRef,
                        label = { Text("External reference") }, modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            state.submitError?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
            state.submitSuccess?.let { item { Text(it, color = MaterialTheme.colorScheme.primary) } }

            item {
                Button(onClick = vm::submit, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (state.busy) "Settling…" else "Settle ${formatMUR(totalDueCents)}")
                }
            }
        }
    }
}

private fun parseCents(text: String): Long? {
    val cleaned = text.trim().replace(",", "")
    if (cleaned.isEmpty()) return null
    val value = cleaned.toDoubleOrNull() ?: return null
    return rupeesToCents(value)
}
