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
    /**
     * Las evoluciones en orden de cita, como se leen en una historia clínica (PAPER §28.4.1): la
     * más vieja arriba y la más nueva abajo, encima de «Próximo control». El backend ordena por
     * fecha descendente (la inicial, la última en un empate): basta con darlo vuelta.
     */
    val chronological: List<FilaEvolucion> get() = rows.asReversed()

    /** La vigente: la más nueva, la que define el próximo control. */
    val latest: FilaEvolucion? get() = rows.firstOrNull()

    val motivo: String? get() = rows.firstNotNullOfOrNull { it.motivo?.takeIf(String::isNotBlank) }
    val estado: String? get() = rows.firstNotNullOfOrNull { it.estado?.takeIf(String::isNotBlank) }

    /** El día en que se abrió: el de la evolución inicial o, si no está marcada, el más viejo. */
    val openedOn: String?
        get() = rows.firstOrNull { it.esInicial == true }?.fecha
            ?: rows.mapNotNull { it.fecha }.minOrNull()

    /** Cuántas evoluciones tiene: la fila armada de una ficha sin evoluciones cuenta como una. */
    val count: Int get() = rows.size

    val discharged: Boolean get() = estado == ALTA

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

    /** Por qué «＋ Agregar evolución» está deshabilitado; `null` si se puede. */
    fun addDisabledReason(open: EpisodeEvolutions?, loaded: Boolean, busy: Boolean): String? = when {
        !loaded -> "Cargando la evolución…"
        open == null -> "Este paciente todavía no tiene fichas: abre una consulta primero"
        open.discharged -> "Esta ficha está de alta: abre una consulta nueva"
        busy -> "Termina primero lo que estás editando"
        else -> null
    }

    /** Por qué tocar una tarjeta no abre su formulario; `null` si se puede (PAPER §28.4.1). */
    fun editDisabledReason(draftOpen: Boolean, observationOpen: Boolean): String? = when {
        draftOpen -> "Termina primero el formulario abierto"
        observationOpen -> "Termina primero la observación que estás editando"
        else -> null
    }
}

/**
 * El formulario de una evolución (PAPER §28.4, §28.4.1): «＋ Agregar evolución» o, con
 * `original`, la edición de una que ya está en la lista. La fecha de una nueva arranca en hoy
 * del dispositivo; el backend usa hoy en Ecuador si no se manda.
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
    /** Edición de una evolución registrada; `null` al agregar o en la fila armada. */
    val evolutionId: String? = null,
    /** Lo que tenía la fila al abrir el formulario, por clave del backend; `null` = agregar. */
    val original: Map<String, String>? = null,
    /** `FilaEvolucion.rowKey` de la fila que se edita: el formulario va en su lugar. */
    val rowKey: String? = null,
    /** La ficha está de alta: no se puede fijar un próximo control (el backend responde 400). */
    val discharged: Boolean = false,
    /** Se abrió desde «Próximo control»: el foco va ahí. */
    val focusNextControl: Boolean = false,
    val saving: Boolean = false,
    val error: String? = null,
) {
    val isEdit: Boolean get() = original != null

    private val hasContent: Boolean
        get() = listOf(hallazgos, diagnostico, tratamiento, observaciones).any { it.isNotBlank() }

    /** Los campos con la clave del backend, recortados. */
    val fields: Map<String, String>
        get() = linkedMapOf(
            "fecha" to fecha,
            "hallazgos" to hallazgos,
            "diagnostico" to diagnostico,
            "tratamiento" to tratamiento,
            "observaciones" to observaciones,
            "proximo_control_fecha" to proximoControlFecha,
            "proximo_control_motivo" to proximoControlMotivo,
        ).mapValues { it.value.trim() }

    /** Lo que cambió respecto de la fila: es lo único que se manda al editar. Vacío borra. */
    val changes: Map<String, String>
        get() {
            val before = original ?: return fields
            return fields.filter { (key, value) -> value != before[key].orEmpty() }
        }

    /** Por qué «Guardar» está deshabilitado; `null` si se puede. Mismas reglas que el backend. */
    val saveDisabledReason: String?
        get() = when {
            saving -> "Guardando…"
            Fechas.dia(fecha) == null -> "Elige la fecha de la cita"
            !isEdit && !hasContent -> "Escribe hallazgos, diagnóstico, tratamiento u observaciones"
            proximoControlFecha.isNotBlank() && Fechas.dia(proximoControlFecha) == null -> "La fecha del próximo control no es válida"
            discharged && "proximo_control_fecha" in changes && proximoControlFecha.isNotBlank() ->
                "Ficha de alta: no se puede fijar un próximo control"
            isEdit && changes.isEmpty() -> "No hay cambios que guardar"
            else -> null
        }

    companion object {
        fun start(episodeId: String, today: LocalDate = LocalDate.now()) = EvolutionDraft(episodeId, today.toString())

        /**
         * El formulario de una fila de la lista, prellenado. Una evolución registrada se edita por
         * `evolution_id`; la fila armada de una ficha sin evoluciones, por `episode_id`.
         */
        fun edit(
            row: FilaEvolucion,
            discharged: Boolean,
            focusNextControl: Boolean = false,
            today: LocalDate = LocalDate.now(),
        ): EvolutionDraft {
            val base = EvolutionDraft(
                episodeId = row.episodio,
                fecha = row.fecha.orEmpty(),
                hallazgos = row.hallazgos.orEmpty(),
                diagnostico = row.diagnostico.orEmpty(),
                tratamiento = row.tratamiento.orEmpty(),
                observaciones = row.observaciones.orEmpty(),
                proximoControlFecha = row.proximoControlFecha.orEmpty(),
                proximoControlMotivo = row.proximoControlMotivo.orEmpty(),
            )
            return base.copy(
                // Sin fecha guardada se propone hoy; cuenta como cambio y se manda.
                fecha = base.fecha.ifBlank { today.toString() },
                evolutionId = row.evolutionId,
                original = base.fields,
                rowKey = row.rowKey,
                discharged = discharged,
                focusNextControl = focusNextControl,
            )
        }
    }
}

/** Estado del próximo control respecto de hoy en el dispositivo. */
enum class NextControlStatus(val label: String) { Overdue("Atrasado"), Today("Hoy"), Upcoming("Próximo") }

/**
 * El bloque «Próximo control» al pie de la evolución (PAPER §28.4): lo vigente es la evolución
 * más nueva de la ficha abierta.
 */
data class NextControl(
    val date: LocalDate?,
    val motivo: String?,
    val status: NextControlStatus?,
    /** El texto cuando no hay fecha; `null` si la hay. */
    val emptyText: String?,
) {
    companion object {
        fun of(open: EpisodeEvolutions, today: LocalDate = LocalDate.now()): NextControl {
            val latest = open.latest
            val motivo = latest?.proximoControlMotivo?.takeIf(String::isNotBlank)
            val date = Fechas.dia(latest?.proximoControlFecha)
            if (date == null) {
                val text = if (open.discharged) "Ficha de alta: sin controles pendientes" else "Sin próximo control indicado"
                return NextControl(null, motivo, null, text)
            }
            val status = when {
                date < today -> NextControlStatus.Overdue
                date == today -> NextControlStatus.Today
                else -> NextControlStatus.Upcoming
            }
            return NextControl(date, motivo, status, null)
        }

        /**
         * Por qué tocar el bloque no abre el formulario; `null` si se puede (PAPER §28.4.1). Con
         * la ficha de alta el bloque sigue a la vista y lo dice.
         */
        fun editDisabledReason(open: EpisodeEvolutions?, busy: Boolean): String? = when {
            open == null || open.latest == null -> "Este paciente todavía no tiene fichas: abre una consulta primero"
            open.discharged -> "Ficha de alta: abre una consulta nueva para otro control"
            busy -> "Termina primero lo que estás editando"
            else -> null
        }
    }
}
