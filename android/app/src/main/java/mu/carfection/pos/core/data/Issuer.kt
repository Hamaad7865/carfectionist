package mu.carfection.pos.core.data

import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.network.IssuerCompanyDto

/**
 * Whose identity a bill's slip prints — the tablet twin of the web's overlayIssuer
 * (apps/web/src/lib/supabase/queries/issuer.ts). Same rules, word for word:
 *
 *  - The DEFAULT company (or a bill naming none) is the shop's own settings, untouched — a
 *    one-company shop's slip is byte-for-byte what it always printed. Only its VAT flag rides.
 *  - Any other company lays its identity over the shop's. Only where the shop TRADES FROM and
 *    how the paper LOOKS may be shared (address, phone, logo, footer); a blank legal identity —
 *    name, BRN, VAT number — prints blank, so a service bill can never carry the tyre company's
 *    BRN or VAT number.
 *  - A company with no trading name trades under its legal name, never the other company's.
 *  - A company that is not VAT-registered prints no VAT number.
 *
 * The logo: the tablet caches ONE image (the shop's). A company naming its own, different logo
 * cannot borrow the shop's, so it prints none — and the slip then prints the company's name,
 * as it does for any shop without a logo.
 */
fun overlayIssuer(shop: ReceiptBiz, company: IssuerCompanyDto?, shopLogoPath: String?): ReceiptBiz {
    if (company == null) return shop
    if (company.isDefault) return shop.copy(vatRegistered = company.vatRegistered)
    fun String?.filled() = this?.trim()?.takeIf { it.isNotEmpty() }
    val ownLogo = company.receiptLogoPath.filled()
    return shop.copy(
        name = company.tradingName.filled() ?: company.legalName.filled() ?: "",
        brn = company.brn.filled(),
        vatNo = if (company.vatRegistered) company.vatNumber.filled() else null,
        address = company.address.filled() ?: shop.address,
        phone = company.phone.filled() ?: shop.phone,
        logoFile = if (ownLogo == null || ownLogo == shopLogoPath) shop.logoFile else null,
        footer = company.receiptFooterText.filled() ?: shop.footer,
        vatRegistered = company.vatRegistered,
    )
}
