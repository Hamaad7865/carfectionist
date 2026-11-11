import { headers } from "next/headers";
import { brandForHost, type BrandInfo } from "./brand";

/** The brand for the current request (server components and layouts only). */
export async function getBrand(): Promise<BrandInfo> {
  const h = await headers();
  return brandForHost(h.get("x-forwarded-host") ?? h.get("host"));
}
