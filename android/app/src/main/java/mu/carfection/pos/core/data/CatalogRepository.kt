package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import mu.carfection.pos.core.database.CustomerDao
import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.database.ProductDao
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.hardware.DEFAULT_RECEIPT_FOOTER
import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.PosApi
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The pinned pseudo-category on every product rail (Quotes, Checkout): everything with
 * kind = 'service', whatever its category string. The shop's ~70 services were invisible —
 * buried inside one alphabetical category, plus a few with no category at all.
 */
const val SERVICES_TAB = "Services"

/** The Products / Services toggle above the category rail (mirrors the web builder). */
enum class KindFilter(val label: String) { ALL("All"), SERVICES("Services"), PRODUCTS("Products") }

/**
 * Offline-first catalogue: the UI observes Room; refresh() pulls the shared
 * tables from Supabase and replaces the cache. (M1 = full refresh; the delta
 * cursor pull arrives with migration 0003 in M2.)
 */
@Singleton
class CatalogRepository @Inject constructor(
    private val api: PosApi,
    private val productDao: ProductDao,
    private val customerDao: CustomerDao,
    private val prefs: DataStore<Preferences>,
    private val logoStore: ReceiptLogoStore,
) {
    private val tenantKey = stringPreferencesKey("tenant_id")
    private val vatKey = doublePreferencesKey("vat_default")
    private val nameKey = stringPreferencesKey("trading_name")
    private val brnKey = stringPreferencesKey("brn")
    private val vatNoKey = stringPreferencesKey("vat_number")
    private val addressKey = stringPreferencesKey("address")
    private val phoneKey = stringPreferencesKey("phone")
    private val footerKey = stringPreferencesKey("receipt_footer")
    private val inclVatKey = booleanPreferencesKey("prices_incl_vat")
    private val pointValueKey = doublePreferencesKey("point_value_rupees")
    private val pointsOnKey = booleanPreferencesKey("points_enabled")

    val products: Flow<List<ProductEntity>> = productDao.observeAll()
    val customers: Flow<List<CustomerEntity>> = customerDao.observeAll()

    /**
     * Put one customer into the local cache immediately.
     *
     * Intake searches the CACHE, which is only refreshed by a full sync — so a customer created
     * on the tablet was invisible to the very next search. Staff concluded they were not in the
     * system and created them again; the duplicate then collided on the vehicle's unique plate
     * and the real car ended up on a different record from the job.
     */
    suspend fun cacheCustomer(c: CustomerEntity) = customerDao.upsertAll(listOf(c))

    /**
     * Does the shop quote VAT-INCLUSIVE shelf prices? Live, not a one-shot read: the settings
     * sync that writes this races the screens that read it, so a snapshot would leave the
     * first launch after an update showing net prices until the app was reopened.
     */
    val pricesInclVatFlow: Flow<Boolean> = prefs.data.map { it[inclVatKey] ?: false }

    /**
     * What one point is worth when spent (business_settings.point_value_rupees). Live, for the
     * same reason [pricesInclVatFlow] is: the settings sync below races the payment pad, and a
     * snapshot would cap a Points tender against a rate the owner has since changed.
     */
    val pointValueRupeesFlow: Flow<Double> = prefs.data.map { it[pointValueKey] ?: 1.0 }

    /**
     * Does the shop run a loyalty programme at all (business_settings.points_enabled)?
     * Live, like the rate above: the owner can switch it off from the back office mid-shift,
     * and the pad must stop offering a tender the server will refuse — without the cashier
     * having to restart anything. Defaults to ON so a tablet that has never synced the
     * field keeps taking points exactly as it does today.
     */
    val pointsEnabledFlow: Flow<Boolean> = prefs.data.map { it[pointsOnKey] ?: true }

    suspend fun tenantId(): String? = prefs.data.first()[tenantKey]
    suspend fun tradingName(): String = prefs.data.first()[nameKey] ?: "Carfectionist"
    suspend fun vatDefault(): Double = prefs.data.first()[vatKey] ?: 15.0

    /** Does the shop quote VAT-INCLUSIVE shelf prices? Display-only — prices stay stored net. */
    suspend fun pricesInclVat(): Boolean = prefs.data.first()[inclVatKey] ?: false

    /** Receipt header identity (name/address/BRN/VAT no/logo) from the synced settings. */
    suspend fun receiptBiz(): ReceiptBiz {
        val p = prefs.data.first()
        return ReceiptBiz(
            name = p[nameKey] ?: "Carfectionist",
            address = p[addressKey],
            brn = p[brnKey],
            vatNo = p[vatNoKey],
            phone = p[phoneKey],
            logoFile = logoStore.file()?.absolutePath,
            footer = p[footerKey] ?: DEFAULT_RECEIPT_FOOTER,
        )
    }

    /** Pull settings + catalogue. Call after login and on pull-to-refresh. */
    suspend fun refresh() {
        val settings = api.fetchSettings()
        prefs.edit {
            it[tenantKey] = settings.id
            it[vatKey] = settings.vatRate
            it[inclVatKey] = !settings.pricesVatExclusive
            it[pointValueKey] = settings.pointValueRupees
            it[pointsOnKey] = settings.pointsEnabled
            settings.tradingName?.let { n -> it[nameKey] = n }
            settings.brn?.let { v -> it[brnKey] = v }
            settings.vatNumber?.let { v -> it[vatNoKey] = v }
            settings.phone?.let { v -> it[phoneKey] = v }
            settings.address?.let { v -> it[addressKey] = v }
            // Blank means "back to the default sentence", so the key must clear.
            val footer = settings.receiptFooterText?.trim()
            if (footer.isNullOrBlank()) it.remove(footerKey) else it[footerKey] = footer
        }
        // The logo rides the same refresh: download once, then print from disk.
        logoStore.sync(settings.receiptLogoPath)
        val vatDefault = settings.vatRate

        // Offline-first: an EMPTY fetch is treated as "no update", never "delete everything".
        // replaceAll → deleteNotIn(emptyList) expands to `NOT IN ()`, which is true for every row
        // in SQLite and would wipe the whole cache — so a transient empty/RLS-filtered 200 (not an
        // error, so it isn't caught upstream) must not clear the last-known catalogue.
        val products = api.fetchProducts().map { p ->
            ProductEntity(
                id = p.id,
                name = p.name,
                kind = p.kind,
                sellingPriceCents = rupeesToCents(p.sellingPrice),
                vatRatePct = p.vatRate ?: vatDefault,
                barcode = p.barcode,
                isStocked = p.isStocked,
                category = p.category?.ifBlank { null },
                lowStockThreshold = p.lowStockThreshold,
                photoPath = p.photoPath,
                discountPolicy = p.discountPolicy,
            )
        }
        if (products.isNotEmpty()) productDao.replaceAll(products)

        val customers = api.fetchCustomers().map { c -> CustomerEntity(c.id, c.name, c.phone, pointsBalance = c.pointsBalance) }
        if (customers.isNotEmpty()) customerDao.replaceAll(customers)
    }
}
