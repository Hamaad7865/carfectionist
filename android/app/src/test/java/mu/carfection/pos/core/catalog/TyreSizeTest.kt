package mu.carfection.pos.core.catalog

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.contentOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Held to the SAME fixture as the web (apps/web/src/lib/products/tyre-size.fixture.json), read
 * from the repo at test time — so the tablet's size filter can never drift from the web's.
 */
class TyreSizeTest {

    private val fixture: JsonObject by lazy {
        var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
        while (dir != null) {
            val f = File(dir, "apps/web/src/lib/products/tyre-size.fixture.json")
            if (f.exists()) return@lazy Json.parseToJsonElement(f.readText()).jsonObject
            dir = dir.parentFile
        }
        error("tyre-size.fixture.json not found above ${System.getProperty("user.dir")}")
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.contentOrNull
    private fun size(e: JsonElement?): TyreSize? =
        if (e == null || e is JsonNull) null else e.jsonArray.let { TyreSize(it[0].jsonPrimitive.int, it[1].jsonPrimitive.int, it[2].jsonPrimitive.double) }
    private fun intOrNull(e: JsonElement?) = if (e == null || e is JsonNull) null else e.jsonPrimitive.int
    private fun dblOrNull(e: JsonElement?) = if (e == null || e is JsonNull) null else e.jsonPrimitive.double

    private val items: List<AttrItem> by lazy {
        fixture["summary"]!!.jsonObject["items"]!!.jsonArray.map {
            val o = it.jsonObject
            AttrItem(str(o["brand"]), size(o["size"]), dblOrNull(o["qty"]))
        }
    }

    @Test fun parsesSpecsLikeTheWeb() {
        for (c in fixture["spec"]!!.jsonArray) {
            val o = c.jsonObject
            val input = str(o["in"])!!
            val got = TyreSizes.parseTyreSpec(input)
            val out = o["out"]
            if (out == null || out is JsonNull) {
                assertEquals(input, null, got)
            } else {
                val e = out.jsonObject
                assertEquals(
                    input,
                    TyreSpec(TyreSize(e["width"]!!.jsonPrimitive.int, e["profile"]!!.jsonPrimitive.int, e["rim"]!!.jsonPrimitive.double), str(e["load"]), str(e["speed"])),
                    got,
                )
            }
        }
    }

    @Test fun readsSizeQueriesLikeTheWeb() {
        for (c in fixture["query"]!!.jsonArray) {
            val o = c.jsonObject
            val input = str(o["in"])!!
            val out = o["out"]
            val want = if (out == null || out is JsonNull) null else out.jsonObject.let {
                SizeQuery(intOrNull(it["width"]), intOrNull(it["profile"]), dblOrNull(it["rim"]))
            }
            assertEquals(input, want, TyreSizes.parseSizeQuery(input))
        }
    }

    @Test fun brandsForSizeLikeTheWeb() {
        for (c in fixture["summary"]!!.jsonObject["brandsForSize"]!!.jsonArray) {
            val o = c.jsonObject
            val q = TyreSizes.parseSizeQuery(str(o["query"]))!!
            val want = o["out"]!!.jsonArray.map { r -> r.jsonArray.let { listOf(str(it[0]), str(it[1]), it[2].jsonPrimitive.int, it[3].jsonPrimitive.double) } }
            val got = TyreSizes.brandsForSize(items, q).map { listOf(it.key, it.brand, it.products, it.qty) }
            assertEquals(str(o["query"]), want, got)
        }
    }

    @Test fun sizesForBrandLikeTheWeb() {
        for (c in fixture["summary"]!!.jsonObject["sizesForBrand"]!!.jsonArray) {
            val o = c.jsonObject
            val want = o["out"]!!.jsonArray.map { r -> r.jsonArray.let { listOf(str(it[0]), it[1].jsonPrimitive.int, it[2].jsonPrimitive.double) } }
            val got = TyreSizes.sizesForBrand(items, str(o["brand"])!!).map { listOf(it.label, it.products, it.qty) }
            assertEquals(str(o["brand"]), want, got)
        }
    }

    @Test fun brandOptionsLikeTheWeb() {
        val want = (fixture["summary"]!!.jsonObject["brandOptions"] as JsonArray).map { r ->
            r.jsonArray.let { listOf(str(it[0]), str(it[1]), it[2].jsonPrimitive.int, it[3].jsonPrimitive.double) }
        }
        assertEquals(want, TyreSizes.brandOptions(items).map { listOf(it.key, it.brand, it.products, it.qty) })
    }

    @Test fun formatsLikeTheWeb() {
        for (c in fixture["format"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(str(o["out"]), TyreSizes.formatSpec(size(o["size"])!!, str(o["load"]), str(o["speed"])))
        }
        assertEquals("205/55", TyreSizes.formatQuery(SizeQuery(205, 55, null)))
        assertEquals("R16", TyreSizes.formatQuery(SizeQuery(null, null, 16.0)))
    }

    @Test fun searchesLikeTheWeb() {
        val its = fixture["search"]!!.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
        for (c in fixture["search"]!!.jsonObject["cases"]!!.jsonArray) {
            val o = c.jsonObject
            val q = str(o["q"])!!
            val want = o["out"]!!.jsonArray.map { it.jsonPrimitive.int }
            val got = its.indices.filter { i ->
                val p = its[i]
                TyreSizes.searchMatches(q, listOf(str(p["name"]), str(p["barcode"])), str(p["brand"]), size(p["size"]), str(p["load"]), str(p["speed"]))
            }
            assertEquals(q, want, got)
        }
    }

    @Test fun tyreCategoriesAndBrandKeys() {
        for (c in listOf("Tyres", "TIRES", "Pneus", "Jantes", "Wheels", "Car tyre")) assertTrue(c, TyreSizes.isTyreCategory(c))
        for (c in listOf("Polish", "Services", "", null, "Tyrell")) assertFalse("$c", TyreSizes.isTyreCategory(c))
        assertEquals("michelin", TyreSizes.brandKey(" MICHELIN"))
        assertEquals("Michelin Pilot", TyreSizes.normaliseBrand("  Michelin   Pilot "))
        assertEquals("", TyreSizes.brandKey(null))
    }
}
