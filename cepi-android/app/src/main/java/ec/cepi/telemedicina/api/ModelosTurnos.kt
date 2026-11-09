package ec.cepi.telemedicina.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.LocalDate

// Turnos de un grupo (PAPER §32): quién cubre el grupo en unas fechas, ambas incluidas.

/** Un turno de `GET /api/groups/:slug/shifts` o de la respuesta de `POST`. */
@Serializable
data class Shift(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("user_name") val userName: String? = null,
    @SerialName("starts_on") val startsOn: String,
    @SerialName("ends_on") val endsOn: String,
    @SerialName("created_by") val createdBy: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
) {
    val startDate: LocalDate get() = LocalDate.parse(startsOn.take(10))
    val endDate: LocalDate get() = LocalDate.parse(endsOn.take(10))
    val displayName: String get() = userName?.takeIf { it.isNotBlank() } ?: userId
}

/** `today` es el «hoy» del servidor (zona `SHIFTS_TIMEZONE`), no el del teléfono. */
@Serializable
data class ShiftList(
    val data: List<Shift> = emptyList(),
    val from: String? = null,
    val to: String? = null,
    val today: String? = null,
)
