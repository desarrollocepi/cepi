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
