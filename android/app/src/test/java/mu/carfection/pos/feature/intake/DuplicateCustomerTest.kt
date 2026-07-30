package mu.carfection.pos.feature.intake

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Whether two records are the same person.
 *
 * There is no unique index on a customer — only on a vehicle's plate — so making the same person
 * twice has always simply worked, and only their car was refused. Staff then got past the refusal
 * by typing a plate that was not real, which is how a live job ended up on a duplicate record
 * (two "Yan Toinette", four "Lucas Lutchmoodoo"). This is the check that has to catch it first.
 */
class DuplicateCustomerTest {

    /** Mirrors PosApi.findExistingCustomer's matching: exact phone, or the name ignoring case and spacing. */
    private data class Cust(val id: String, val name: String, val phone: String?)

    private fun squash(s: String) = s.trim().lowercase().replace(Regex("\\s+"), " ")

    private fun match(hits: List<Cust>, name: String, phone: String?): Cust? {
        val p = phone?.trim()?.takeIf { it.isNotBlank() }
        return hits.firstOrNull { it.phone?.trim() == p && p != null }
            ?: hits.firstOrNull { squash(it.name) == squash(name) }
    }

    private val onFile = listOf(
        Cust("1", "Yan Toinette", "52609090"),
        Cust("2", "Lucas Lutchmoodoo", null),
    )

    @Test
    fun `the same phone is the same person, whatever the name looks like`() {
        assertEquals("1", match(onFile, "Yan Toinete", "52609090")?.id)
    }

    /** The real case: name and phone retyped identically two minutes apart. */
    @Test
    fun `retyping the same name and phone is caught`() {
        assertEquals("1", match(onFile, "Yan Toinette", "52609090")?.id)
    }

    @Test
    fun `casing and stray spaces do not make a new person`() {
        assertEquals("1", match(onFile, "  yan   toinette ", null)?.id)
    }

    @Test
    fun `a name match counts even with no phone on file`() {
        assertEquals("2", match(onFile, "lucas lutchmoodoo", "59991234")?.id)
    }

    /** Two genuinely different people must still both be creatable. */
    @Test
    fun `a different name and a different phone is a new customer`() {
        assertNull(match(onFile, "Yannick Baptiste", "57771234"))
    }

    /** A blank phone must not match every record that also has no phone. */
    @Test
    fun `a blank phone is not a match on its own`() {
        assertNull(match(listOf(Cust("3", "Someone Else", null)), "New Person", ""))
    }
}
