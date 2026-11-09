package ec.cepi.telemedicina.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Próximos controles de los pacientes (PAPER §33): cuándo vuelve cada uno y qué hay que hacer.

/**
 * Un control de `GET /api/bot/controles`: sale del control de la consulta más reciente del
 * paciente. Las fechas son `YYYY-MM-DD`, como texto. `estadoControl`: `atrasado`, `hoy` o
 * `proximo`. `patientId` es `null` si el paciente ya no está disponible.
 */
@Serializable
data class FollowUp(
    @SerialName("episode_id") val episodeId: String,
    @SerialName("patient_id") val patientId: String? = null,
    val paciente: String? = null,
    val cedula: String? = null,
    @SerialName("fecha_control") val fechaControl: String,
    val motivo: String? = null,
    val plan: String? = null,
    val diagnostico: String? = null,
    @SerialName("fecha_consulta") val fechaConsulta: String? = null,
    val medico: String? = null,
    @SerialName("estado_control") val estadoControl: String = "proximo",
) {
    val overdue: Boolean get() = estadoControl == "atrasado"
    val isToday: Boolean get() = estadoControl == "hoy"
}

/** `today` es el «hoy» del servidor; `from`–`to`, la ventana que cubre la lista. */
@Serializable
data class FollowUpList(
    val data: List<FollowUp> = emptyList(),
    val today: String? = null,
    val from: String? = null,
    val to: String? = null,
)
