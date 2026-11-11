// The DEMO tenant's id, in a module of its own (same reason as _sandbox.mjs: a wipe
// script must not run the setup script as a side effect of importing a constant).
//
// A third tenant, separate from the live shop (…0001) and from the rehearsal
// sandbox (…0002). It holds only invented data, so it can be shown to a prospect
// and wiped without touching anything real.
export const DEMO_TENANT = "33333333-3333-4333-8333-000000000003";
export const DEMO_EMAIL = "owner@demo.hazsoftware.test";
