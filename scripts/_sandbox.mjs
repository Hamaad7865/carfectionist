// The sandbox tenant's id, in a module of its own.
//
// It used to live in setup-sandbox.mjs, and reset-sandbox.mjs imported it from
// there — which ran the whole of setup as a side effect of asking for a constant.
// Harmless only because setup is idempotent. A wipe script should not create
// anything on its way to deleting things.
export const SANDBOX_TENANT = "22222222-2222-4222-8222-000000000002";
