plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.baselineprofile)
}

// Genera el Baseline Profile de la app recorriendo login → lista → paciente → galería, y mide
// arranque, scroll y memoria (Macrobenchmark), contra el stack local (PAPER §25.5). Uso, con un
// teléfono o emulador conectado (Android 13+) y TodoERP :3001 + cepi-bot :3002 arriba:
//   ./gradlew :app:generateBaselineProfile
//   adb reverse tcp:3001 tcp:3001 && adb reverse tcp:3002 tcp:3002
//   ./gradlew :baselineprofile:connectedBenchmarkReleaseAndroidTest
android {
    namespace = "ec.cepi.telemedicina.baselineprofile"
    compileSdk = 37

    defaultConfig {
        minSdk = 28
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // En el emulador las mediciones corren igual, marcadas: los números que valen son los
        // del teléfono real (PAPER §25.5).
        testInstrumentationRunnerArguments["androidx.benchmark.suppressErrors"] = "EMULATOR"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    targetProjectPath = ":app"
}

baselineProfile {
    useConnectedDevices = true
}

dependencies {
    implementation(libs.test.ext.junit)
    implementation(libs.uiautomator)
    implementation(libs.benchmark.macro)
}
