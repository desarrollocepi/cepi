package ec.cepi.telemedicina.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ec.cepi.telemedicina.api.AccionPendiente
import ec.cepi.telemedicina.api.Adjunto
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Derivado
import ec.cepi.telemedicina.api.FormularioBot
import ec.cepi.telemedicina.api.Marcador
import ec.cepi.telemedicina.api.MensajeHilo
import ec.cepi.telemedicina.api.RespuestaChat
import ec.cepi.telemedicina.api.RespuestaRapida
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Un paciente: su hilo con los mensajes de todos y lo que se le manda al asistente. Espejo de
 * `HiloModelo.swift` e IntakeChat.vue: se escribe en la sesión propia y, tras cada turno, se
 * relee el hilo para que Android, iOS y la web muestren lo mismo (PAPER §24.4).
 *
 * `alcance` es el de la pantalla del paciente: la apertura vive lo que vive esa pantalla. El
 * auto-form es de cada paciente y lo guarda quien crea el modelo (`alCambiarAutoFormulario`).
 */
class HiloModelo(
    val pacienteId: String,
    private val api: CepiApi,
    private val alcance: CoroutineScope,
    autoFormularioInicial: Boolean = false,
    private val alCambiarAutoFormulario: (Boolean) -> Unit = {},
) {
    var mensajes: List<MensajeHilo> by mutableStateOf(emptyList())
        private set
    var pendiente: AccionPendiente? by mutableStateOf(null)
        private set
    var respuestasRapidas: List<RespuestaRapida> by mutableStateOf(emptyList())
        private set
    var episodioActivo: String? by mutableStateOf(null)
        private set

    /** A quién está derivada la consulta activa ahora mismo (revisiones pendientes). */
    var derivados: List<Derivado> by mutableStateOf(emptyList())
        private set
    var pagina: PaginaHilo by mutableStateOf(PaginaHilo.MasNueva)
        private set
    var ocupado: Boolean by mutableStateOf(false)
        private set
    var subiendo: Boolean by mutableStateOf(false)
        private set
    var adjunto: Adjunto? by mutableStateOf(null)
        private set
    var error: String? by mutableStateOf(null)
    /** El grupo de la ficha que se está llenando, o nada. */
    var formulario: FormularioBot? by mutableStateOf(null)
        private set
    var marcadores: List<Marcador> by mutableStateOf(emptyList())
        private set

    /**
     * Encendido: tras abrir y tras cada guardado se muestra el siguiente grupo sin completar.
     * Apagado (por defecto): solo el grupo pedido en "Secciones".
     */
    var autoFormulario: Boolean by mutableStateOf(autoFormularioInicial)
        private set

    /**
     * El hilo guardado llegó al menos una vez. Hasta entonces la pantalla dice "Cargando…" y no
     * "Sin consultas todavía", que se leía como que el paciente no tenía ficha.
     */
    var cargado: Boolean by mutableStateOf(false)
        private set

    /**
     * El episodio que eligió el navegador y el bot todavía no confirmó (pendiente o en curso);
     * `null` si no hay cambio en marcha. El chat lo trata como el activo mientras tanto.
     */
    var episodioDestino: String? by mutableStateOf(null)
        private set

    /** Se está cambiando de episodio en silencio: no hay «escribiendo…». */
    var cambiandoEpisodio: Boolean by mutableStateOf(false)
        private set

    /** La activación del paciente terminó (bien o mal): desde ahí el navegador puede cambiar. */
    var abierto: Boolean by mutableStateOf(false)
        private set

    /** El último episodio elegido que espera a que el chat quede libre. */
    private var cambioPendiente: String? = null

    private var sesionId: String? = null
    private var apertura: Deferred<Unit>? = null

    val episodios: Episodios get() = Episodios(mensajes, episodioActivo)

    /**
     * Al abrir: reanuda la sesión abierta propia (o crea una) activando al paciente. El bot
     * saluda y dice qué falta de la ficha sin pasar por el LLM. Una sola apertura aunque se
     * llame dos veces: la segunda espera a la primera (en iOS, sin esto el hilo se quedaba en
     * "Cargando la información…").
     */
    suspend fun abrir() {
        val enCurso = apertura ?: alcance.async { activar() }.also { apertura = it }
        enCurso.await()
    }

    private suspend fun activar() = coroutineScope {
        // Lo guardado se pide ya, en paralelo con la activación del bot (que en producción
        // tarda): así se ve lo que hay en cuanto llega, sin esperar al saludo.
        val historial = launch { releer() }
        ocupado = true
        try {
            val propia = try {
                api.sesionesBot(pacienteId).firstOrNull { it.pacienteActivo == pacienteId && it.estado == "abierta" }
            } catch (_: ApiError) {
                null
            }
            aplicar(api.chat("activar paciente $pacienteId", propia?.id))
            historial.join()
            releer()
        } catch (e: ApiError) {
            historial.join()
            error = e.mensaje
        } finally {
            ocupado = false
            abierto = true
            if (cambioPendiente != null) alcance.launch { aplicarCambioPendiente() }
        }
    }

    /** Envía un mensaje (con la foto adjunta, si hay). Devuelve si el bot lo procesó. */
    /** `accionExplicita`: lo disparó un botón (derivar), así que el bot no pide sí/no. */
    suspend fun enviar(texto: String, accionExplicita: Boolean = false): Boolean {
        val limpio = texto.trim()
        val foto = adjunto
        val mensaje = if (foto == null) limpio else {
            (if (limpio.isEmpty()) "" else "$limpio\n") + "[adjunto: ${foto.nombre} · ${foto.id}]"
        }
        if (mensaje.isEmpty() || ocupado) return false
        adjunto = null
        // Un botón (Nueva consulta, derivar…) pidió esto: el formulario que traiga la respuesta
        // se muestra aunque «Auto» esté apagado, igual que al pedir una sección.
        return turno(eco = mensaje, explicito = accionExplicita) { sesion ->
            api.chat(mensaje, sesion, explicito = accionExplicita)
        }
    }

    /** Un envío estructurado: un grupo de la ficha, "ir a sección" o guardar el visor. */
    suspend fun enviarFormulario(
        id: String,
        datos: JsonObject,
        episodio: String? = null,
        explicito: Boolean = false,
    ): Boolean = turno(eco = null, explicito = explicito) { sesion -> api.enviarFormulario(id, datos, sesion, episodio) }

    /** Lo pedido en "Secciones" se muestra siempre, aunque el auto-form esté apagado. */
    suspend fun abrirSeccion(marcador: Marcador) {
        enviarFormulario("ficha_goto", JsonObject(mapOf("group" to JsonPrimitive(marcador.id))), explicito = true)
    }

    fun cerrarFormulario() {
        formulario = null
    }

    suspend fun alternarAutoFormulario() {
        autoFormulario = !autoFormulario
        alCambiarAutoFormulario(autoFormulario)
        // Encenderlo arranca por la primera sección pendiente.
        if (autoFormulario) marcadores.firstOrNull { !it.hecho }?.let { abrirSeccion(it) }
    }

    /**
     * El navegador de episodios eligió otro episodio estando en el Chat (PAPER §28.4.1). El hilo
     * muestra ya sus mensajes y el bot lo activa en silencio (`episode_switch`): sin eco, sin
     * burbuja y sin turnos nuevos en el hilo. Si el chat está ocupado, el cambio queda pendiente y
     * se aplica al terminar; si se elige otro mientras tanto, gana el último.
     */
    fun cambiarEpisodio(id: String) {
        pagina = PaginaHilo.Consulta(id)
        if (id == episodioActivo && episodioDestino == null) return
        episodioDestino = id
        cambioPendiente = id
        if (!ocupado) alcance.launch { aplicarCambioPendiente() }
    }

    private suspend fun aplicarCambioPendiente() {
        while (!ocupado) {
            val id = cambioPendiente ?: return
            cambioPendiente = null
            if (id != episodioActivo) {
                cambiandoEpisodio = true
                try {
                    // «Auto» decide si se muestra el formulario que trae: no es explícito.
                    turno(eco = null, explicito = false) { sesion ->
                        api.enviarFormulario(EPISODE_SWITCH, episodeSwitchData(id), sesion, null)
                    }
                } finally {
                    cambiandoEpisodio = false
                }
            }
            if (cambioPendiente == null) episodioDestino = null
        }
    }

    /** Mirar un episodio en el hilo sin activarlo (el navegador se movió en otra sección). */
    fun mirarConsulta(id: String?) {
        if (id != null) pagina = PaginaHilo.Consulta(id)
    }

    suspend fun subir(jpeg: ByteArray, nombre: String) {
        subiendo = true
        error = null
        try {
            adjunto = api.subirImagen(jpeg, nombre)
        } catch (e: ApiError) {
            error = "No se pudo subir la foto: ${e.mensaje}"
        } finally {
            subiendo = false
        }
    }

    fun quitarAdjunto() {
        adjunto = null
    }

    suspend fun releer() {
        try {
            mensajes = api.hilo(pacienteId)
            cargado = true
            releerDerivaciones()
        } catch (e: ApiError) {
            error = "No se pudo cargar el hilo: ${e.mensaje}"
        }
    }

    /**
     * Quién tiene pendiente esta consulta. Un fallo acá no molesta al hilo: se muestra sin la
     * barra de "derivado a…" y se reintenta en la próxima relectura.
     */
    suspend fun releerDerivaciones() {
        val episodio = episodioActivo
        derivados = if (episodio == null) emptyList() else try {
            api.derivaciones(episodio)
        } catch (_: ApiError) {
            emptyList()
        }
    }

    fun volverALaActual() {
        pagina = PaginaHilo.Consulta(episodioActivo)
    }

    private suspend fun turno(eco: String?, explicito: Boolean, ejecutar: suspend (String?) -> RespuestaChat): Boolean {
        if (ocupado) return false
        error = null
        respuestasRapidas = emptyList()
        if (eco != null) mensajes = mensajes + MensajeHilo.eco(eco, episodioActivo)
        ocupado = true
        try {
            val procesado = try {
                // La sesión propia se crea recién al primer envío: mirar un paciente no la crea.
                if (sesionId == null) aplicar(api.chat("activar paciente $pacienteId", null))
                aplicar(ejecutar(sesionId), explicito)
                true
            } catch (e: ApiError) {
                error = e.mensaje
                false
            }
            // Tras un éxito trae el turno ya atribuido; tras un fallo quita el eco, para que no
            // quede un mensaje "enviado" al lado del error.
            releer()
            return procesado
        } finally {
            ocupado = false
            // Un cambio de episodio que llegó mientras el chat estaba ocupado no se pierde.
            if (cambioPendiente != null) alcance.launch { aplicarCambioPendiente() }
        }
    }

    private fun aplicar(respuesta: RespuestaChat, explicito: Boolean = false) {
        respuesta.sessionId?.let { sesionId = it }
        if (respuesta.traePendiente) pendiente = respuesta.pendiente
        respuestasRapidas = respuesta.respuestasRapidas
        if (respuesta.traeFormulario) formulario = if (explicito || autoFormulario) respuesta.formulario else null
        respuesta.marcadores?.let { marcadores = it }
        if (respuesta.traeEpisodioActivo) {
            episodioActivo = respuesta.episodioActivo
            // Abrir, enviar o abrir consulta nueva lleva a mirar la consulta activa, salvo que el
            // navegador ya haya elegido otro episodio que espera su turno: ese gana.
            if (cambioPendiente == null) pagina = PaginaHilo.Consulta(respuesta.episodioActivo)
        }
    }
}

/** El cambio silencioso de episodio de cepi-bot (PAPER §28.4.1). */
const val EPISODE_SWITCH = "episode_switch"

/** Los datos del `form_submission` de `episode_switch`. Sin red, para probarlo. */
fun episodeSwitchData(episodeId: String): JsonObject = JsonObject(mapOf("episode_id" to JsonPrimitive(episodeId)))
