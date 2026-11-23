"use client";

import { createContext, useContext } from "react";

/** What this shop offers, for client components deep in the tree (a send button on a list
 *  row has no session to ask). Set once by AppShell from the tenant; the server actions check
 *  the same rule again (roles.ts hasWhatsApp), so a hidden button is never the only guard.
 *  Outside the app shell nothing is hidden — the server still refuses. */
type ShopFeatures = { whatsapp: boolean };

const Ctx = createContext<ShopFeatures>({ whatsapp: true });

export function ShopFeaturesProvider({ whatsapp, children }: { whatsapp: boolean; children: React.ReactNode }) {
  return <Ctx.Provider value={{ whatsapp }}>{children}</Ctx.Provider>;
}

/** False for a shop with no WhatsApp (the tyre centre): drop every WhatsApp option. */
export function useWhatsApp(): boolean {
  return useContext(Ctx).whatsapp;
}
