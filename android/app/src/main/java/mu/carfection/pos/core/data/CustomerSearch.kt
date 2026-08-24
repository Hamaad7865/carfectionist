package mu.carfection.pos.core.data

import mu.carfection.pos.core.database.CustomerEntity

/**
 * Intake's and Quote's customer search, ranked by RELEVANCE rather than left alphabetical.
 *
 * A name that STARTS with what was typed must beat one that merely contains it: typing "ya"
 * asked for Yash, but a plain contains-filter keeps the cache's A→Z order, so every mid-name
 * hit (Heerma Seedoyal, Priya Macintyre…) crowded the list and Yash — sorted last by the
 * alphabet — fell off the take(6) entirely. The same ranking is applied after the server
 * pass merges in, so a remote Yash outranks a local Heerma too.
 */
fun rankedCustomerMatches(customers: List<CustomerEntity>, query: String, take: Int): List<CustomerEntity> {
    val q = query.trim().lowercase()
    if (q.isBlank()) return emptyList()
    return customers
        .filter { it.name.lowercase().contains(q) || (it.phone ?: "").contains(q) }
        .sortedWith(
            compareBy(
                { if (it.name.lowercase().startsWith(q)) 0 else 1 },
                { it.name.lowercase() },
            ),
        )
        .take(take)
}
