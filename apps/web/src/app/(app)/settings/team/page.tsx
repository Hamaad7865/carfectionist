import { getSessionContext } from "@/lib/auth/session";
import { getTeam } from "@/lib/supabase/queries/settings";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { TeamPanel } from "@/features/settings/TeamPanel";

export default async function TeamSettingsPage() {
  const [session, members] = await Promise.all([getSessionContext(), getTeam()]);
  const canManage = session?.role === "owner";

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="team" />
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Team &amp; roles</h2>
        <p className="mt-1 text-[13px] text-muted">
          {canManage ? "Add staff, set roles and deactivate access. Roles control what each person can see and do." : "Your team. Only an owner can add staff or change roles."}
        </p>
        <div className="mt-6">
          <TeamPanel members={members} canManage={canManage} />
        </div>
      </div>
    </div>
  );
}
