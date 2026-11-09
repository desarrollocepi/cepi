package ec.cepi.telemedicina.turnos

import ec.cepi.telemedicina.api.MiembroGrupo
import ec.cepi.telemedicina.api.Shift
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

/** Una semana del calendario, de lunes a domingo, con los turnos que la tocan. */
data class ShiftWeek(
    val start: LocalDate,
    val end: LocalDate,
    val current: Boolean,
    val shifts: List<Shift>,
)

/** Un miembro del grupo que se puede elegir para un turno. */
data class ShiftMember(val id: String, val name: String)

/**
 * Las cuentas del calendario de turnos (PAPER §32), sin Compose ni red: lo mismo que hace
 * `Turnos.vue` con cadenas `YYYY-MM-DD`. La semana va de lunes a domingo.
 */
object ShiftCalendar {
    const val WEEKS = 8
    const val DEFAULT_GROUP = "dermatologia"
    const val EDIT_PERMISSION = "groups:manage_shifts"

    private val MONTHS = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

    fun mondayOf(day: LocalDate): LocalDate = day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    /** Último día que se pide: el domingo de la octava semana. */
    fun rangeEnd(firstMonday: LocalDate): LocalDate = firstMonday.plusDays(7L * WEEKS - 1)

    /** Un turno toca la semana si se cruza con ella en al menos un día. */
    fun touches(shift: Shift, start: LocalDate, end: LocalDate): Boolean =
        !shift.startDate.isAfter(end) && !shift.endDate.isBefore(start)

    /** El turno no cubre la semana entera: se muestra con su rango entre paréntesis. */
    fun isPartial(shift: Shift, week: ShiftWeek): Boolean =
        shift.startDate.isAfter(week.start) || shift.endDate.isBefore(week.end)

    fun weeks(today: LocalDate, shifts: List<Shift>): List<ShiftWeek> {
        val first = mondayOf(today)
        return (0 until WEEKS).map { i ->
            val start = first.plusWeeks(i.toLong())
            val end = start.plusDays(6)
            ShiftWeek(start, end, current = i == 0, shifts = shifts.filter { touches(it, start, end) })
        }
    }

    /** Los nombres de quienes están de turno ese día, sin repetir. */
    fun onCall(today: LocalDate, shifts: List<Shift>): List<String> =
        shifts.filter { touches(it, today, today) }.map { it.displayName }.distinct()

    fun onCallText(today: LocalDate, shifts: List<Shift>): String =
        onCall(today, shifts).joinToString(", ").ifEmpty { "nadie asignado (avisa a todo el grupo)" }

    /** "9 nov", como `diaCorto` de la web. */
    fun shortDay(day: LocalDate): String = "${day.dayOfMonth} ${MONTHS[day.monthValue - 1]}"

    fun weekLabel(week: ShiftWeek): String = "${shortDay(week.start)} – ${shortDay(week.end)}"

    fun partialLabel(shift: Shift): String = "(${shortDay(shift.startDate)}–${shortDay(shift.endDate)})"

    fun members(raw: List<MiembroGrupo>): List<ShiftMember> =
        raw.distinctBy { it.usuario }.map { ShiftMember(it.usuario, it.nombre?.takeIf(String::isNotBlank) ?: it.email ?: it.usuario) }

    /** Los miembros que todavía no están en esa semana. */
    fun freeMembers(week: ShiftWeek, members: List<ShiftMember>): List<ShiftMember> {
        val taken = week.shifts.map { it.userId }.toSet()
        return members.filter { it.id !in taken }
    }

    /** Por qué «Quitar» está gris; `null` = habilitado. */
    fun removeDisabledReason(busy: Boolean): String? =
        if (busy) "Espera a que termine el cambio anterior" else null

    /** Por qué el selector de miembro está gris; `null` = habilitado. */
    fun pickerDisabledReason(busy: Boolean, freeCount: Int): String? = when {
        busy -> "Espera a que termine el cambio anterior"
        freeCount == 0 -> "Todos los miembros del grupo ya están en esta semana"
        else -> null
    }

    /** Por qué «Asignar» está gris; `null` = habilitado. */
    fun assignDisabledReason(busy: Boolean, freeCount: Int, selected: String?): String? =
        pickerDisabledReason(busy, freeCount) ?: if (selected == null) "Elige a quién asignar" else null
}
