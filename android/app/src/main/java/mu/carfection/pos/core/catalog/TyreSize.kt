package mu.carfection.pos.core.catalog

import java.util.Locale

/**
 * Brand + tyre size (20261127000010): parsing, matching and the size↔brand summaries.
 *
 * Line-for-line mirror of the web's apps/web/src/lib/products/tyre-size.ts. Both are held to
 * apps/web/src/lib/products/tyre-size.fixture.json, which TyreSizeTest (JUnit) and
 * tyre-size.test.ts (vitest) each read — change one side and the other suite must still pass.
 */

/** A tyre size as the trade writes it: 205/55 R16 → width 205, profile 55, rim 16. */
data class TyreSize(val width: Int, val profile: Int, val rim: Double)

/** What someone typed into a size box: any part left out (null) matches everything. */
data class SizeQuery(val width: Int?, val profile: Int?, val rim: Double?) {
    val isSet: Boolean get() = width != null || profile != null || rim != null
}

data class TyreSpec(val size: TyreSize, val loadIndex: String?, val speedRating: String?)

/** One product for the summaries. qty = stock to count; null when it is not stocked. */
data class AttrItem(val brand: String?, val size: TyreSize?, val qty: Double?)

/** brand = the spelling most products use; "" (key "") = no brand recorded. */
data class BrandRow(val key: String, val brand: String, val products: Int, val qty: Double)

data class SizeRow(val size: TyreSize, val label: String, val products: Int, val qty: Double)

object TyreSizes {
    const val WIDTH_MIN = 125
    const val WIDTH_MAX = 355
    const val PROFILE_MIN = 25
    const val PROFILE_MAX = 95
    const val RIM_MIN = 10.0
    const val RIM_MAX = 24.0

    private fun okWidth(n: Int) = n in WIDTH_MIN..WIDTH_MAX
    private fun okProfile(n: Int) = n in PROFILE_MIN..PROFILE_MAX
    private fun okRim(n: Double) = n in RIM_MIN..RIM_MAX && (n % 1.0 == 0.0 || n % 1.0 == 0.5)

    fun isValid(s: TyreSize) = okWidth(s.width) && okProfile(s.profile) && okRim(s.rim)

    private val FULL = Regex("""(?<![\d.])(\d{3})\s*[/ ]\s*(\d{2})\s*(?:[A-Z]{0,2}\s*R\s*|-)(\d{2}(?:[.,]5)?)(?!\d)""", RegexOption.IGNORE_CASE)
    private val LOAD = Regex("""^\s*(?:XL\s+|RF\s+|C\s+)?(\d{2,3}(?:/\d{2,3})?)\s*([A-Z])(?![A-Z])""", RegexOption.IGNORE_CASE)
    private val ONLY_SIZE_CHARS = Regex("""^[\d\s/.,\-ZR]+$""")
    private val RIM_TAIL = Regex("""Z?R\s*(\d{0,2}(?:[.,]5?)?)\s*$""")
    private val RIM_DIGITS = Regex("""^\d{2}([.,]5)?$""")
    private val GROUP = Regex("""^\d+([.,]5)?$""")
    private val COMPACT = Regex("""^\d{5}$|^\d{7}$""")
    private val SEPARATORS = Regex("""[\s/\-]+""")

    private fun rimNum(s: String) = s.replace(',', '.').toDouble()

    fun parseTyreSize(text: String?): TyreSize? = parseTyreSpec(text)?.size

    /** A full size + load index / speed rating from a name like "Michelin Primacy 4 205/55R16 91V". */
    fun parseTyreSpec(text: String?): TyreSpec? {
        val t = text ?: ""
        val m = FULL.find(t) ?: return null
        val size = TyreSize(m.groupValues[1].toInt(), m.groupValues[2].toInt(), rimNum(m.groupValues[3]))
        if (!isValid(size)) return null
        val load = LOAD.find(t.substring(m.range.last + 1))
        return TyreSpec(size, load?.groupValues?.get(1), load?.groupValues?.get(2)?.uppercase())
    }

    /**
     * Read a size box, partially typed or not: "205", "205/55", "205/55 R16", "205/55R16",
     * "205 55 16", "205-55-16", "2055516", "R16". Null when the text is not a size at all.
     * A half-typed trailing part ("205/5") is ignored rather than failing the whole query.
     */
    fun parseSizeQuery(text: String?): SizeQuery? {
        var s = (text ?: "").trim().uppercase(Locale.ROOT)
        if (s.isEmpty()) return null
        if (!ONLY_SIZE_CHARS.matches(s)) return null

        var rim: Double? = null
        val r = RIM_TAIL.find(s)
        if (r != null) {
            val digits = r.groupValues[1].replace(Regex("[.,]$"), "")
            if (RIM_DIGITS.matches(digits)) {
                val v = rimNum(digits)
                if (!okRim(v)) return null
                rim = v
            }
            s = s.substring(0, r.range.first).trim()
        }
        if (s.contains('Z') || s.contains('R')) return null

        var groups = s.split(SEPARATORS).filter { it.isNotEmpty() }
        if (groups.any { !GROUP.matches(it) }) return null
        if (groups.size == 1 && COMPACT.matches(groups[0])) {
            val g = groups[0]
            groups = listOf(g.substring(0, 3), g.substring(3, 5)) + (if (g.length == 7) listOf(g.substring(5)) else emptyList())
        }
        if (groups.size > 3) return null

        var width: Int? = null
        var profile: Int? = null
        if (groups.isNotEmpty()) {
            val g = groups[0]
            if (g.length < 3) return null // "20" is a width still being typed
            val w = g.toIntOrNull() ?: return null
            if (!okWidth(w)) return null
            width = w
        }
        if (groups.size >= 2) {
            val g = groups[1]
            if (g.length == 2) {
                val p = g.toIntOrNull() ?: return null
                if (!okProfile(p)) return null
                profile = p
            } else if (g.length != 1 || groups.size > 2) {
                return null
            }
        }
        if (groups.size == 3) {
            if (rim != null) return null
            val g = groups[2]
            if (RIM_DIGITS.matches(g)) {
                val v = rimNum(g)
                if (!okRim(v)) return null
                rim = v
            } else if (g.length != 1) {
                return null
            }
        }
        if (width == null && profile == null && rim == null) return null
        return SizeQuery(width, profile, rim)
    }

    /** Does a stored size satisfy a (partial) query? No size never matches. */
    fun sizeMatches(size: TyreSize?, q: SizeQuery): Boolean {
        if (size == null) return false
        return (q.width == null || size.width == q.width) &&
            (q.profile == null || size.profile == q.profile) &&
            (q.rim == null || size.rim == q.rim)
    }

    private fun rimText(rim: Double) = if (rim % 1.0 == 0.0) rim.toInt().toString() else String.format(Locale.US, "%.1f", rim)

    fun format(s: TyreSize) = "${s.width}/${s.profile} R${rimText(s.rim)}"

    fun formatSpec(size: TyreSize, loadIndex: String?, speedRating: String?): String {
        val ls = "${loadIndex ?: ""}${speedRating ?: ""}".trim()
        return if (ls.isNotEmpty()) "${format(size)} $ls" else format(size)
    }

    fun formatQuery(q: SizeQuery): String {
        val head = listOfNotNull(q.width, q.profile).joinToString("/")
        val rim = q.rim?.let { "R${rimText(it)}" } ?: ""
        return listOf(head, rim).filter { it.isNotEmpty() }.joinToString(" ")
    }

    fun fromColumns(width: Int?, profile: Int?, rim: Double?): TyreSize? =
        if (width == null || profile == null || rim == null) null else TyreSize(width, profile, rim)

    // ── Brand ───────────────────────────────────────────────────────────────

    fun normaliseBrand(b: String?): String? = (b ?: "").replace(Regex("""\s+"""), " ").trim().ifEmpty { null }

    /** "MICHELIN", "Michelin " and "michelin" are one brand. "" = no brand. */
    fun brandKey(b: String?): String = (normaliseBrand(b) ?: "").lowercase(Locale.ROOT)

    private val TYRE_CATEGORY = Regex("""\b(tyres?|tires?|pneus?|pneumatiques?|wheels?|jantes?|roues?)\b""", RegexOption.IGNORE_CASE)

    fun isTyreCategory(category: String?) = TYRE_CATEGORY.containsMatchIn(category ?: "")

    // ── Size ↔ brand summaries ──────────────────────────────────────────────

    private fun spellings(items: List<AttrItem>): Map<String, String> {
        val counts = LinkedHashMap<String, LinkedHashMap<String, Int>>()
        for (i in items) {
            val b = normaliseBrand(i.brand) ?: continue
            val m = counts.getOrPut(b.lowercase(Locale.ROOT)) { LinkedHashMap() }
            m[b] = (m[b] ?: 0) + 1
        }
        return counts.mapValues { (_, m) ->
            m.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key }).first().key
        }
    }

    private val byLabel = Comparator<String> { a, b -> a.lowercase(Locale.ROOT).compareTo(b.lowercase(Locale.ROOT)) }

    /** Every brand in a list, for a brand picker, A→Z. */
    fun brandOptions(items: List<AttrItem>): List<BrandRow> {
        val sp = spellings(items)
        val rows = LinkedHashMap<String, BrandRow>()
        for (i in items) {
            val k = brandKey(i.brand)
            if (k.isEmpty()) continue
            val r = rows[k] ?: BrandRow(k, sp[k] ?: k, 0, 0.0)
            rows[k] = r.copy(products = r.products + 1, qty = r.qty + (i.qty ?: 0.0))
        }
        return rows.values.sortedWith { a, b -> byLabel.compare(a.brand, b.brand) }
    }

    /** "Which brands do I have in 205/55?" Most stock first; no-brand last. */
    fun brandsForSize(items: List<AttrItem>, q: SizeQuery): List<BrandRow> {
        val sp = spellings(items)
        val rows = LinkedHashMap<String, BrandRow>()
        for (i in items) {
            if (!sizeMatches(i.size, q)) continue
            val k = brandKey(i.brand)
            val r = rows[k] ?: BrandRow(k, if (k.isEmpty()) "" else (sp[k] ?: k), 0, 0.0)
            rows[k] = r.copy(products = r.products + 1, qty = r.qty + (i.qty ?: 0.0))
        }
        return rows.values.sortedWith(
            compareBy<BrandRow> { if (it.key.isEmpty()) 1 else 0 }
                .thenByDescending { it.qty }
                .thenByDescending { it.products }
                .then { a, b -> byLabel.compare(a.brand, b.brand) },
        )
    }

    /** "Which sizes does Michelin come in?" Smallest rim first. */
    fun sizesForBrand(items: List<AttrItem>, key: String): List<SizeRow> {
        val rows = LinkedHashMap<String, SizeRow>()
        for (i in items) {
            val size = i.size ?: continue
            if (brandKey(i.brand) != key) continue
            val label = format(size)
            val r = rows[label] ?: SizeRow(size, label, 0, 0.0)
            rows[label] = r.copy(products = r.products + 1, qty = r.qty + (i.qty ?: 0.0))
        }
        return rows.values.sortedWith(compareBy<SizeRow> { it.size.rim }.thenBy { it.size.width }.thenBy { it.size.profile })
    }

    /** Brand + partial size filters together; "" / null = any. */
    fun matchesFilter(brand: String?, size: TyreSize?, brandKey: String, q: SizeQuery?): Boolean {
        if (brandKey.isNotEmpty() && brandKey(brand) != brandKey) return false
        if (q != null && q.isSet && !sizeMatches(size, q)) return false
        return true
    }

    fun searchText(brand: String?, size: TyreSize?, loadIndex: String? = null, speedRating: String? = null): String {
        val parts = mutableListOf<String>()
        if (brand != null) parts += brand
        if (size != null) {
            val r = rimText(size.rim)
            parts += formatSpec(size, loadIndex, speedRating)
            parts += "${size.width}/${size.profile}R$r"
            parts += "${size.width}${size.profile}$r"
        }
        return parts.joinToString(" ").lowercase(Locale.ROOT)
    }

    /**
     * The pickers' search: every word typed must be found in the product's own words, its brand,
     * its size in any common spelling, or — read as a partial size — match its stored size.
     */
    fun searchMatches(query: String, words: List<String?>, brand: String?, size: TyreSize?, loadIndex: String? = null, speedRating: String? = null): Boolean {
        val tokens = query.trim().lowercase(Locale.ROOT).split(Regex("""\s+""")).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return true
        val hay = (words.map { (it ?: "").lowercase(Locale.ROOT) } + searchText(brand, size, loadIndex, speedRating)).joinToString("\n")
        return tokens.all { t ->
            if (hay.contains(t)) true
            else {
                val s = parseSizeQuery(t)
                s != null && s.isSet && sizeMatches(size, s)
            }
        }
    }
}
