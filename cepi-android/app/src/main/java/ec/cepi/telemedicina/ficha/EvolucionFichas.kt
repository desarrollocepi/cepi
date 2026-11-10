package ec.cepi.telemedicina.ficha

import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.FilaEvolucion
import ec.cepi.telemedicina.pacientes.EstadoFicha
import java.time.LocalDate

/**
 * Una ficha (episodio) con sus evoluciones (PAPER §28.4): una ficha es un motivo de consulta y
 * cada cita de control es una evolución dentro de ella. Sin UI, para poder probarlo.
 */
data class EpisodeEvolutions(
    val episodeId: String,
    /** Las evoluciones de la ficha, de la más nueva a la más vieja, como las manda el backend. */
    val rows: List<FilaEvolucion>,
) {
    val motivo: String? get() = rows.firstNotNullOfOrNull { it.motivo?.takeIf(String::isNotBlank) }
    val estado: String? get() = rows.firstNotNullOfOrNull { it.estado?.takeIf(String::isNotBlank) }

    /** El día en que se abrió: el de la evolución inicial o, si no está marcada, el más viejo. */
    val openedOn: String?
        get() = rows.firstOrNull { it.esInicial == true }?.fecha
            ?: rows.mapNotNull { it.fecha }.minOrNull()

    /** Cuántas evoluciones tiene: la fila armada de una ficha sin evoluciones cuenta como una. */
    val count: Int get() = rows.size

    val discharged: Boolean get() = estado == ALTA

    /** La línea de «Otras fichas del paciente»: motivo, fecha, estado, cuántas evoluciones. */
    val summary: String
        get() = listOf(
            motivo ?: "Sin motivo registrado",
            openedOn ?: "sin fecha",
            estadoLabel(estado),
            if (count == 1) "1 evolución" else "$count evoluciones",
        ).joinToString(" · ")

    companion object {
        const val ALTA = "alta"

        fun estadoLabel(estado: String?): String = when {
            estado.isNullOrBlank() -> "Sin estado"
            else -> EstadoFicha.de(estado).let {
                if (it == EstadoFicha.Otro) estado else it.etiqueta
            }
        }
    }
}

/** Cómo se reparte la evolución del paciente entre la ficha abierta y las otras. */
object EvolutionGrouping {
    /** Agrupa las filas por ficha respetando el orden del backend (fichas de la más nueva a la más vieja). */
    fun group(rows: List<FilaEvolucion>): List<EpisodeEvolutions> {
        val order = LinkedHashMap<String, MutableList<FilaEvolucion>>()
        rows.forEach { order.getOrPut(it.episodio) { mutableListOf() }.add(it) }
        return order.map { (id, list) -> EpisodeEvolutions(id, list) }
    }

    /**
     * La ficha que se muestra: la de la barra de episodios (`current`) o, si no está entre las
     * del paciente, la más nueva.
     */
    fun openEpisode(groups: List<EpisodeEvolutions>, current: String?): EpisodeEvolutions? =
        groups.firstOrNull { it.episodeId == current } ?: groups.firstOrNull()

    /** Las demás fichas, en el mismo orden. */
    fun others(groups: List<EpisodeEvolutions>, open: EpisodeEvolutions?): List<EpisodeEvolutions> =
        groups.filter { it.episodeId != open?.episodeId }

    /** Por qué «＋ Agregar evolución» está deshabilitado; `null` si se puede. */
    fun addDisabledReason(open: EpisodeEvolutions?, loaded: Boolean, busy: Boolean): String? = when {
        !loaded -> "Cargando la evolución…"
        open == null -> "Este paciente todavía no tiene fichas: abre una consulta primero"
        open.discharged -> "Esta ficha está de alta: abre una consulta nueva"
        busy -> "Termina primero lo que estás editando"
        else -> null
    }
}

/**
 * El formulario de «＋ Agregar evolución» (PAPER §28.4). La fecha arranca en hoy del dispositivo;
 * el backend usa hoy en Ecuador si no se manda.
 */
data class EvolutionDraft(
    val episodeId: String,
    val fecha: String,
    val hallazgos: String = "",
    val diagnostico: String = "",
    val tratamiento: String = "",
    val observaciones: String = "",
    val proximoControlFecha: String = "",
    val proximoControlMotivo: String = "",
    val saving: Boolean = false,
    val error: String? = null,
) {
    private val hasContent: Boolean
        get() = listOf(hallazgos, diagnostico, tratamiento, observaciones).any { it.isNotBlank() }

    /** Por qué «Guardar» está deshabilitado; `null` si se puede. Mismas reglas que el backend. */
    val saveDisabledReason: String?
        get() = when {
            saving -> "Guardando…"
            Fechas.dia(fecha) == null -> "Elige la fecha de la cita"
            !hasContent -> "Escribe hallazgos, diagnóstico, tratamiento u observaciones"
            proximoControlFecha.isNotBlank() && Fechas.dia(proximoControlFecha) == null -> "La fecha del próximo control no es válida"
            else -> null
        }

    companion object {
        fun start(episodeId: String, today: LocalDate = LocalDate.now()) = EvolutionDraft(episodeId, today.toString())
    }
}
