package ec.cepi.telemedicina.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Un aviso de la bandeja (`GET /api/reminders`): una derivación recibida, un próximo control.
 * El mismo que viaja por push, con `entity_id` apuntando al episodio o al paciente.
 */
@Serializable
data class Recordatorio(
    val id: String,
    @SerialName("entity_id") val entidad: String? = null,
    @SerialName("title") val titulo: String = "",
    @SerialName("message") val mensaje: String? = null,
    @SerialName("due_at") val vence: String? = null,
    @SerialName("status") val estado: String = "pending",
    @SerialName("created_at") val creado: String? = null,
    @SerialName("created_by_name") val quienDerivo: String? = null,
) {
    /** Lo que todavía pide atención: ni visto ni cancelado. */
    val activo: Boolean get() = estado != "done" && estado != "cancelled"

    val etiquetaEstado: String get() = when (estado) {
        "pending" -> "pendiente"
        "sent" -> "enviada"
        "snoozed" -> "pospuesta"
        "done" -> "vista"
        "cancelled" -> "cancelada"
        else -> estado
    }
}

/** `GET /api/review-queue/patient/:entityId`: de qué paciente es un aviso. */
@Serializable
data class PacienteDeAviso(
    @SerialName("patient_id") val paciente: String? = null,
    @SerialName("patient_name") val nombre: String? = null,
)
