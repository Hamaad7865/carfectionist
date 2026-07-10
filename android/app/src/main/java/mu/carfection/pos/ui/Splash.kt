package mu.carfection.pos.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import mu.carfection.pos.R
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.Condensed

private val SplashBlack = Color(0xFF0B0D0F) // the logo's native ground (brand tile colour)
private val BrandGold = Color(0xFFCDA85F)
private val Ivory = Color(0xFFF3EFE6)

/**
 * Launch animation: the gold Carfectionist mark scales in on its black ground with a soft
 * glow that breathes once, the wordmark's letter-spacing settles beneath it, then the whole
 * overlay lens-fades out to reveal the app. Rendered on top of the real content so session
 * restore happens behind it.
 */
@Composable
fun SplashOverlay(onDone: () -> Unit) {
    val logoAlpha = remember { Animatable(0f) }
    val logoScale = remember { Animatable(0.62f) }
    val glow = remember { Animatable(0f) }
    val wordAlpha = remember { Animatable(0f) }
    val trackingSp = remember { Animatable(14f) } // wordmark letter-spacing settles 14 → 5
    val subAlpha = remember { Animatable(0f) }
    val out = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        launch { logoAlpha.animateTo(1f, tween(420, easing = LinearOutSlowInEasing)) }
        launch { logoScale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow)) }
        launch {
            delay(230)
            glow.animateTo(1f, tween(550, easing = FastOutSlowInEasing))
            glow.animateTo(0.45f, tween(650, easing = FastOutSlowInEasing))
        }
        delay(380)
        launch { wordAlpha.animateTo(1f, tween(520)) }
        launch { trackingSp.animateTo(5f, tween(680, easing = FastOutSlowInEasing)) }
        delay(430)
        launch { subAlpha.animateTo(1f, tween(420)) }
        delay(950)
        out.animateTo(1f, tween(420, easing = FastOutSlowInEasing))
        onDone()
    }

    Box(
        Modifier
            .fillMaxSize()
            .graphicsLayer {
                alpha = 1f - out.value
                val s = 1f + 0.05f * out.value
                scaleX = s; scaleY = s
            }
            .background(SplashBlack)
            // swallow taps so nothing beneath is pressed mid-animation
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(22.dp)) {
            Box(contentAlignment = Alignment.Center) {
                // soft gold breath behind the mark
                Box(
                    Modifier
                        .size(360.dp)
                        .alpha(glow.value)
                        .background(
                            Brush.radialGradient(
                                0f to BrandGold.copy(alpha = 0.26f),
                                0.55f to BrandGold.copy(alpha = 0.07f),
                                1f to Color.Transparent,
                            ),
                        ),
                )
                Image(
                    painterResource(R.drawable.logo_carfectionist),
                    contentDescription = "Carfectionist",
                    modifier = Modifier
                        .size(190.dp)
                        .graphicsLayer {
                            alpha = logoAlpha.value
                            scaleX = logoScale.value; scaleY = logoScale.value
                        },
                )
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(9.dp)) {
                androidx.compose.material3.Text(
                    "CARFECTIONIST",
                    fontFamily = Condensed,
                    fontWeight = FontWeight.Bold,
                    fontSize = 34.sp,
                    letterSpacing = trackingSp.value.sp,
                    color = Ivory,
                    modifier = Modifier.alpha(wordAlpha.value),
                )
                androidx.compose.material3.Text(
                    "HELVETIA · MAURITIUS",
                    fontFamily = Barlow,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp,
                    letterSpacing = 3.2.sp,
                    color = BrandGold.copy(alpha = 0.85f),
                    modifier = Modifier.alpha(subAlpha.value),
                )
            }
        }
    }
}
