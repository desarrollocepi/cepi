plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.baselineprofile)
}

android {
    namespace = "ec.cepi.telemedicina"
    compileSdk = 37

    defaultConfig {
        // El mismo paquete que la APK Capacitor y que Firebase: la app nativa llega como
        // actualización de la misma ficha de Play (PAPER §25.7).
        applicationId = "ec.cepi.telemedicina"
        // El de la APK: nadie que ya la tiene queda sin actualización.
        minSdk = 24
        targetSdk = 36
        // La APK Capacitor va en 2.
        versionCode = 3
        versionName = "2.0.0"
    }

    buildTypes {
        debug {
            // Extras CEPI_* del intent (Config.kt): backend local, ingreso automático.
            buildConfigField("boolean", "ENTORNO_CONFIGURABLE", "true")
        }
        release {
            // La que va a Play: nadie la apunta a otro servidor.
            buildConfigField("boolean", "ENTORNO_CONFIGURABLE", "false")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // java.time en Android 7 (minSdk 24): las fechas ISO del backend.
        isCoreLibraryDesugaringEnabled = true
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        // Los tests corren en la JVM, sin emulador: una llamada suelta al framework
        // (android.util.Log) devuelve el valor por defecto en vez de reventar.
        unitTests.isReturnDefaultValues = true
    }
}

// Las variantes de medición (Baseline Profile y Macrobenchmark) son release sin minificar o
// sin firmar, y corren contra el stack local con datos ficticios: aceptan los extras y la red en
// claro de debug. Nunca se publican; `release` sigue cerrada.
androidComponents {
    onVariants(selector().withBuildType("nonMinifiedRelease")) { variante -> paraMedir(variante) }
    onVariants(selector().withBuildType("benchmarkRelease")) { variante -> paraMedir(variante) }
}

fun paraMedir(variante: com.android.build.api.variant.ApplicationVariant) {
    variante.buildConfigFields?.put(
        "ENTORNO_CONFIGURABLE",
        com.android.build.api.variant.BuildConfigField("boolean", "true", "variante de medición"),
    )
    variante.sources.res?.addStaticSourceDirectory("src/debug/res")
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.okhttp)
    implementation(libs.profileinstaller)
    coreLibraryDesugaring(libs.desugar.jdk.libs)
    baselineProfile(project(":baselineprofile"))
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
}
