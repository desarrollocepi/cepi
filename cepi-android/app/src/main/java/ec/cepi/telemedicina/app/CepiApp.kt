package ec.cepi.telemedicina.app

import android.app.Application
import android.content.Context
import ec.cepi.telemedicina.api.AlmacenKeystore
import ec.cepi.telemedicina.api.ApiClient
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Config
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.chat.Imagenes
import okhttp3.OkHttpClient

/**
 * Lo que vive lo mismo que el proceso: la config del arranque, la sesión y el cargador de
 * imágenes. La API y las imágenes comparten un solo OkHttp (conexiones y hilos).
 */
class Entorno(val config: Config, val sesion: Sesion, val imagenes: Imagenes) {
    companion object {
        fun crear(contexto: Context, config: Config): Entorno {
            val http = OkHttpClient()
            val credenciales = Credenciales(AlmacenKeystore(contexto))
            val api = CepiApi(ApiClient(config.apiBase, config.botBase, credenciales, http))
            val imagenes = Imagenes.crear(contexto, http, config.apiBase, credenciales, api)
            return Entorno(config, Sesion(credenciales, api), imagenes)
        }
    }
}

class CepiApp : Application() {
    private var entorno: Entorno? = null

    /**
     * Uno por proceso: la sesión sobrevive a la actividad. La config es la del primer
     * arranque; para probar otra en debug, relanzar con `am start -S`.
     */
    fun entorno(config: Config): Entorno =
        entorno ?: Entorno.crear(this, config).also { entorno = it }
}
