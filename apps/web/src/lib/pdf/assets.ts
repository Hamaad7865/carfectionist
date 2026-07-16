import type { DocumentA4Props } from "@/components/pdf/DocumentA4";
import type { createClient } from "@/lib/supabase/server";

export type DocAssets = NonNullable<DocumentA4Props["assets"]>;
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Template config (jsonb) → the banner/logo URLs DocumentA4 renders. One
 * resolver, so the live preview and the print/PDF route stay in lock-step.
 *
 * A stored value is one of two things, and the difference matters:
 *
 *  • "/brand/header.png" or "https://…" — used verbatim. The built-in artwork
 *    lives in apps/web/public and resolves against the <base href> render.ts
 *    injects (the deployed origin), which the headless renderer can fetch over
 *    the open internet.
 *
 *  • "{tenant}/template/{uuid}.png" — an object in the PRIVATE brand-assets
 *    bucket, uploaded by the owner. Cloudflare's Browser Rendering fetches our
 *    HTML with no Supabase session, so it could never satisfy that bucket's
 *    RLS. It gets a freshly signed URL instead.
 *
 * Signed URLs are minted per render and never persisted — the same rule
 * signVehiclePhotos follows. A signed URL written into the template config would
 * work for an hour and then quietly leave every invoice with no letterhead.
 */
const isDirectUrl = (v: string) =>
  v.startsWith("/") || v.startsWith("http://") || v.startsWith("https://") || v.startsWith("data:");

/** True when the stored value names an object in brand-assets rather than a URL. */
export const isStoredAsset = (v: string | null | undefined): v is string => !!v && !isDirectUrl(v);

export async function resolveDocAssets(
  sb: ServerClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  ttlSeconds = 3600,
): Promise<DocAssets> {
  const raw = {
    headerBannerUrl: (config?.header_banner_path as string) || null,
    footerBannerUrl: (config?.footer_banner_path as string) || null,
    logoUrl: (config?.logo_path as string) || null,
  };

  const toSign = [raw.headerBannerUrl, raw.footerBannerUrl, raw.logoUrl].filter(isStoredAsset);
  if (toSign.length === 0) return raw;

  const signed = await signBrandAssets(sb, toSign, ttlSeconds);
  const resolve = (v: string | null) => (isStoredAsset(v) ? (signed[v] ?? null) : v);
  return {
    headerBannerUrl: resolve(raw.headerBannerUrl),
    footerBannerUrl: resolve(raw.footerBannerUrl),
    logoUrl: resolve(raw.logoUrl),
  };
}

/** Sign brand-assets object paths for display. Failures are omitted rather than
 *  thrown: a missing banner must never be the reason an invoice won't render —
 *  DocumentA4 falls back to the built-in artwork. */
export async function signBrandAssets(sb: ServerClient, paths: string[], ttlSeconds = 3600): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  try {
    const { data } = await sb.storage.from("brand-assets").createSignedUrls(unique, ttlSeconds);
    const map: Record<string, string> = {};
    for (const item of data ?? []) if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
    return map;
  } catch {
    return {};
  }
}
