package mu.carfection.pos.core.data

import mu.carfection.pos.BuildConfig

/**
 * A product's stored photo path → the URL Coil can load. product-photos is a PUBLIC
 * bucket (unlike vehicle-photos, which is private and signed per render), so this is a
 * plain string build, not a suspend call — safe to cache offline and never goes stale.
 */
fun productPhotoUrl(path: String?): String? =
    path?.let { "${BuildConfig.SUPABASE_URL}/storage/v1/object/public/product-photos/$it" }
