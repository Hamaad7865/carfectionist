import type { createClient } from "./server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Public URL for a product-photos object — the bucket is public and the URL never
 *  expires (unlike vehicle-photos/brand-assets), which is what lets the tablet cache
 *  it in its offline catalogue without the image going stale. Usable client- or
 *  server-side; no signing round-trip needed. */
export function productPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-photos/${path}`;
}

/** Sign a batch of vehicle-photos object paths for display (the bucket is private).
 *  Returns a path → signed-URL map; missing/failed paths are simply omitted. */
export async function signVehiclePhotos(
  sb: ServerClient,
  paths: string[],
  ttlSeconds = 3600,
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await sb.storage.from("vehicle-photos").createSignedUrls(unique, ttlSeconds);
  const map: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}
