package mu.carfection.pos.core.data

/**
 * What a shop offers, by tenant — mirrors apps/web/src/lib/auth/roles.ts (TYRE_TENANTS,
 * hasWhatsApp). The deployment has ONE WhatsApp number and it is Carfectionist's; the tyre
 * centre asked for no WhatsApp at all, so its tablet offers none. The server refuses a
 * WhatsApp send for it too, so a stale build that still shows the button can't send.
 */
object TenantFeatures {
    /** Garage De L'Est (tyres + Service). Keep in step with TYRE_TENANTS on the web. */
    private val TYRE_TENANTS = setOf("1f060b86-ad63-4dc7-93fb-a1fdfae18b27")

    /** Not synced yet (null) reads as "has WhatsApp": nothing changes for Carfectionist. */
    fun hasWhatsApp(tenantId: String?): Boolean = tenantId == null || tenantId !in TYRE_TENANTS
}
