import Link from "next/link";
import { getBusinessProfile } from "@/lib/supabase/queries/settings";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { BusinessProfileForm } from "@/features/settings/BusinessProfileForm";

export default async function SettingsPage() {
  const profile = await getBusinessProfile();

  return (
    <div className="p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="business" />
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Business profile</h2>
        <p className="mt-1 text-[13px] text-muted">Legal identity, contact and bank details — these appear on your quotes and invoices.</p>
        <div className="mt-6">
          {profile ? (
            <BusinessProfileForm profile={profile} />
          ) : (
            <p className="text-sm text-muted">
              No business settings found. Reseed the database (<Link href="/dashboard" className="text-link">dashboard</Link>).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
