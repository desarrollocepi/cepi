plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.baselineprofile)
}

// Genera el Baseline Profile de la app recorriendo login → lista → paciente → galería
// contra el stack local (PAPER §25.5). Uso:
//   ./gradlew :app:generateBaselineProfile
// con un emulador o teléfono conectado (Android 13+) y TodoERP :3001 + cepi-bot :3002 arriba.
android {
    namespace = "ec.cepi.telemedicina.baselineprofile"
    compileSdk = 37

    defaultConfig {
        minSdk = 28
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
