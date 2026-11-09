package ec.cepi.telemedicina.controles

import ec.cepi.telemedicina.api.FollowUp
import java.time.DayOfWeek
import java.time.LocalDate

/** Un grupo de la lista: «Atrasados» o una semana de lunes a domingo. */
data class FollowUpGroup(
    /** `atrasados` o el lunes de la semana (`YYYY-MM-DD`). */
    val key: String,
    val title: String,
    val rows: List<FollowUp>,
) {
    val overdue: Boolean get() = key == OVERDUE_KEY

    companion object {
        const val OVERDUE_KEY = "atrasados"
    }
}

/**
 * Las cuentas de la sección Controles (PAPER §33), sin Compose para probarlas en la JVM.
 * Espejo de `Controles.vue`: atrasados arriba y, después, una sección por semana.
 */
object FollowUpSchedule {
    private val DAYS = listOf("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
    private val MONTHS = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

    private fun date(iso: String): LocalDate? = runCatching { LocalDate.parse(iso.take(10)) }.getOrNull()

    /** «miércoles». */
    fun weekday(iso: String): String = date(iso)?.let { DAYS[it.dayOfWeek.value - 1] } ?: ""

    /** «11 nov 2026». */
    fun longDate(iso: String): String = date(iso)?.let { longDate(it) } ?: iso

    fun longDate(d: LocalDate): String = "${d.dayOfMonth} ${MONTHS[d.monthValue - 1]} ${d.year}"

    fun mondayOf(d: LocalDate): LocalDate = d.with(DayOfWeek.MONDAY)

    /** Busca por nombre del paciente o cédula, sin distinguir mayúsculas. */
    fun filter(rows: List<FollowUp>, query: String): List<FollowUp> {
        val t = query.trim().lowercase()
        if (t.isEmpty()) return rows
        return rows.filter { "${it.paciente.orEmpty()} ${it.cedula.orEmpty()}".lowercase().contains(t) }
    }

    /** Atrasados arriba; después, una sección por semana (lunes a domingo) según `today` del servidor. */
    fun groups(rows: List<FollowUp>, today: LocalDate?): List<FollowUpGroup> {
        val out = mutableListOf<FollowUpGroup>()
        val overdue = rows.filter { it.overdue }
        if (overdue.isNotEmpty()) out += FollowUpGroup(FollowUpGroup.OVERDUE_KEY, "Atrasados", overdue)
        val current = today?.let { mondayOf(it) }
        val byWeek = linkedMapOf<LocalDate?, MutableList<FollowUp>>()
        for (row in rows) {
            if (row.overdue) continue
            byWeek.getOrPut(date(row.fechaControl)?.let { mondayOf(it) }) { mutableListOf() } += row
        }
        // Una fecha ilegible (no debería pasar) cae al final, sin perder la fila.
        for ((monday, list) in byWeek.entries.sortedWith(compareBy(nullsLast()) { it.key })) {
            val title = when {
                monday == null -> "Sin fecha"
                monday == current -> "Esta semana"
                current != null && monday == current.plusWeeks(1) -> "Próxima semana"
                else -> "Semana del ${longDate(monday)}"
            }
            out += FollowUpGroup(monday?.toString() ?: "sin-fecha", title, list)
        }
        return out
    }

    /** La línea gris: diagnóstico · «indicó <médico>» · «consulta del <fecha>». */
    fun metaLine(row: FollowUp): String = listOfNotNull(
        row.diagnostico?.takeIf { it.isNotBlank() },
        row.medico?.takeIf { it.isNotBlank() }?.let { "indicó $it" },
        row.fechaConsulta?.takeIf { it.isNotBlank() }?.let { "consulta del ${longDate(it)}" },
    ).joinToString(" · ")

    fun emptyText(query: String): String =
        query.trim().let { if (it.isEmpty()) "No hay controles agendados en los próximos 90 días" else "Ningún control para «$it»" }
}
