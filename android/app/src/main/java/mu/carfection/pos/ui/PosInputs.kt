package mu.carfection.pos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary

/** The handoff's flat filled input — a coloured box, no Material outline/label. */
@Composable
fun FilledInput(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    height: Dp = 48.dp,
    radius: Dp = 11.dp,
    bg: Color = CardBg,
    fontFamily: FontFamily = Barlow,
    fontSize: TextUnit = 15.sp,
    leadingSearch: Boolean = false,
    // A PIN field (OwnerOverrideDialog's "owner's PIN") masks what's typed and asks for
    // the numeric IME — everything else keeps the plain text field it always had.
    masked: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    // The keyboard's Enter key: with [onSubmit] it is "Done" and submits the form (pass it on
    // a form's last box); without it Enter jumps to the next box — see [rememberImeFlow].
    onSubmit: (() -> Unit)? = null,
    // Optional icon at the right edge inside the box (e.g. a picker button).
    trailing: (@Composable () -> Unit)? = null,
) {
    val shape = RoundedCornerShape(radius)
    val (imeOptions, imeActions) = rememberImeFlow(keyboardOptions, onSubmit, search = leadingSearch)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        textStyle = TextStyle(color = TextPrimary, fontFamily = fontFamily, fontSize = fontSize),
        cursorBrush = SolidColor(Accent),
        visualTransformation = if (masked) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = imeOptions,
        keyboardActions = imeActions,
        modifier = modifier.height(height).background(bg, shape).border(1.dp, Color(0x1F101A24), shape),
    ) { inner ->
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            if (leadingSearch) Icon(Icons.Default.Search, null, tint = TextMuted, modifier = Modifier.padding(start = 15.dp, end = 11.dp)) else Box(Modifier.padding(start = 14.dp))
            Box(Modifier.weight(1f).padding(end = if (trailing != null) 6.dp else 14.dp)) {
                // The field itself is single-line; the placeholder must be too, or a long
                // hint wraps and gets clipped by the fixed height (worse the larger the
                // staff's font scale). Truncate instead.
                if (value.isEmpty()) Text(
                    placeholder, color = TextMuted, fontFamily = fontFamily, fontSize = fontSize,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                inner()
            }
            if (trailing != null) Box(Modifier.padding(end = 6.dp)) { trailing() }
        }
    }
}

/**
 * Tablet keyboard flow, shared by every form: Enter moves to the next text box; on the last box
 * (the caller passes [onSubmit]) Enter saves — the save's own validation still decides. A box
 * with no next neighbour and no [onSubmit] just closes the keyboard. Search boxes show the
 * search key and close the keyboard (results are already live).
 */
@Composable
fun rememberImeFlow(
    base: KeyboardOptions = KeyboardOptions.Default,
    onSubmit: (() -> Unit)? = null,
    search: Boolean = false,
): Pair<KeyboardOptions, KeyboardActions> {
    val focus = LocalFocusManager.current
    val action = when {
        base.imeAction != ImeAction.Default && base.imeAction != ImeAction.Unspecified -> base.imeAction
        search -> ImeAction.Search
        onSubmit != null -> ImeAction.Done
        else -> ImeAction.Next
    }
    val actions = KeyboardActions(
        onNext = { if (!focus.moveFocus(FocusDirection.Next)) { focus.clearFocus(); onSubmit?.invoke() } },
        onDone = { focus.clearFocus(); onSubmit?.invoke() },
        onSearch = { focus.clearFocus() },
    )
    return base.copy(imeAction = action) to actions
}
