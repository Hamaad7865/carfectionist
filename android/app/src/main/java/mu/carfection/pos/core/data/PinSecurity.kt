package mu.carfection.pos.core.data

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Local PIN verification for the offline sign-in path.
 *
 * The server's bcrypt hash never leaves the server — the pos-auth function exists precisely
 * so the tablet can't hold the studio's PINs. What the tablet CAN hold is a verifier it
 * minted ITSELF: at a successful ONLINE sign-in the correct PIN is briefly in hand, and a
 * salted PBKDF2 digest of it is remembered. That verifier proves "this person has signed in
 * on this tablet before", which is exactly the population offline sign-in should admit.
 *
 * A 4-digit PIN has 10,000 possibilities, so the hash alone is not the defence — the
 * iteration count makes each guess cost real time, and [PinThrottle] makes guessing at the
 * keypad cost far more. The verifier lives in app-private storage; an attacker who can read
 * it owns the tablet already.
 */
object PinHasher {
    private const val ALGORITHM = "PBKDF2WithHmacSHA256"
    private const val ITERATIONS = 310_000
    private const val KEY_BITS = 256
    private const val SALT_BYTES = 16

    /** "pbkdf2:sha256:<iterations>:<salt b64>:<digest b64>" — self-describing, upgradeable. */
    fun hash(pin: String): String {
        val salt = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) }
        val dk = derive(pin, salt, ITERATIONS)
        val b64 = Base64.getEncoder()
        return "pbkdf2:sha256:$ITERATIONS:${b64.encodeToString(salt)}:${b64.encodeToString(dk)}"
    }

    /** Constant-time verification. A malformed stored verifier verifies nothing. */
    fun verify(pin: String, stored: String): Boolean {
        val parts = stored.split(":")
        if (parts.size != 5 || parts[0] != "pbkdf2" || parts[1] != "sha256") return false
        val iterations = parts[2].toIntOrNull() ?: return false
        if (iterations < 1) return false
        val salt = runCatching { Base64.getDecoder().decode(parts[3]) }.getOrNull() ?: return false
        val expected = runCatching { Base64.getDecoder().decode(parts[4]) }.getOrNull() ?: return false
        val actual = derive(pin, salt, iterations)
        return MessageDigest.isEqual(expected, actual)
    }

    private fun derive(pin: String, salt: ByteArray, iterations: Int): ByteArray =
        SecretKeyFactory.getInstance(ALGORITHM)
            .generateSecret(PBEKeySpec(pin.toCharArray(), salt, iterations, KEY_BITS))
            .encoded
}

/**
 * Keypad rate limiting for offline verification — the job the server's lockout does online.
 *
 * Pure arithmetic over (consecutive fails, when the last one happened) so it can be tested
 * without clocks or storage: under [FREE_ATTEMPTS] fails nothing locks; from then on each
 * fail doubles the wait, capped at [MAX_LOCK_MS]. A success clears the count.
 */
object PinThrottle {
    const val FREE_ATTEMPTS = 5
    private const val BASE_LOCK_MS = 60_000L
    private const val MAX_LOCK_MS = 15 * 60_000L

    /** How much longer the keypad stays locked, or 0 when a try is allowed. */
    fun lockRemainingMs(fails: Int, lastFailAtMs: Long, nowMs: Long): Long {
        if (fails < FREE_ATTEMPTS) return 0
        val exponent = (fails - FREE_ATTEMPTS).coerceAtMost(20) // 2^20 already far past the cap
        val lock = (BASE_LOCK_MS shl exponent).coerceAtMost(MAX_LOCK_MS)
        return (lastFailAtMs + lock - nowMs).coerceAtLeast(0)
    }
}
