package ec.cepi.telemedicina.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ec.cepi.telemedicina.api.AlmacenKeystore
import ec.cepi.telemedicina.api.ApiClient
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Config
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.chat.Imagenes
import ec.cepi.telemedicina.notificaciones.Canales
import ec.cepi.telemedicina.notificaciones.FuenteFcm
import ec.cepi.telemedicina.notificaciones.RegistroPush
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient

/**
 * Lo que vive lo mismo que el proceso: la config del arranque, la sesión, el cargador de
 * imágenes y el push. La API y las imágenes comparten un solo OkHttp (conexiones y hilos).
 */
class Entorno(
    val config: Config,
    val sesion: Sesion,
    val imagenes: Imagenes,
    val registroPush: RegistroPush,
    val fcm: FuenteFcm,
) {
    /** Para lo que no depende de una pantalla (registrar un token nuevo que llega por FCM). */
    val alcance = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** El `entity_id` de la notificación que se tocó; `Principal` abre su paciente y lo limpia. */
    var destinoPush: String? by mutableStateOf(null)

    /** Sube cada vez que llega un push con la app abierta: la bandeja se refresca. */
    var avisosNuevos: Int by mutableIntStateOf(0)

    companion object {
        fun crear(contexto: Context, config: Config): Entorno {
            val http = OkHttpClient()
            val credenciales = Credenciales(AlmacenKeystore(contexto))
            val api = CepiApi(ApiClient(config.apiBase, config.botBase, credenciales, http))
            val imagenes = Imagenes.crear(contexto, http, config.apiBase, credenciales, api)
            val fcm = FuenteFcm(contexto)
            val registro = RegistroPush(api, fcm)
            val sesion = Sesion(credenciales, api, antesDeSalir = { registro.olvidar() })
            return Entorno(config, sesion, imagenes, registro, fcm)
        }
    }
}

class CepiApp : Application() {
    private var entorno: Entorno? = null

    override fun onCreate() {
        super.onCreate()
        Canales.crear(this)
    }

    /** El entorno si ya se creó; el servicio de push no crea uno propio. */
    fun entornoActual(): Entorno? = entorno

    /**
     * Uno por proceso: la sesión sobrevive a la actividad. La config es la del primer
     * arranque; para probar otra en debug, relanzar con `am start -S`.
     */
    fun entorno(config: Config): Entorno =
        entorno ?: Entorno.crear(this, config).also { entorno = it }
}
