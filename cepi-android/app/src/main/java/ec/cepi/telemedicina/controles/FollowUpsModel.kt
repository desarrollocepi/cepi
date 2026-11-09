package ec.cepi.telemedicina.controles

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.FollowUp
import java.time.LocalDate

/**
 * Estado de la sección Controles (PAPER §33). Vive en `Principal` para que cambiar de sección
 * no lo pierda; cada vez que la sección vuelve a verse, `load` recarga.
 */
class FollowUpsModel(private val api: CepiApi) {
    var rows: List<FollowUp> by mutableStateOf(emptyList())
        private set
    /** «Hoy» según el servidor; `null` hasta la primera respuesta. */
    var today: LocalDate? by mutableStateOf(null)
        private set
    var loading: Boolean by mutableStateOf(false)
        private set
    var error: String? by mutableStateOf(null)
        private set

    private var request = 0

    fun groups(query: String): List<FollowUpGroup> = FollowUpSchedule.groups(FollowUpSchedule.filter(rows, query), today)

    suspend fun load() {
        val mine = ++request
        loading = true
        error = null
        try {
            val r = api.followUps()
            if (mine != request) return
            rows = r.data
            today = Fechas.dia(r.today)
        } catch (e: ApiError) {
            if (mine == request) error = "No se pudieron cargar los controles: ${e.mensaje}"
        } finally {
            if (mine == request) loading = false
        }
    }
}
