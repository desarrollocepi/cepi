package ec.cepi.telemedicina.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlin.math.abs
import kotlin.math.floor

/**
 * Un registro del ERP (`/api/entities`). Solo `id` es fijo; lo clínico va en `data`, que sale
 * de `entity_definitions` y cambia con un seed, sin pasar por la app.
 */
@Serializable
data class Registro(
    val id: String,
    val title: String? = null,
    /** `entity_id`: de qué `entity_definition` es (paciente, episodio…). */
    @SerialName("entity_id") val definicion: String? = null,
    val data: Map<String, JsonElement> = emptyMap(),
) {
    /** Un campo de `data` como texto; `null` si falta o está vacío. */
    operator fun get(campo: String): String? = data[campo]?.texto()?.trim()?.takeIf { it.isNotEmpty() }
}

/**
 * El valor como texto para mostrar. Un entero sale sin decimales: una cédula guardada como
 * número no debe verse "1712345678.0".
 */
fun JsonElement.texto(): String? {
    if (this is JsonNull || this !is JsonPrimitive) return null
    if (isString) return content
    booleanOrNull?.let { return if (it) "sí" else "no" }
    val numero = content.toDoubleOrNull() ?: return content
    return if (numero == floor(numero) && abs(numero) < 1e15) numero.toLong().toString() else content
}

@Serializable
data class Organizacion(val id: String, val name: String)

// `/login` puede no traer `orgs` ni `org_id` (AuthResponse los declara opcionales).
@Serializable
data class Usuario(
    val id: String,
    val name: String? = null,
    val email: String,
    val role: String? = null,
    val permissions: List<String> = emptyList(),
    @SerialName("org_id") val orgActiva: String? = null,
    val orgs: List<Organizacion> = emptyList(),
) {
    /** El backend es quien manda; esto solo decide si se ofrece una acción. */
    fun puede(permiso: String): Boolean = "*:*:*:*" in permissions || permiso in permissions
}

/** `POST /api/auth/login` y `GET /api/auth/me`: el token (re)emitido y el usuario. */
@Serializable
data class SesionRespuesta(val token: String, val user: Usuario)

/** Respuestas que solo reemiten el token (`POST /api/orgs/switch`). */
@Serializable
data class TokenRespuesta(val token: String? = null)

/** Respuestas que solo confirman (`DELETE /api/auth/me` → `{ok: true}`). */
@Serializable
data class Confirmacion(val ok: Boolean = false)

/** `{ ok, data: [...] }` */
@Serializable
data class Lista<T>(val data: List<T> = emptyList())

/** `{ ok, data: {...} }` */
@Serializable
data class Uno<T>(val data: T)

/** `GET /api/review-queue`: pacientes con derivaciones pendientes para quien consulta. */
@Serializable
data class ColaRevision(
    @SerialName("by_patient") val porPaciente: Map<String, PendienteRevision> = emptyMap(),
)

@Serializable
data class PendienteRevision(
    @SerialName("pending") val pendientes: Int = 0,
    /** ISO 8601; el que vence antes va primero en la lista. */
    @SerialName("earliest_due") val vence: String? = null,
)

/** `GET /api/patient-assignments`: quién tiene a cargo a cada paciente. */
@Serializable
data class Asignaciones(
    @SerialName("assignments") val porPaciente: Map<String, Asignacion> = emptyMap(),
)

@Serializable
data class Asignacion(
    @SerialName("assignee_name") val nombre: String? = null,
    /** `responsable` | `derivado` | `derivado_grupo` | `creador` */
    @SerialName("source") val origen: String? = null,
    /** Estado de la consulta más reciente (`en_curso`, `derivada`, `cerrado`…). */
    val estado: String? = null,
    /** A quién está derivado el caso ahora; puede ser más de uno. */
    val derivados: List<DerivadoBreve> = emptyList(),
) {
    /** Cómo se resume "a cargo" en la fila: con varios derivados, sus nombres. */
    val aCargo: String?
        get() = when {
            derivados.size <= 1 -> nombre
            derivados.size > 2 -> derivados.take(2).joinToString(", ") { it.nombre } + " +" + (derivados.size - 2)
            else -> derivados.joinToString(", ") { it.nombre }
        }
}

@Serializable
data class DerivadoBreve(
    val id: String = "",
    @SerialName("name") val nombre: String = "",
)
