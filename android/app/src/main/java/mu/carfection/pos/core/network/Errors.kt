package mu.carfection.pos.core.network

import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * The message a person at the till may see. supabase-kt appends the full HTTP request to
 * its exception messages — URL, Authorization bearer token, apikey — and a photo of the
 * screen must never leak a live session. Keep only what comes before the request dump.
 */
fun Throwable.uiMessage(fallback: String = "Something went wrong — try again"): String {
    // The line is down. Opening a till, banking a float and cutting a Z all need the server,
    // so an outage surfaces here — and the raw text is a DNS failure naming the backend host,
    // which reads like the app is broken at exactly the moment the shop wants to trade.
    // Answered by exception TYPE, before the message is even read: a socket failure's wording
    // belongs to the operating system and is no basis for a pattern match.
    if (isConnectionFailure()) {
        return "You're offline — the tablet can't reach the server. Try again once the line is back."
    }
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
    return if (isAuthFailureMessage(raw)) {
        "Your sign-in looks expired — go to Settings, sign out and sign back in. If it keeps happening after that, tell the office."
    } else raw
}

/** The marks of a session that can no longer write, whatever the call was trying to do. */
internal fun isAuthFailureMessage(m: String): Boolean =
    m.contains("row-level security", ignoreCase = true) ||
        m.contains("JWT", ignoreCase = true) ||
        m.contains("invalid_grant", ignoreCase = true) ||
        m.contains("refresh_token", ignoreCase = true)

/**
 * Did this fail because of WHO is signed in, rather than because of the request?
 *
 * A session that cannot refresh keeps looking signed in — reads come off the local cache —
 * while every write is refused. That answer changes at the next sign-in and at no other
 * moment, so a queue must not spend its retry budget on it: doing so throws away good
 * writes for a reason that had nothing to do with them.
 */
fun Throwable.isSessionRefusal(): Boolean {
    val m = message ?: return false
    return isAuthFailureMessage(m) || m.contains("insufficient privileges", ignoreCase = true)
}

/**
 * Did this fail because the tablet could not reach the server at all?
 *
 * Ktor wraps the socket failure, so the answer is usually a level or two down the cause
 * chain. Only the transport exceptions count — a refusal the server actually SENT is a real
 * answer and must reach the operator in the server's own words.
 */
private fun Throwable.isConnectionFailure(): Boolean {
    var e: Throwable? = this
    var hops = 0
    while (e != null && hops++ < 8) { // a cause chain is never long, and must never loop
        if (e is UnknownHostException ||
            e is ConnectException ||
            e is SocketTimeoutException ||
            e is NoRouteToHostException
        ) return true
        e = e.cause
    }
    return false
}
