package ec.cepi.telemedicina.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import java.time.Instant

/**
 * Un mensaje del hilo del paciente (`GET /api/patient-thread`): los turnos de todos los
 * profesionales y del asistente, en orden y con su autor.
 */
@Serializable
data class MensajeHilo(
    @SerialName("role") val rol: String = "assistant",
    @SerialName("content") val contenido: String = "",
    @SerialName("author_id") val autorId: String? = null,
    @SerialName("author_name") val autorNombre: String? = null,
    /** Lo escribió quien está usando la app. */
    @SerialName("self") val propio: Boolean = false,
    @SerialName("is_bot") val esBot: Boolean = false,
    val ts: String? = null,
    /** La consulta (episodio) del turno; la sella el bot. */
    @SerialName("episode_id") val episodio: String? = null,
) {
    val fecha: Instant? get() = Fechas.iso(ts)

    companion object {
        /**
         * Eco de lo que se acaba de enviar, visible mientras el bot responde; la relectura del
         * hilo lo reemplaza por el turno real. Va en la consulta activa para no desaparecer de
         * la página que se está mirando.
         */
        fun eco(contenido: String, episodio: String?) =
            MensajeHilo(rol = "user", contenido = contenido, propio = true, episodio = episodio)
    }
}

@Serializable
data class HiloRespuesta(@SerialName("messages") val mensajes: List<MensajeHilo> = emptyList())

/** Botón que propone el bot: al tocarlo se envía `send` como mensaje. */
@Serializable
data class RespuestaRapida(val label: String, val send: String)

/** Escritura inferida que espera el sí/no del usuario (PAPER §13.3.1). */
@Serializable
data class AccionPendiente(val summary: String)

/**
 * `POST /api/bot/chat`. Que una clave no venga no es lo mismo que venga en `null`:
 * `IntakeChat.vue` solo cambia el pendiente o la consulta activa cuando la clave está. Por eso
 * se arma a mano desde el objeto y no con un serializador.
 */
class RespuestaChat(
    val sessionId: String?,
    val texto: String?,
    val respuestasRapidas: List<RespuestaRapida>,
    val traePendiente: Boolean,
    val pendiente: AccionPendiente?,
    val traeEpisodioActivo: Boolean,
    val episodioActivo: String?,
    /** `form` presente (objeto o `null`) cambia el formulario activo; ausente, lo deja. */
    val traeFormulario: Boolean = false,
    val formulario: FormularioBot? = null,
    /** Secciones de la ficha; `null` si no vinieron. */
    val marcadores: List<Marcador>? = null,
) {
    companion object {
        fun desde(objeto: JsonObject): RespuestaChat {
            fun texto(clave: String) = (objeto[clave] as? JsonPrimitive)?.contentOrNull
            return RespuestaChat(
                sessionId = texto("session_id"),
                texto = texto("text"),
                respuestasRapidas = (objeto["quick_replies"] as? JsonArray)
                    ?.let { jsonCepi.decodeFromJsonElement<List<RespuestaRapida>>(it) }
                    .orEmpty(),
                traePendiente = "pending_action" in objeto,
                pendiente = (objeto["pending_action"] as? JsonObject)
                    ?.let { jsonCepi.decodeFromJsonElement<AccionPendiente>(it) },
                traeEpisodioActivo = "active_episode_id" in objeto,
                episodioActivo = texto("active_episode_id"),
                traeFormulario = "form" in objeto,
                formulario = (objeto["form"] as? JsonObject)?.let { jsonCepi.decodeFromJsonElement<FormularioBot>(it) },
                marcadores = (objeto["bookmarks"] as? JsonArray)?.let { jsonCepi.decodeFromJsonElement<List<Marcador>>(it) },
            )
        }
    }
}

/** `GET /api/bot/sessions`: las sesiones propias con el bot. */
@Serializable
data class SesionesBot(@SerialName("sessions") val sesiones: List<SesionBot> = emptyList())

@Serializable
data class SesionBot(
    val id: String,
    @SerialName("active_patient_id") val pacienteActivo: String? = null,
    val estado: String? = null,
)

/** La fila de `attachments` que devuelve `POST /api/attachments` al subir un archivo. */
@Serializable
data class Adjunto(
    val id: String,
    @SerialName("original_name") val nombreOriginal: String? = null,
    val filename: String? = null,
) {
    val nombre: String get() = nombreOriginal ?: filename ?: "imagen"
}

/**
 * Una imagen clínica en la galería: la foto más lo que hace falta para reconocer el caso sin
 * abrirlo (`GET /api/bot/galeria`, PAPER §24.2.1).
 */
@Serializable
data class ImagenGaleria(
    val id: String,
    @SerialName("attachment_id") val adjunto: String,
    @SerialName("patient_id") val pacienteId: String? = null,
    val paciente: String? = null,
    val cedula: String? = null,
    @SerialName("episode_id") val episodioId: String? = null,
    val fecha: String? = null,
    val diagnostico: String? = null,
    @SerialName("codigo_cie10") val codigoCIE10: String? = null,
    @SerialName("body_region") val region: String? = null,
)

/** `GET /api/bot/galeria`: la página pedida y cuántas hay en total. */
@Serializable
data class RespuestaGaleria(val data: List<ImagenGaleria> = emptyList(), val total: Int? = null)
