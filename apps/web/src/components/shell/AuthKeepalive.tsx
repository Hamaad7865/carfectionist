"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

/**
 * Session keep-alive. Cloudflare Workers (OpenNext) can't run Next 16's
 * Node-only proxy/middleware, so token refresh moved here: the browser Supabase
 * client auto-refreshes the access token and writes it to the shared cookies
 * the server reads. If the session ends (refresh token invalid), bounce to
 * login. Route protection itself stays server-side (the (app) layout + RLS).
 */
export function AuthKeepalive() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
      else if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") router.refresh();
    });
    // Kick the auto-refresh timer.
    void supabase.auth.getSession();
    return () => data.subscription.unsubscribe();
  }, [router]);
  return null;
}
