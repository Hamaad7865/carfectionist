package mu.carfection.pos.core.rich

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * The tablet's copy of a line's rich content.
 *
 * The web is the authority on this shape (apps/web/src/lib/rich/types.ts). This is
 * the mirror, and the two must stay identical: the same tree is printed on the A4
 * the customer receives and shown on the tablet the customer is standing next to.
 * The plain-text output in particular is pinned byte-for-byte against the web's own
 * tests — see RichDocTest.
 *
 * Parsing is hand-rolled rather than @Serializable because it has to FAIL CLOSED.
 * A row can hold a newer schemaVersion, or the stringified blob a `->>` would have
 * written; the answer to all of it is "no description", never a crash on a screen a
 * customer is looking at.
 */

data class RichRun(
    val text: String,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val strike: Boolean = false,
    val href: String? = null,
)

sealed interface RichBlock {
    data class Paragraph(val runs: List<RichRun>) : RichBlock
    data class BulletList(val items: List<List<RichRun>>) : RichBlock
    data class OrderedList(val items: List<List<RichRun>>) : RichBlock
    data class Table(val rows: List<List<List<RichRun>>>) : RichBlock
}

data class RichDoc(val blocks: List<RichBlock>)

/** The only version this build understands. A newer one is refused, not guessed at. */
private const val SCHEMA_VERSION = 1

private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonElement?.arr(): JsonArray? = this as? JsonArray
private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonElement?.flag(): Boolean = (this as? JsonPrimitive)?.booleanOrNull == true

private fun readRuns(node: JsonElement?): List<RichRun> =
    node.arr().orEmpty().mapNotNull { r ->
        val o = r.obj() ?: return@mapNotNull null
        val text = o["text"].str() ?: return@mapNotNull null
        RichRun(
            text = text,
            bold = o["bold"].flag(),
            italic = o["italic"].flag(),
            strike = o["strike"].flag(),
            href = o["href"].str(),
        )
    }

private fun readItems(node: JsonObject): List<List<RichRun>> =
    node["items"].arr().orEmpty().map { readRuns(it) }

/** Null for a block this build does not understand — the caller drops it. */
private fun readBlock(node: JsonElement): RichBlock? {
    val o = node.obj() ?: return null
    return when (o["type"].str()) {
        "p" -> RichBlock.Paragraph(readRuns(o["runs"]))
        "ul" -> RichBlock.BulletList(readItems(o))
        "ol" -> RichBlock.OrderedList(readItems(o))
        "table" -> RichBlock.Table(
            o["rows"].arr().orEmpty().map { row -> row.arr().orEmpty().map { cell -> readRuns(cell) } },
        )
        else -> null
    }
}

fun parseRichDoc(value: JsonElement?): RichDoc? {
    val o = value.obj() ?: return null
    if ((o["schemaVersion"] as? JsonPrimitive)?.intOrNull != SCHEMA_VERSION) return null
    return RichDoc(o["blocks"].arr().orEmpty().mapNotNull { readBlock(it) })
}

// ── Flattening ──────────────────────────────────────────────────────────────

private fun runsText(runs: List<RichRun>): String = runs.joinToString("") { it.text }

/**
 * The flat text of a tree. Byte-for-byte identical to the web's richToPlainText —
 * a bullet becomes "- ", an ordered item "1. ", table cells join with " | ".
 */
fun richToPlainText(doc: RichDoc?): String =
    doc?.blocks.orEmpty().joinToString("\n") { block ->
        when (block) {
            is RichBlock.Paragraph -> runsText(block.runs)
            is RichBlock.BulletList -> block.items.joinToString("\n") { "- ${runsText(it)}" }
            is RichBlock.OrderedList -> block.items.mapIndexed { i, it -> "${i + 1}. ${runsText(it)}" }.joinToString("\n")
            is RichBlock.Table -> block.rows.joinToString("\n") { row -> row.joinToString(" | ") { runsText(it) } }
        }
    }

// ── The tablet's own authoring shape ────────────────────────────────────────

/**
 * Plain bullet rows → a tree the web can read.
 *
 * The tablet authors bullets and nothing else: Compose has no contentEditable, and
 * a real inline rich editor on a screen already carrying a product grid, a signature
 * pad and a payments handoff is not a trade worth making. It RENDERS everything the
 * back office can write; it AUTHORS this much.
 */
fun bulletsToRichDoc(bullets: List<String>): RichDoc? {
    val kept = bullets.map { it.trim() }.filter { it.isNotEmpty() }
    if (kept.isEmpty()) return null
    return RichDoc(listOf(RichBlock.BulletList(kept.map { listOf(RichRun(it)) })))
}

/**
 * Is this tree safe for the tablet's bullet editor to rewrite?
 *
 * Only if everything in it is a plain bullet — no marks, no links, no numbered
 * list, no table. Otherwise the back office wrote something this screen cannot
 * express, and rewriting it as bullet rows would silently destroy that work: the
 * same class of bug as the tablet nulling description on every save. When this is
 * false the tablet shows the description and refuses to edit it.
 */
fun isBulletsOnly(doc: RichDoc?): Boolean {
    val blocks = doc?.blocks ?: return true
    return blocks.all { block ->
        block is RichBlock.BulletList &&
            block.items.all { item -> item.all { !it.bold && !it.italic && !it.strike && it.href == null } }
    }
}

/** The reverse, for loading a tree back into the bullet editor. */
fun richDocToBullets(doc: RichDoc?): List<String> =
    doc?.blocks.orEmpty().flatMap { block ->
        when (block) {
            is RichBlock.BulletList -> block.items.map { runsText(it) }
            is RichBlock.OrderedList -> block.items.map { runsText(it) }
            is RichBlock.Paragraph -> listOf(runsText(block.runs))
            is RichBlock.Table -> emptyList()
        }
    }.filter { it.isNotBlank() }

// ── Back to JSON ────────────────────────────────────────────────────────────

private fun runsJson(runs: List<RichRun>) = buildJsonArray {
    runs.forEach { r ->
        add(
            buildJsonObject {
                put("text", r.text)
                if (r.bold) put("bold", true)
                if (r.italic) put("italic", true)
                if (r.strike) put("strike", true)
                r.href?.let { put("href", it) }
            },
        )
    }
}

/** Only what the tablet can author is written back; anything else is carried untouched. */
fun richDocToJson(doc: RichDoc): JsonElement = buildJsonObject {
    put("schemaVersion", SCHEMA_VERSION)
    put(
        "blocks",
        buildJsonArray {
            doc.blocks.forEach { block ->
                when (block) {
                    is RichBlock.Paragraph -> add(buildJsonObject { put("type", "p"); put("runs", runsJson(block.runs)) })
                    is RichBlock.BulletList -> add(
                        buildJsonObject { put("type", "ul"); put("items", buildJsonArray { block.items.forEach { add(runsJson(it)) } }) },
                    )
                    is RichBlock.OrderedList -> add(
                        buildJsonObject { put("type", "ol"); put("items", buildJsonArray { block.items.forEach { add(runsJson(it)) } }) },
                    )
                    is RichBlock.Table -> add(
                        buildJsonObject {
                            put("type", "table")
                            put(
                                "rows",
                                buildJsonArray {
                                    block.rows.forEach { row -> add(buildJsonArray { row.forEach { add(runsJson(it)) } }) }
                                },
                            )
                        },
                    )
                }
            }
        },
    )
}
