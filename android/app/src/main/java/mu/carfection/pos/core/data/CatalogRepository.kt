package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import mu.carfection.pos.core.database.CustomerDao
import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.database.ProductDao
import mu.carfection.pos.core.database.ProductEntity
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

    val products: Flow<List<ProductEntity>> = productDao.observeAll()
    val customers: Flow<List<CustomerEntity>> = customerDao.observeAll()

    suspend fun tenantId(): String? = prefs.data.first()[tenantKey]
    suspend fun tradingName(): String = prefs.data.first()[nameKey] ?: "Carfectionist"
    suspend fun vatDefault(): Double = prefs.data.first()[vatKey] ?: 15.0

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
        )
    }

    /** Pull settings + catalogue. Call after login and on pull-to-refresh. */
    suspend fun refresh() {
        val settings = api.fetchSettings()
        prefs.edit {
            it[tenantKey] = settings.id
            it[vatKey] = settings.vatRate
            settings.tradingName?.let { n -> it[nameKey] = n }
            settings.brn?.let { v -> it[brnKey] = v }
            settings.vatNumber?.let { v -> it[vatNoKey] = v }
            settings.phone?.let { v -> it[phoneKey] = v }
            settings.address?.let { v -> it[addressKey] = v }
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
            )
        }
        if (products.isNotEmpty()) productDao.replaceAll(products)

        val customers = api.fetchCustomers().map { c -> CustomerEntity(c.id, c.name, c.phone) }
        if (customers.isNotEmpty()) customerDao.replaceAll(customers)
    }
}
