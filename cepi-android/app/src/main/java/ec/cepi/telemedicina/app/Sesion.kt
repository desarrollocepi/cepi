package ec.cepi.telemedicina.app

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ec.cepi.telemedicina.api.AlmacenKeystore
import ec.cepi.telemedicina.api.ApiClient
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Config
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.Usuario
import okhttp3.OkHttpClient

/**
 * Estado de la sesión y única puerta de entrada y salida. Espejo de `Sesion.swift` y de
 * `refresh()`/`onLogout()` en `App.vue`.
 *
 * Solo un 401 manda al login. Si un fallo pasajero de `/me` (recarga, cambio de org, 5xx,
 * 429) mostrara el login, la gente vuelve a entrar con Google una y otra vez hasta agotar el
 * rate-limit de `/auth/google`: pasó en la web. `SesionTest` lo fija.
 */
class Sesion(
    private val credenciales: Credenciales,
    val api: CepiApi,
    private val reloj: () -> Long = System::currentTimeMillis,
) {
    sealed interface Estado {
        data object Cargando : Estado
        data object SinSesion : Estado
        /** Cuenta activa pero todavía sin rol clínico (`role = 'pendiente'`). */
        data object Pendiente : Estado
        data object Activa : Estado
        /** Hay token pero no se pudo validar (sin red, servidor caído). No es motivo para cerrar la sesión: se reintenta. */
        data class SinValidar(val motivo: String) : Estado
    }

    var estado: Estado by mutableStateOf(Estado.Cargando)
        private set
    var usuario: Usuario? by mutableStateOf(null)
        private set
    /** Mientras se cambia de org: la lista muestra la espera en vez de la org anterior. */
    var cambiandoOrganizacion: Boolean by mutableStateOf(false)
        private set

    private var ultimaRenovacion = 0L

    init {
        credenciales.alExpirar = { cerrarLocal() }
    }

    /**
     * Al abrir la app: si hay token guardado, validarlo y traer el usuario. Una vez por
     * proceso; recrear la actividad no vuelve a pedir `/me`. `olvidarToken` (solo debug, con
     * `CEPI_DEV_EMAIL`) entra siempre con la cuenta de desarrollo.
     */
    suspend fun restaurar(olvidarToken: Boolean = false) {
        if (estado != Estado.Cargando) return
        if (olvidarToken) credenciales.guardar(null)
        if (credenciales.token() == null) {
            estado = Estado.SinSesion
            return
        }
        renovar()
    }

    /**
     * Sesión deslizante: `/me` reemite el JWT (8 h). Se llama al abrir y al volver a primer
     * plano, así quien usa la app a diario no vuelve a ver el login.
     */
    suspend fun renovar() {
        try {
            val respuesta = api.yo()
            credenciales.guardar(respuesta.token)
            ultimaRenovacion = reloj()
            aplicar(respuesta.user)
        } catch (e: ApiError) {
            if (e.status == 401) {
                cerrarLocal()
            } else if (usuario == null) {
                // Con el usuario ya cargado, un fallo al renovar no interrumpe el trabajo: se
                // reintenta la próxima vez que la app vuelva a primer plano.
                estado = Estado.SinValidar(e.mensaje)
            }
        }
    }

    suspend fun renovarSiHaceFalta() {
        if (usuario == null || reloj() - ultimaRenovacion <= 30 * 60 * 1000L) return
        renovar()
    }

    suspend fun entrar(email: String, password: String) {
        val respuesta = api.login(email.trim().lowercase(), password)
        credenciales.guardar(respuesta.token)
        renovar()
    }

    /**
     * La org activa viaja en el JWT: cambiarla reemite el token, y lo que depende de la org (la
     * lista de pacientes) se recarga al ver el `orgActiva` nuevo.
     */
    suspend fun cambiarOrganizacion(id: String) {
        if (id == usuario?.orgActiva) return
        cambiandoOrganizacion = true
        try {
            api.cambiarOrganizacion(id).token?.let { credenciales.guardar(it) }
            renovar()
        } finally {
            cambiandoOrganizacion = false
        }
    }

    suspend fun salir() {
        credenciales.guardar(null)
        cerrarLocal()
    }

    /**
     * La sesión se cierra solo si el servidor confirmó el borrado. Si falla (último
     * administrador, sin red, 5xx) la sesión sigue abierta y el error sube a la pantalla.
     */
    suspend fun eliminarCuenta() {
        api.eliminarCuenta()
        salir()
    }

    private fun aplicar(usuario: Usuario) {
        this.usuario = usuario
        estado = if (usuario.role == "pendiente") Estado.Pendiente else Estado.Activa
    }

    private fun cerrarLocal() {
        usuario = null
        estado = Estado.SinSesion
    }

    companion object {
        fun crear(contexto: Context, config: Config): Sesion {
            val credenciales = Credenciales(AlmacenKeystore(contexto))
            val cliente = ApiClient(config.apiBase, config.botBase, credenciales, OkHttpClient())
            return Sesion(credenciales, CepiApi(cliente))
        }
    }
}
