import type { DocumentA4Props } from "@/components/pdf/DocumentA4";

export type DocAssets = NonNullable<DocumentA4Props["assets"]>;

/**
 * Template config (jsonb) → the banner/logo URLs DocumentA4 renders. The stored
 * values are used verbatim as image URLs: an app-absolute path like
 * "/brand/header.png" (served from apps/web/public) or a full external URL.
 * One resolver so the live preview and the print/PDF route stay in lock-step.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveDocAssets(config: any): DocAssets {
  return {
    headerBannerUrl: config?.header_banner_path || null,
    footerBannerUrl: config?.footer_banner_path || null,
    logoUrl: config?.logo_path || null,
  };
}
