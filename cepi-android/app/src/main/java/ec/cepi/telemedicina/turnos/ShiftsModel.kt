package ec.cepi.telemedicina.turnos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.GrupoDerivacion
import ec.cepi.telemedicina.api.Shift
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.time.LocalDate

/**
 * Estado de la sección Turnos (PAPER §32): el grupo elegido, sus miembros y los turnos de las
 * próximas ocho semanas. Espejo de `Turnos.vue`. Vive en `Principal` para que cambiar de
 * sección no lo pierda; cada vez que la sección vuelve a verse, `start` recarga.
 */
class ShiftsModel(private val api: CepiApi) {
    var groups: List<GrupoDerivacion> by mutableStateOf(emptyList())
        private set
    var group: String? by mutableStateOf(null)
        private set
    var loadingGroups: Boolean by mutableStateOf(false)
        private set
    var members: List<ShiftMember> by mutableStateOf(emptyList())
        private set
    var shifts: List<Shift> by mutableStateOf(emptyList())
        private set
    /** «Hoy» según el servidor; `null` hasta la primera respuesta. */
    var today: LocalDate? by mutableStateOf(null)
        private set
    var loading: Boolean by mutableStateOf(false)
        private set
    /** Guardando un cambio: los controles de edición quedan grises. */
    var busy: Boolean by mutableStateOf(false)
        private set
    var error: String? by mutableStateOf(null)
        private set
    var notice: String? by mutableStateOf(null)
        private set
    var noticeIsError: Boolean by mutableStateOf(false)
        private set

    private var request = 0

    val weeks: List<ShiftWeek> get() = today?.let { ShiftCalendar.weeks(it, shifts) } ?: emptyList()

    val onCallText: String get() = ShiftCalendar.onCallText(today ?: LocalDate.now(), shifts)

    /** Al mostrarse la sección (o al cambiar de org): grupos y luego turnos del grupo elegido. */
    suspend fun start(localToday: LocalDate = LocalDate.now()) {
        loadingGroups = true
        try {
            // El virtual «Todos» no tiene turnos: no se ofrece.
            val all = api.grupos().filter { it.tipo != "all" }
            groups = all
            val kept = group?.takeIf { slug -> all.any { it.slug == slug } }
            group = kept ?: (all.firstOrNull { it.slug == ShiftCalendar.DEFAULT_GROUP } ?: all.firstOrNull())?.slug
        } catch (e: ApiError) {
            error = "No se pudieron cargar los grupos: ${e.mensaje}"
            return
        } finally {
            loadingGroups = false
        }
        load(localToday)
    }

    /** «Reintentar»: si fallaron los grupos, empieza de cero; si no, solo los turnos. */
    suspend fun retry() = if (groups.isEmpty()) start() else load()

    suspend fun selectGroup(slug: String) {
        if (slug == group) return
        group = slug
        notice = null
        load()
    }

    suspend fun load(localToday: LocalDate = LocalDate.now()) {
        val slug = group ?: return
        val mine = ++request
        loading = true
        error = null
        try {
            coroutineScope {
                val raw = async { api.miembros(slug) }
                var from = ShiftCalendar.mondayOf(today ?: localToday)
                var list = api.shifts(slug, from, ShiftCalendar.rangeEnd(from))
                // «Hoy» lo manda el servidor (zona horaria de los turnos). Si cae en otra semana
                // que la del teléfono, se vuelve a pedir el rango correcto.
                val serverToday = Fechas.dia(list.today) ?: today ?: localToday
                if (ShiftCalendar.mondayOf(serverToday) != from) {
                    from = ShiftCalendar.mondayOf(serverToday)
                    list = api.shifts(slug, from, ShiftCalendar.rangeEnd(from))
                }
                val loadedMembers = ShiftCalendar.members(raw.await())
                if (mine != request) return@coroutineScope
                today = serverToday
                shifts = list.data
                members = loadedMembers
            }
        } catch (e: ApiError) {
            if (mine == request) error = "No se pudieron cargar los turnos: ${e.mensaje}"
        } finally {
            if (mine == request) loading = false
        }
    }

    /** Asigna a `memberId` de lunes a domingo de esa semana. `true` si se guardó. */
    suspend fun assign(week: ShiftWeek, memberId: String): Boolean {
        val slug = group ?: return false
        val name = members.firstOrNull { it.id == memberId }?.name.orEmpty()
        return change("$name quedó de turno la semana del ${ShiftCalendar.weekLabel(week)}") {
            api.createShift(slug, memberId, week.start, week.end)
        }
    }

    suspend fun remove(shift: Shift): Boolean {
        val slug = group ?: return false
        return change("Se quitó a ${shift.displayName} del turno") { api.deleteShift(slug, shift.id) }
    }

    private suspend fun change(okMessage: String, action: suspend () -> Unit): Boolean {
        if (busy) return false
        busy = true
        notice = null
        noticeIsError = false
        try {
            action()
            notice = okMessage
            load()
            return true
        } catch (e: ApiError) {
            noticeIsError = true
            notice = "No se pudo guardar: ${e.mensaje}"
            return false
        } finally {
            busy = false
        }
    }
}
