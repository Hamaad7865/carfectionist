package mu.carfection.pos.core.network

/**
 * The message a person at the till may see. supabase-kt appends the full HTTP request to
 * its exception messages — URL, Authorization bearer token, apikey — and a photo of the
 * screen must never leak a live session. Keep only what comes before the request dump.
 */
fun Throwable.uiMessage(fallback: String = "Something went wrong — try again"): String {
    val raw = message
        ?.substringBefore("URL:")
        ?.substringBefore("Headers:")
        ?.trim()?.trimEnd(',')?.trim()
        ?.ifBlank { null }
        ?: return fallback
    // A session that could not refresh keeps LOOKING signed in (reads come off the local
    // cache), so the first server write is where it surfaces — as a row-level-security or
    // JWT rejection. That text means nothing at the till and reads like a data bug; what
    // actually happened is the sign-in died. Say that, and say the way out.
    val authDead = raw.contains("row-level security", ignoreCase = true) ||
        raw.contains("JWT", ignoreCase = true) ||
        raw.contains("invalid_grant", ignoreCase = true) ||
        raw.contains("refresh_token", ignoreCase = true)
    return if (authDead) {
        "Your sign-in looks expired — go to Settings, sign out and sign back in. If it keeps happening after that, tell the office."
    } else raw
}
