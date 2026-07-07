import type { createClient } from "./server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

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
