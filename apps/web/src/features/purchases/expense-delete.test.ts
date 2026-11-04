import { describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/supabase/fake-admin";

// Deleting an expense is irreversible: the numbers vanish from the VAT/P&L
// reports, so the action must (a) only ever touch this shop's rows and (b) leave
// a permanent audit record of what was removed and by whom.

const { TENANT, OTHER_TENANT, AUTH_USER, APP_USER } = vi.hoisted(() => ({
  TENANT: "11111111-1111-4111-8111-000000000001",
  OTHER_TENANT: "22222222-2222-4222-8222-000000000002",
  AUTH_USER: "aaaaaaaa-0000-4000-8000-000000000001",
  APP_USER: "bbbbbbbb-0000-4000-8000-000000000002",
}));

let db: unknown;

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => ({
    userId: AUTH_USER,
    tenantId: TENANT,
    role: "owner",
    displayName: "Hamaad",
    modules: null,
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteExpenseAction } from "./actions";

const expense = {
  id: "cccccccc-0000-4000-8000-000000000003",
  tenant_id: TENANT,
  category: "Equipment",
  description: "1 caisse oval",
  amount: 899,
  vat_amount: 134.85,
  status: "paid",
  expense_date: "2026-11-04",
};

const appUsers = [{ id: APP_USER, auth_user_id: AUTH_USER, tenant_id: TENANT }];

describe("deleteExpenseAction", () => {
  it("removes the row and keeps what it was in the audit trail", async () => {
    const tables = { expenses: [{ ...expense }], app_users: appUsers, audit_events: [] as Record<string, unknown>[] };
    db = fakeAdmin(tables);

    const r = await deleteExpenseAction(expense.id);

    expect(r).toEqual({ ok: true });
    expect(tables.expenses).toHaveLength(0);
    expect(tables.audit_events).toHaveLength(1);
    expect(tables.audit_events[0]).toMatchObject({
      tenant_id: TENANT,
      actor_id: APP_USER,
      event_type: "expense.deleted",
      ref_type: "expense",
      ref_id: expense.id,
      payload: {
        description: "1 caisse oval",
        category: "Equipment",
        amount: 899,
        vat: 134.85,
        status: "paid",
        date: "2026-11-04",
      },
    });
  });

  it("will not delete another shop's expense even when given its id", async () => {
    const tables = {
      expenses: [{ ...expense, tenant_id: OTHER_TENANT }],
      app_users: appUsers,
      audit_events: [] as Record<string, unknown>[],
    };
    db = fakeAdmin(tables);

    const r = await deleteExpenseAction(expense.id);

    expect(r).toEqual({ ok: false, error: "Expense not found — it may have been deleted already." });
    expect(tables.expenses).toHaveLength(1);
    expect(tables.audit_events).toHaveLength(0);
  });

  it("rejects a malformed id before touching the database", async () => {
    const tables = { expenses: [{ ...expense }], app_users: appUsers, audit_events: [] as Record<string, unknown>[] };
    db = fakeAdmin(tables);

    const r = await deleteExpenseAction("not-an-id");

    expect(r).toEqual({ ok: false, error: "Invalid expense" });
    expect(tables.expenses).toHaveLength(1);
    expect(tables.audit_events).toHaveLength(0);
  });
});
