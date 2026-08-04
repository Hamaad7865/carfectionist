import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// Supabase client config comes from local.properties (gitignored) → BuildConfig.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun prop(key: String) = localProps.getProperty(key) ?: ""

// local.properties is GITIGNORED, so a build from a git worktree or a fresh clone
// silently gets none of it — and an APK with a blank Supabase URL and device key is
// not a degraded app, it is a brick: it cannot reach the roster, so it opens on
// "PIN login isn't set up on this tablet yet" and no one can sign in. That APK looks
// exactly like a good one on disk, installs over a working build, and would lock
// every tablet in the shop out if it ever reached publish-apk.
//
// So the build refuses instead. Copy android/local.properties into the worktree.
run {
    val missing = listOf("supabase.url", "supabase.anonKey", "pos.deviceKey").filter { prop(it).isBlank() }
    if (missing.isNotEmpty()) {
        throw GradleException(
            "Missing ${missing.joinToString(", ")} in ${rootProject.file("local.properties")}.\n" +
                "local.properties is gitignored, so worktrees and fresh clones do not have it. " +
                "Copy it in from the main checkout (C:/Projects/Carfection/android/local.properties) before building.\n" +
                "Building without it produces an APK that cannot sign anybody in.",
        )
    }
}

// Release signing comes from keystore.properties (gitignored). Absent on a fresh
// checkout / CI without the secret → release builds fall back to debug signing.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseKey = keystoreProps.getProperty("storeFile") != null

// versionCode auto-increments off the git commit count, so every published build
// outranks the one before it and the in-app updater can compare reliably. Uses the
// config-cache-safe providers.exec; falls back to 1 if git isn't available.
val gitVersionCode: Int = try {
    providers.exec {
        commandLine("git", "rev-list", "--count", "HEAD")
        workingDir = rootProject.projectDir
    }.standardOutput.asText.get().trim().toIntOrNull() ?: 1
} catch (_: Exception) { 1 }

android {
    namespace = "mu.carfection.pos"
    compileSdk = 35

    defaultConfig {
        applicationId = "mu.carfection.pos"
        minSdk = 26
        targetSdk = 35
        versionCode = gitVersionCode
        versionName = "0.1.$gitVersionCode"
        buildConfigField("String", "SUPABASE_URL", "\"${prop("supabase.url")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${prop("supabase.anonKey")}\"")
        // Staff-PIN login and "Send to customer" talk to the web app's server-side routes
        // (service-role, the PDF engine, the email + WhatsApp bindings all stay there).
        // DEFAULTS TO PRODUCTION on purpose: a tablet built with a stale local.properties
        // pointing at somebody's laptop can't reach it, and every send dies with
        // "Failed to connect to /192.168.x.x:3000". Point pos.webUrl at a dev machine only
        // when you are actually developing against one.
        buildConfigField("String", "POS_WEB_URL", "\"${prop("pos.webUrl").ifBlank { "https://app-carfectionist.com" }}\"")
        buildConfigField("String", "POS_DEVICE_KEY", "\"${prop("pos.deviceKey")}\"")
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // The stable release identity — every update must be signed with this same
            // key to install over the last one. Falls back to debug when the key is absent.
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests {
            // android.util.Log is a stub in unit tests and THROWS by default. Logic worth
            // testing (the offline-sale queue) logs as it works, and a logging call must
            // never be what decides whether a test passes.
            isReturnDefaultValues = true
        }
    }
}

hilt {
    // Without this, NO unit test can run from a clean build tree. The aggregating task
    // (hiltJavaCompileDebugUnitTest) re-validates @HiltAndroidApp in a javac pass where
    // PosApplication's superclass resolves to the GENERATED Hilt_PosApplication rather than
    // Application, so the build dies with "@HiltAndroidApp base class must extend Application.
    // Found: Hilt_PosApplication". It only ever passed incrementally off a warm app build, so a
    // green test run meant nothing about whether the tests could actually run. Turning the task
    // off moves Hilt's processing into KSP, which resolves the superclass correctly.
    enableAggregatingTask = false
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.work.runtime.ktx)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    implementation(libs.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.postgrest)
    implementation(libs.supabase.auth)
    implementation(libs.supabase.storage)
    implementation(libs.supabase.realtime)
    implementation(libs.ktor.client.okhttp)

    implementation(libs.coil.compose)

    testImplementation("junit:junit:4.13.2")
    testImplementation(libs.kotlinx.coroutines.test)
}
