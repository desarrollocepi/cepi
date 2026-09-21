plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
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
        release {
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
    implementation(libs.profileinstaller)
    coreLibraryDesugaring(libs.desugar.jdk.libs)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
}
