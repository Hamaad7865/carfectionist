package mu.carfection.pos.core.network

/**
 * The message a person at the till may see. supabase-kt appends the full HTTP request to
 * its exception messages — URL, Authorization bearer token, apikey — and a photo of the
 * screen must never leak a live session. Keep only what comes before the request dump.
 */
fun Throwable.uiMessage(fallback: String = "Something went wrong — try again"): String =
    message
        ?.substringBefore("URL:")
        ?.substringBefore("Headers:")
        ?.trim()?.trimEnd(',')?.trim()
        ?.ifBlank { null }
        ?: fallback
