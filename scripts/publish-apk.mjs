// Publish the tablet app so devices self-update.
//   node scripts/publish-apk.mjs "What's new in this build"                     (Carfectionist)
//   node scripts/publish-apk.mjs --brand tyrecentre "What's new in this build"  (Tyre Centre)
//
// Builds the SIGNED release APK of one brand flavor, uploads it to the public `app-releases`
// bucket, and writes that brand's manifest — the one its app reads on launch. Carfectionist's
// stays `latest.json` / `carfectionist-N.apk` at the bucket root (the tablets in the shop read
// exactly that); the tyre centre's lives under `tyrecentre/`, so neither app is ever offered
// the other's APK. versionCode comes from the git commit count (matching build.gradle.kts),
// so every published build outranks the last.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { SUPABASE_URL, SERVICE_ROLE_KEY, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_URL", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const brandAt = args.indexOf("--brand");
const BRAND = brandAt >= 0 ? args[brandAt + 1] : "carfectionist";
const BRANDS = {
  carfectionist: { task: ":app:assembleCarfectionistRelease", dir: "", appId: "mu.carfection.pos" },
  tyrecentre: { task: ":app:assembleTyrecentreRelease", dir: "tyrecentre/", appId: "mu.haz.tyrecentre.pos" },
};
const brand = BRANDS[BRAND];
if (!brand) throw new Error(`unknown --brand ${BRAND} — use ${Object.keys(BRANDS).join(" or ")}`);
const notes = args.filter((a, i) => !a.startsWith("--") && (brandAt < 0 || i !== brandAt + 1)).join(" ");
const BUCKET = "app-releases";
const APK = `android/app/build/outputs/apk/${BRAND}/release/app-${BRAND}-release.apk`;

/** aapt2, wherever the SDK put it, newest build-tools. */
function findAapt2() {
  const base = `${process.env.LOCALAPPDATA ?? `${process.env.HOME}/AppData/Local`}/Android/Sdk/build-tools`;
  const dirs = execSync(process.platform === "win32" ? `dir /b "${base}"` : `ls "${base}"`, { shell: true })
    .toString().trim().split(/\r?\n/).sort();
  const ver = dirs[dirs.length - 1];
  return `${base}/${ver}/aapt2${process.platform === "win32" ? ".exe" : ""}`;
}

// Build unless a fresh APK is already present (pass --no-build to always skip). The
// gradle wrapper differs by OS, so use the right one.
if (!args.includes("--no-build") || !existsSync(APK)) {
  console.log("Building signed release APK…");
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  try {
    execSync(`${gradlew} ${brand.task} --no-daemon -q`, { cwd: "android", stdio: "inherit" });
  } catch {
    if (!existsSync(APK)) throw new Error("gradle build failed and no prebuilt APK exists — build it first.");
    console.log("gradle reported an error but a built APK exists — publishing that.");
  }
}

// The manifest MUST describe the actual binary — read the version FROM the built APK,
// never recompute it, or a commit landing between build and publish makes the manifest
// claim a version the APK doesn't have, and tablets loop offering an update that never
// takes.
const badging = execSync(`"${findAapt2()}" dump badging "${APK}"`, { shell: true }).toString();
const versionCode = Number(/versionCode='(\d+)'/.exec(badging)?.[1]);
const versionName = /versionName='([^']+)'/.exec(badging)?.[1] ?? `0.1.${versionCode}`;
if (!Number.isFinite(versionCode)) throw new Error("could not read versionCode from the APK");
// The wrong brand's APK under this brand's manifest would install as a second app at best.
const pkg = /package: name='([^']+)'/.exec(badging)?.[1];
if (pkg !== brand.appId) throw new Error(`${APK} is ${pkg}, not ${brand.appId} — refusing to publish it as ${BRAND}`);
const apkName = `${brand.dir}${BRAND}-${versionCode}.apk`;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The bucket is public so a tablet can read the manifest and pull the APK before login.
await sb.storage.createBucket(BUCKET, { public: true }).then(
  () => console.log(`bucket ${BUCKET} created`),
  () => {}, // already exists
);

const apkBytes = readFileSync(APK);
console.log(`Uploading ${apkName} (${(apkBytes.length / 1e6).toFixed(1)} MB)…`);
let up = await sb.storage.from(BUCKET).upload(apkName, apkBytes, { contentType: "application/vnd.android.package-archive", upsert: true });
if (up.error) throw up.error;

const apkUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${apkName}`;
const manifest = { versionCode, versionName, url: apkUrl, notes, publishedAt: new Date().toISOString() };
up = await sb.storage.from(BUCKET).upload(`${brand.dir}latest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), { contentType: "application/json", upsert: true });
if (up.error) throw up.error;

console.log("\n✓ Published.");
console.log("  APK      :", apkUrl);
console.log("  manifest :", `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${brand.dir}latest.json`);
console.log("  version  :", versionName, `(code ${versionCode})`);
console.log("\nTablets on an older build will offer this update on their next launch.");
