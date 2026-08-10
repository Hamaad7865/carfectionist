package mu.carfection.pos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.network.UserNameDto
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentLine
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary

/**
 * "Ask the owner" — the tablet's way out of a blocked discount, same wording and the same
 * round trip through /api/override as the web's OwnerOverrideDialog.tsx. An owner picks their
 * name, types their OWN PIN, states why, and confirms how much of this discount they are
 * approving. Nobody is signed out and nobody becomes an owner — the PIN is checked
 * server-side, and this screen never holds it any longer than the one request it rides in on.
 *
 * Purely presentational, the same way QuoteCustomerPicker reads/drives QuoteState rather than
 * owning state of its own: every field and action is hoisted to the caller's ViewModel
 * (QuoteViewModel for the quote and for its bill — two separate documents, two separate
 * approvals — CounterViewModel for the counter), so one dialog serves all three blocked paths
 * without knowing which one it is.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OwnerOverrideDialog(
    /** "quote" | "bill" | "sale" — only used in the copy. */
    docLabel: String,
    /** The discount currently requested, VAT-inclusive cents — computeAllowance's actualCents.
     *  Shown as the "cashier is asking for…" hint; [amountText] is the editable figure. */
    requestedCents: Long,
    /** Active owners of this tenant. Null = still loading. */
    owners: List<UserNameDto>?,
    ownersError: String?,
    ownerId: String?,
    /** Masked as it's typed; the caller clears this the instant a submit resolves either way. */
    pin: String,
    reason: String,
    /** Rs, as typed — "Approve up to". Prefilled from [requestedCents] when the dialog opens;
     *  the owner may raise or lower it before approving. */
    amountText: String,
    busy: Boolean,
    error: String?,
    /** The PIN was accepted — a brief "Approved" flourish before the caller auto-closes this. */
    done: Boolean,
    onPickOwner: (String) -> Unit,
    onPinChange: (String) -> Unit,
    onReasonChange: (String) -> Unit,
    onAmountChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onSubmit: () -> Unit,
) {
    val parsedCents = parseMoneyToCents(amountText)
    val canSubmit = !busy && ownerId != null && pin.length == 4 && reason.isNotBlank() && parsedCents != null && parsedCents > 0

    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.width(460.dp).background(CardBg, RoundedCornerShape(20.dp))
                .border(1.dp, Hairline, RoundedCornerShape(20.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Ask the owner", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 1.sp)
            Text(
                "Approve this discount on the $docLabel — needs an owner's PIN.",
                color = TextSecondary, fontFamily = Barlow, fontSize = 13.sp, lineHeight = 18.sp,
            )

            when {
                done -> Column(
                    Modifier.fillMaxWidth().padding(vertical = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.size(52.dp).background(Success.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) {
                        Text("✓", color = Success, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 24.sp)
                    }
                    Text("Approved", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text(
                        "Up to ${formatMUR(parsedCents ?: 0)} is now allowed on this $docLabel.",
                        color = TextSecondary, fontFamily = Barlow, fontSize = 12.5.sp, lineHeight = 17.sp,
                    )
                }
                // Checked BEFORE the loading state: on a failed fetch, owners stays null forever
                // (only a success sets it), so checking owners == null first would read a real
                // failure as "still loading" and hang here silently.
                ownersError != null -> Text(ownersError, color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp)
                owners == null -> Row(
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(vertical = 10.dp),
                ) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Accent)
                    Text("Loading owners…", color = TextMuted, fontFamily = Barlow, fontSize = 13.sp)
                }
                owners.isEmpty() -> Text(
                    "No active owner is set up on this account yet.",
                    color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp,
                )
                else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Field("APPROVING OWNER") {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            owners.forEach { o ->
                                val on = o.id == ownerId
                                Row(
                                    Modifier.height(40.dp)
                                        .background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(20.dp))
                                        .border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(20.dp))
                                        .clickable { onPickOwner(o.id) }.padding(start = 6.dp, end = 13.dp),
                                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
                                ) {
                                    Box(Modifier.size(28.dp).background(if (on) Accent else Color(0xFFBAC4CE), CircleShape), contentAlignment = Alignment.Center) {
                                        Text(o.displayName.take(1).uppercase(), color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                                    }
                                    Text(o.displayName, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                }
                            }
                        }
                    }
                    // PIN — masked, never logged, cleared by the caller the instant it's used.
                    Field("OWNER'S PIN") {
                        FilledInput(
                            value = pin, onValueChange = { onPinChange(it.filter(Char::isDigit).take(4)) },
                            placeholder = "••••", modifier = Modifier.width(140.dp), height = 44.dp, bg = InsetAlt,
                            masked = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        )
                    }
                    Field("REASON") {
                        FilledInput(
                            value = reason, onValueChange = onReasonChange,
                            placeholder = "e.g. loyal customer, matching a competitor's price",
                            modifier = Modifier.fillMaxWidth(), height = 40.dp, bg = InsetAlt, fontSize = 12.5.sp,
                        )
                    }
                    Field("APPROVE UP TO", hint = "The cashier is asking for ${formatMUR(requestedCents)} off this $docLabel.") {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Rs", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(end = 8.dp))
                            FilledInput(
                                value = amountText, onValueChange = { onAmountChange(it.filter { c -> c.isDigit() || c == '.' }) },
                                placeholder = "0", modifier = Modifier.width(140.dp), height = 40.dp, bg = InsetAlt,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            )
                        }
                    }
                    error?.let { Text(it, color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp) }
                }
            }

            if (!done) {
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Box(
                        Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp))
                            .clickable(enabled = !busy, onClick = onDismiss),
                        contentAlignment = Alignment.Center,
                    ) { Text("Cancel", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
                    Box(
                        Modifier.weight(1.2f).height(50.dp).background(if (canSubmit) Accent else InsetAlt, RoundedCornerShape(13.dp))
                            .clickable(enabled = canSubmit, onClick = onSubmit),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (busy) "Checking…" else "Approve",
                            color = if (canSubmit) AccentInk else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Field(label: String, hint: String? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, letterSpacing = 1.2.sp)
        content()
        hint?.let { Text(it, color = TextMuted, fontFamily = Barlow, fontSize = 11.sp) }
    }
}
