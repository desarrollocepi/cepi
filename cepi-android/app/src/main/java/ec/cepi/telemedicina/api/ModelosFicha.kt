package ec.cepi.telemedicina.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.buildJsonObject

// Formularios que manda el bot (BotForm en cepi-bot/src/flowV1.ts)

/**
 * Un formulario que el bot pide pintar. La ficha llega así, grupo por grupo
 * (`ficha_grp_g_4_6`…), y la app no conoce los grupos: solo los tipos de campo (PAPER §24.3).
 */
@Serializable
data class FormularioBot(
    val id: String,
    @SerialName("title") val titulo: String = "",
    @SerialName("fields") val campos: List<CampoFormulario> = emptyList(),
    @SerialName("submit_label") val textoEnviar: String? = null,
    /** Plantilla del mensaje al enviar (`{clave}`), para los formularios que no son estructurados. */
    @SerialName("submit_send") val plantillaEnvio: String? = null,
    @SerialName("submit_mode") val modo: String? = null,
    /** Botones secundarios ("Omitir"): envían su `send` como mensaje. */
    @SerialName("actions") val acciones: List<RespuestaRapida> = emptyList(),
    /** Valores ya guardados, para abrir el grupo prellenado. */
    @SerialName("values") val valores: Map<String, JsonElement> = emptyMap(),
) {
    /** `submit_mode: 'structured'`: se envía `{form_id, data}` en vez de un mensaje. */
    val estructurado: Boolean get() = modo == "structured"
}

/** Los tipos que conoce `BotForm.vue`. Uno desconocido se pinta como texto, igual que en la web. */
enum class TipoCampo(val nombre: String) {
    Texto("text"),
    AreaTexto("textarea"),
    Fecha("date"),
    Casilla("checkbox"),
    Opciones("radio"),
    Titulo("heading"),
    BusquedaEntidad("entity_search"),
    BusquedaCIE("icd_search"),
    MapaCorporal("body_map"),
    Imagenes("image_upload"),
    ;

    companion object {
        fun de(nombre: String?): TipoCampo = entries.firstOrNull { it.nombre == nombre } ?: Texto
    }
}

@Serializable
data class CampoFormulario(
    @SerialName("key") val clave: String? = null,
    @SerialName("label") val etiqueta: String = "",
    @SerialName("type") val tipoOriginal: String? = null,
    val placeholder: String? = null,
    @SerialName("required") val requerido: Boolean = false,
    val multiple: Boolean = false,
    @SerialName("options") val opciones: List<OpcionCampo> = emptyList(),
    // Solo entity_search:
    @SerialName("entity_id") val definicion: String? = null,
    @SerialName("min_chars") val minimoCaracteres: Int = 3,
    @SerialName("page_size") val tamanoPagina: Int = 20,
    @SerialName("on_select_send") val plantillaSeleccion: String? = null,
    @SerialName("result_label") val etiquetaResultado: List<String> = listOf("title"),
    @SerialName("result_sub") val subResultado: String? = null,
) {
    val tipo: TipoCampo get() = TipoCampo.de(tipoOriginal)
}

/** Una opción de `radio`: el bot manda `"mestiza"` o `{label: "Sí", value: true}`. */
@Serializable(with = OpcionCampo.Serializador::class)
data class OpcionCampo(val etiqueta: String, val valor: JsonElement) {
    object Serializador : KSerializer<OpcionCampo> {
        override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor

        override fun deserialize(decoder: Decoder): OpcionCampo {
            val elemento = (decoder as JsonDecoder).decodeJsonElement()
            if (elemento is JsonPrimitive && elemento.isString) return OpcionCampo(elemento.content, elemento)
            val objeto = elemento as? JsonObject ?: return OpcionCampo(elemento.texto().orEmpty(), elemento)
            val valor = objeto["value"] ?: JsonNull
            val etiqueta = (objeto["label"] as? JsonPrimitive)?.content ?: valor.texto().orEmpty()
            return OpcionCampo(etiqueta, valor)
        }

        override fun serialize(encoder: Encoder, value: OpcionCampo) {
            (encoder as JsonEncoder).encodeJsonElement(buildJsonObject {
                put("label", JsonPrimitive(value.etiqueta))
                put("value", value.valor)
            })
        }
    }
}

/** Una sección de la ficha y si ya tiene dato (el menú "Secciones"). */
@Serializable
data class Marcador(
    val id: String,
    @SerialName("label") val etiqueta: String = "",
    @SerialName("category") val categoria: String = "",
    @SerialName("done") val hecho: Boolean = false,
) {
    companion object {
        /** En el orden en que llegan: la ficha ya viene ordenada y la categoría cambia por tramos. */
        fun porCategoria(marcadores: List<Marcador>): List<Pair<String, List<Marcador>>> {
            val grupos = mutableListOf<Pair<String, MutableList<Marcador>>>()
            for (marcador in marcadores) {
                if (grupos.lastOrNull()?.first == marcador.categoria) {
                    grupos.last().second += marcador
                } else {
                    grupos += marcador.categoria to mutableListOf(marcador)
                }
            }
            return grupos
        }
    }
}

// Ficha completa (GET /api/bot/ficha, `fichaCompleta` en cepi-bot/src/flowV1.ts)

/**
 * La ficha entera de un caso, como la pinta `FichaCompleta.vue`: los grupos en orden, cada uno
 * con su formulario ya prellenado y si tiene dato. `completos` de `total` es el progreso.
 */
@Serializable
data class FullFicha(
    @SerialName("episode_id") val episodeId: String? = null,
    @SerialName("patient_id") val patientId: String? = null,
    @SerialName("grupos") val groups: List<FichaGroup> = emptyList(),
    /** Las etiquetas de los grupos sin dato. */
    @SerialName("faltantes") val missing: List<String> = emptyList(),
    @SerialName("completos") val done: Int = 0,
    @SerialName("total") val totalOriginal: Int? = null,
) {
    /** Si el servidor no manda `total`, son los grupos que llegaron (como la web). */
    val total: Int get() = totalOriginal ?: groups.size
}

/**
 * Un grupo de la ficha (`FichaGrupoCompleto`): `form` es el mismo formulario del chat
 * (`ficha_grp_<id>`) con `values` = lo guardado. `target` dice dónde vive el dato: `patient`
 * (filiación, antecedentes, consentimientos) o `episode` (todo lo de la consulta).
 */
@Serializable
data class FichaGroup(
    val id: String,
    val label: String = "",
    val category: String = "",
    val done: Boolean = false,
    val target: String = "episode",
    val form: FormularioBot? = null,
)

/** `POST /api/bot/ficha/grupo`: `completitud` = % de la ficha tras guardar, si se pudo calcular. */
@Serializable
data class FichaGroupSaveResult(
    val ok: Boolean = false,
    val target: String? = null,
    @SerialName("completitud") val completeness: Double? = null,
)

// Derivar

/** Un círculo, especialidad o turno de `GET /api/groups`. */
@Serializable
data class GrupoDerivacion(
    val id: String,
    val slug: String,
    @SerialName("name") val nombreOriginal: String? = null,
    /** `specialty` | `circle` | `roster` (turno) | `all` (toda la red) */
    @SerialName("kind") val tipo: String? = null,
    @SerialName("member_count") val miembros: Int = 0,
) {
    val nombre: String get() = nombreOriginal ?: slug
}

/**
 * A quién está derivado un episodio ahora (`GET /api/review-queue/entity/:id`): una revisión
 * pendiente por persona. Con varias derivaciones a la vez, son varias.
 */
@Serializable
data class Derivado(
    @SerialName("user_id") val usuario: String,
    @SerialName("name") val nombre: String? = null,
    val email: String? = null,
) {
    val comoSeLlama: String get() = nombre ?: email ?: "Profesional"
}

@Serializable
data class Derivaciones(val derivados: List<Derivado> = emptyList())

@Serializable
data class MiembroGrupo(
    @SerialName("user_id") val usuario: String,
    @SerialName("name") val nombre: String? = null,
    val email: String? = null,
    @SerialName("role_in_group") val rol: String? = null,
)

// CIE-10

@Serializable
data class ResultadoCIE(val code: String? = null, val title: String = "")

@Serializable
data class BusquedaCIE(val results: List<ResultadoCIE> = emptyList())

// Ficha de evolución (PAPER §28)

/**
 * Una fila de `GET /api/patient-evolution`: una evolución (cita) de una ficha del paciente con lo
 * que se lee para seguir el caso (PAPER §28.4). Una ficha sin evoluciones registradas da una fila
 * armada con los campos del episodio (`evolution_id = null`). El médico ya viene como nombre y
 * cada campo ya cayó al que tenga dato según la fuente de la ficha (CEPI o espejo DrPro): la app
 * solo lo pinta. Los campos de §28.4 son opcionales: el backend viejo no los manda.
 */
@Serializable
data class FilaEvolucion(
    @SerialName("episode_id") val episodio: String,
    /** La evolución registrada; `null` en la fila armada de una ficha sin evoluciones. */
    @SerialName("evolution_id") val evolutionId: String? = null,
    /** El motivo de consulta de la ficha. */
    val motivo: String? = null,
    /** `YYYY-MM-DD`, como texto: no se convierte a fecha para no correrla de día. */
    val fecha: String? = null,
    /** El estado de la ficha (episodio), no de la evolución. */
    val estado: String? = null,
    /** La foto de la primera cita, guardada al agregar la primera evolución. */
    @SerialName("es_inicial") val esInicial: Boolean? = null,
    val medico: String? = null,
    /** El especialista al que se derivó, si lo hubo. */
    val especialista: String? = null,
    val diagnostico: String? = null,
    @SerialName("diagnostico_histopatologico") val diagnosticoHistopatologico: String? = null,
    /** El mismo dato con el nombre corto de §28.4; se acepta cualquiera de los dos. */
    val histopatologico: String? = null,
    val tratamiento: String? = null,
    val observaciones: String? = null,
    val hallazgos: String? = null,
    @SerialName("proximo_control_fecha") val proximoControlFecha: String? = null,
    @SerialName("proximo_control_motivo") val proximoControlMotivo: String? = null,
) {
    /** El histopatológico, venga con el nombre que venga. */
    val histopathology: String? get() = diagnosticoHistopatologico ?: histopatologico

    /** Identifica la fila: una ficha puede tener varias. */
    val rowKey: String get() = evolutionId?.let { "evo:$it" } ?: "epi:$episodio"
}

/** `POST /api/bot/episodio/evolucion` → `201 {ok, evolution_id}` (PAPER §28.4). */
@Serializable
data class AddEvolutionResult(
    val ok: Boolean = false,
    @SerialName("evolution_id") val evolutionId: String? = null,
)

// Responder interconsulta (PAPER §30)

/** `POST /api/bot/interconsulta/responder`: `notified` = se avisó al médico que envió el caso. */
@Serializable
data class ConsultationAnswerResult(val ok: Boolean = false, val notified: Boolean = false)

/**
 * Prioridad clínica del episodio (PAPER §34). La guía es la tabla del documento abreviada, la
 * misma que `ResponderInterconsulta.vue`. La decisión es del médico responsable.
 */
enum class ClinicalPriority(val value: String, val guide: String) {
    Urgent(
        "Urgente",
        "Compromiso general, ampollas extensas, reacción grave a fármacos, eritrodermia, púrpura que progresa → supervisor y atención presencial ya",
    ),
    Preferred(
        "Preferente",
        "Sospecha de cáncer, crecimiento rápido, úlcera o sangrado persistente, inmunosuprimido → ruta prioritaria",
    ),
    Scheduled("Programada", "Estable, sin alarma, o control de algo ya evaluado → seguimiento según plazo"),
    ;

    companion object {
        /** `null` si el episodio no tiene prioridad o trae un valor que no se conoce. */
        fun of(value: String?): ClinicalPriority? = entries.firstOrNull { it.value == value }
    }
}
