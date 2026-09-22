package ec.cepi.telemedicina.api

import android.content.Intent
import ec.cepi.telemedicina.BuildConfig
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * A dónde habla la app. En debug se cambia sin recompilar con extras del intent, con los
 * mismos nombres que las variables de entorno de iOS (PAPER §25.3):
 *
 * ```
 * adb shell am start -S -n ec.cepi.telemedicina/.app.MainActivity \
 *   --es CEPI_API_BASE http://10.0.2.2:3001 --es CEPI_BOT_BASE http://10.0.2.2:3002 \
 *   --es CEPI_DEV_EMAIL primario@cepi.local --es CEPI_DEV_PASSWORD 'Admin123!'
 * ```
 *
 * En release los extras se ignoran (`ENTORNO_CONFIGURABLE`): nadie puede apuntar la app de
 * producción a otro servidor. Solo las aceptan debug y las variantes de medición.
 */
data class Config(
    /** TodoERP. */
    val apiBase: HttpUrl = PRODUCCION,
    /** cepi-bot. En producción nginx lo sirve en el mismo host bajo `/api/bot`; en local corre aparte (:3002). */
    val botBase: HttpUrl = apiBase,
    /** Donde se sirven los documentos de la web (`ficha.html`). */
    val webBase: HttpUrl = apiBase,
    /** Solo debug: entra solo con esta cuenta. */
    val devEmail: String? = null,
    val devPassword: String? = null,
    /** Solo debug: abre este paciente al entrar. */
    val devPaciente: String? = null,
) {
    companion object {
        val PRODUCCION = "https://telemedicina.cepi.ec".toHttpUrl()

        /**
         * Client ID **web** de Google (proyecto `cepi-500221`): Credential Manager lo pide como
         * `serverClientId` y el ID token sale con ese `aud`, que es el que ya valida el backend
         * (PAPER §25.4). No es secreto: viaja en cada login de la web.
         */
        const val GOOGLE_CLIENT_ID_WEB = "610463685358-muptdg7s0l598k05jladmmqcfml3gpeu.apps.googleusercontent.com"

        fun desde(intent: Intent?): Config {
            if (!BuildConfig.ENTORNO_CONFIGURABLE || intent == null) return Config()
            fun texto(clave: String) = intent.getStringExtra(clave)?.takeIf { it.isNotBlank() }
            fun url(clave: String) = texto(clave)?.toHttpUrlOrNull()
            val api = url("CEPI_API_BASE") ?: PRODUCCION
            return Config(
                apiBase = api,
                botBase = url("CEPI_BOT_BASE") ?: api,
                webBase = url("CEPI_WEB_BASE") ?: api,
                devEmail = texto("CEPI_DEV_EMAIL"),
                devPassword = texto("CEPI_DEV_PASSWORD"),
                devPaciente = texto("CEPI_DEV_PACIENTE"),
            )
        }
    }
}
