package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.FilaEvolucion
import ec.cepi.telemedicina.api.Lista
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.ficha.EpisodeEvolutions
import ec.cepi.telemedicina.ficha.EvolutionDraft
import ec.cepi.telemedicina.ficha.EvolutionGrouping
import ec.cepi.telemedicina.ficha.NextControl
import ec.cepi.telemedicina.ficha.NextControlStatus
import ec.cepi.telemedicina.ficha.ObservationEdit
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.LocalDate

/**
 * «Una ficha, varias evoluciones» (PAPER §28.4): el contrato nuevo de
 * `GET /api/patient-evolution`, los dos endpoints de escritura de cepi-bot y la lógica de la
 * sección Evolución (agrupar por ficha, la ficha abierta, el bloqueo por alta).
 */
class EvolucionesTest {
    /**
     * La respuesta de §28.4: e2 con dos evoluciones registradas (la inicial y un control), e1 de
     * alta sin evoluciones (fila armada), e0 de un backend viejo sin los campos nuevos.
     */
    private val json = """
        {"ok":true,"data":[
         {"episode_id":"e2","evolution_id":"v2","motivo":"Psoriasis en codos","estado":"cerrado","es_inicial":false,
          "fecha":"2026-11-05","medico":"Dra. Ana Pérez","especialista":null,"diagnostico":"L40.0 — Psoriasis vulgar",
          "histopatologico":"Psoriasis psoriasiforme","tratamiento":"Calcipotriol","observaciones":"Mejoría",
          "hallazgos":"Placas más delgadas","proximo_control_fecha":"2027-02-05","proximo_control_motivo":"Control de placas"},
         {"episode_id":"e2","evolution_id":"v1","motivo":"Psoriasis en codos","estado":"cerrado","es_inicial":true,
          "fecha":"2026-10-01","medico":"Dra. Ana Pérez","especialista":"Dr. Luis Mora","diagnostico":"L40.0 — Psoriasis vulgar",
          "histopatologico":null,"tratamiento":"Clobetasol 0,05 %","observaciones":"Control en 1 mes",
          "hallazgos":null,"proximo_control_fecha":"2026-11-05","proximo_control_motivo":null},
         {"episode_id":"e1","evolution_id":null,"motivo":"Nevo en espalda","estado":"alta","es_inicial":false,
          "fecha":"2026-08-15","medico":"Dr. Pérez","especialista":null,"diagnostico":null,"histopatologico":null,
          "tratamiento":null,"observaciones":null,"hallazgos":null,"proximo_control_fecha":null,"proximo_control_motivo":null},
         {"episode_id":"e0","fecha":"2026-07-01","estado":"en_curso","diagnostico_histopatologico":"Nevus"}
        ]}
    """.trimIndent()

    private val rows: List<FilaEvolucion> by lazy { jsonCepi.decodeFromString<Lista<FilaEvolucion>>(json).data }

    @Test
    fun contratoDeLaFilaNueva() {
        assertEquals(4, rows.size)
        val control = rows[0]
        assertEquals("e2", control.episodio)
        assertEquals("v2", control.evolutionId)
        assertEquals("Psoriasis en codos", control.motivo)
        assertEquals("cerrado", control.estado)
        assertEquals(false, control.esInicial)
        assertEquals("2026-11-05", control.fecha)
        assertEquals("Placas más delgadas", control.hallazgos)
        assertEquals("Psoriasis psoriasiforme", control.histopathology)
        assertEquals("2027-02-05", control.proximoControlFecha)
        assertEquals("Control de placas", control.proximoControlMotivo)
        assertEquals(true, rows[1].esInicial)
        assertEquals("Dr. Luis Mora", rows[1].especialista)
        // Fila armada: sin evolution_id.
        assertNull(rows[2].evolutionId)
        // Backend viejo: sin campos nuevos, con el nombre largo del histopatológico.
        assertNull(rows[3].evolutionId)
        assertNull(rows[3].motivo)
        assertNull(rows[3].esInicial)
        assertNull(rows[3].hallazgos)
        assertEquals("Nevus", rows[3].histopathology)
        // Las claves de fila no chocan aunque una ficha tenga varias filas.
        assertEquals(rows.size, rows.map { it.rowKey }.toSet().size)
    }

    @Test
    fun agruparPorFichaRespetandoElOrden() {
        val groups = EvolutionGrouping.group(rows)
        assertEquals(listOf("e2", "e1", "e0"), groups.map { it.episodeId })
        assertEquals(listOf("v2", "v1"), groups[0].rows.map { it.evolutionId })
        assertEquals(2, groups[0].count)
        assertEquals("2026-10-01", groups[0].openedOn)
        assertEquals("Psoriasis en codos", groups[0].motivo)
        assertEquals("Cerrada", EpisodeEvolutions.estadoLabel(groups[0].estado))
        assertEquals("Alta", EpisodeEvolutions.estadoLabel(groups[1].estado))
        assertEquals("En curso", EpisodeEvolutions.estadoLabel(groups[2].estado))
        assertEquals("Sin estado", EpisodeEvolutions.estadoLabel(null))
    }

    @Test
    fun filasDeLaFichaAbierta() {
        val groups = EvolutionGrouping.group(rows)
        val open = EvolutionGrouping.openEpisode(groups, "e1")
        assertEquals("e1", open?.episodeId)
        // Sin ficha en la barra, o una que no es del paciente: la más nueva.
        assertEquals("e2", EvolutionGrouping.openEpisode(groups, null)?.episodeId)
        assertEquals("e2", EvolutionGrouping.openEpisode(groups, "zz")?.episodeId)
        assertNull(EvolutionGrouping.openEpisode(emptyList(), "e1"))
    }

    @Test
    fun agregarEvolucionBloqueadoPorAlta() {
        val groups = EvolutionGrouping.group(rows)
        val e2 = groups[0]
        val e1 = groups[1]
        assertNull(EvolutionGrouping.addDisabledReason(e2, loaded = true, busy = false))
        assertTrue(e1.discharged)
        assertEquals("Esta ficha está de alta: abre una consulta nueva", EvolutionGrouping.addDisabledReason(e1, loaded = true, busy = false))
        assertEquals("Cargando la evolución…", EvolutionGrouping.addDisabledReason(e2, loaded = false, busy = false))
        assertEquals("Termina primero lo que estás editando", EvolutionGrouping.addDisabledReason(e2, loaded = true, busy = true))
        assertEquals(
            "Este paciente todavía no tiene fichas: abre una consulta primero",
            EvolutionGrouping.addDisabledReason(null, loaded = true, busy = false),
        )
    }

    @Test
    fun formularioDeEvolucion() {
        val draft = EvolutionDraft.start("e2", LocalDate.parse("2026-11-09"))
        assertEquals("2026-11-09", draft.fecha)
        assertEquals("Escribe hallazgos, diagnóstico, tratamiento u observaciones", draft.saveDisabledReason)
        // Solo el próximo control no basta (el backend responde 400).
        assertEquals(
            "Escribe hallazgos, diagnóstico, tratamiento u observaciones",
            draft.copy(proximoControlFecha = "2027-01-01").saveDisabledReason,
        )
        val ok = draft.copy(tratamiento = "Calcipotriol")
        assertNull(ok.saveDisabledReason)
        assertEquals("Elige la fecha de la cita", ok.copy(fecha = "").saveDisabledReason)
        assertEquals("La fecha del próximo control no es válida", ok.copy(proximoControlFecha = "mañana").saveDisabledReason)
        assertEquals("Guardando…", ok.copy(saving = true).saveDisabledReason)
    }

    @Test
    fun observacionesSegunLaFila() {
        val registrada = ObservationEdit.start(rows[0])
        assertEquals("v2", registrada.evolutionId)
        val armada = ObservationEdit.start(rows[2])
        assertNull(armada.evolutionId)
        assertEquals("e1", armada.episodeId)
        // Dos evoluciones de la misma ficha son filas distintas.
        assertEquals("Termina primero la otra observación", ObservationEdit.editDisabledReason(registrada, rows[1]))
        assertEquals("Ya la estás editando", ObservationEdit.editDisabledReason(registrada, rows[0]))
        assertEquals("Termina primero la evolución que estás agregando", ObservationEdit.editDisabledReason(null, rows[0], addingEvolution = true))
        val saved = ObservationEdit.applySaved(rows, rows[1].rowKey, "Nuevo")
        assertEquals("Nuevo", saved[1].observaciones)
        assertEquals("Mejoría", saved[0].observaciones)
    }

    @Test
    fun agregarEvolucionMandaSoloLoEscrito() = runBlocking {
        val s = ServidorFalso().apply {
            fijar("POST /api/bot/episodio/evolucion", Respuesta.Http(201, """{"ok":true,"evolution_id":"v3"}"""))
        }
        val api = s.api(Credenciales(AlmacenMemoria("t")))
        val result = api.addEvolution("e2", "2026-11-09", " Placas finas ", "L40.0 — Psoriasis vulgar", "", null, "2027-02-09", "  ")
        assertEquals("v3", result.evolutionId)
        assertTrue(result.ok)
        assertEquals(
            """{"episode_id":"e2","fecha":"2026-11-09","hallazgos":"Placas finas","diagnostico":"L40.0 — Psoriasis vulgar","proximo_control_fecha":"2027-02-09"}""",
            s.cuerpo("POST /api/bot/episodio/evolucion"),
        )
    }

    @Test
    fun agregarEvolucionAFichaDeAltaFallaConElMensaje() = runBlocking {
        val s = ServidorFalso().apply {
            fijar(
                "POST /api/bot/episodio/evolucion",
                Respuesta.Http(409, """{"ok":false,"error":"Esta ficha está de alta: abre una consulta nueva"}"""),
            )
        }
        val api = s.api(Credenciales(AlmacenMemoria("t")))
        try {
            api.addEvolution("e1", null, "x", null, null, null, null, null)
            fail("Debió fallar")
        } catch (e: ApiError) {
            assertEquals("Esta ficha está de alta: abre una consulta nueva", e.mensaje)
        }
        assertEquals("""{"episode_id":"e1","hallazgos":"x"}""", s.cuerpo("POST /api/bot/episodio/evolucion"))
    }

    @Test
    fun editarObservacionesDeUnaEvolucion() = runBlocking {
        val s = ServidorFalso().apply {
            fijar("POST /api/bot/evolucion/editar", Respuesta.Http(200, """{"ok":true}"""))
        }
        val api = s.api(Credenciales(AlmacenMemoria("t")))
        api.editEvolution("v2", " Mejoría clara ")
        assertEquals("""{"evolution_id":"v2","observaciones":"Mejoría clara"}""", s.cuerpo("POST /api/bot/evolucion/editar"))
        assertFalse(CepiApi.editEvolutionBody("v2", "").toString().contains("episode_id"))
    }

    private fun next(fecha: String?, estado: String? = "en_seguimiento", hoy: String = "2026-11-09") =
        NextControl.of(
            EpisodeEvolutions(
                "e1",
                listOf(
                    FilaEvolucion(episodio = "e1", estado = estado, proximoControlFecha = fecha, proximoControlMotivo = "Revisar lesión"),
                    FilaEvolucion(episodio = "e1", estado = estado, proximoControlFecha = "2020-01-01"),
                ),
            ),
            LocalDate.parse(hoy),
        )

    @Test
    fun proximoControlConFecha() {
        assertEquals(NextControlStatus.Overdue, next("2026-11-08").status)
        assertEquals(NextControlStatus.Today, next("2026-11-09").status)
        val n = next("2026-11-20")
        assertEquals(NextControlStatus.Upcoming, n.status)
        assertEquals(LocalDate.parse("2026-11-20"), n.date)
        assertEquals("Revisar lesión", n.motivo)
        assertNull(n.emptyText)
    }

    @Test
    fun proximoControlSinFechaYAlta() {
        val sin = next(null)
        assertNull(sin.date)
        assertNull(sin.status)
        assertEquals("Sin próximo control indicado", sin.emptyText)
        assertEquals("Ficha de alta: sin controles pendientes", next("", estado = "alta").emptyText)
    }

    @Test
    fun ordenDeCitaLaMasNuevaAbajoYEsLaVigente() {
        val e2 = EvolutionGrouping.group(rows)[0]
        // PAPER §28.4.1: la más vieja arriba, la más nueva abajo (encima de «Próximo control»).
        assertEquals(listOf("v1", "v2"), e2.chronological.map { it.evolutionId })
        assertEquals("v2", e2.latest?.evolutionId)
        assertEquals(LocalDate.parse("2027-02-05"), NextControl.of(e2, LocalDate.parse("2026-11-09")).date)
        // La fila armada sola: es la vigente.
        val e1 = EvolutionGrouping.group(rows)[1]
        assertEquals(e1.rows, e1.chronological)
        assertNull(e1.latest?.evolutionId)
    }

    @Test
    fun tocarUnaEvolucionAbreSuFormularioPrellenado() {
        val draft = EvolutionDraft.edit(rows[0], discharged = false)
        assertTrue(draft.isEdit)
        assertEquals("v2", draft.evolutionId)
        assertEquals("e2", draft.episodeId)
        assertEquals("2026-11-05", draft.fecha)
        assertEquals("Placas más delgadas", draft.hallazgos)
        assertEquals("L40.0 — Psoriasis vulgar", draft.diagnostico)
        assertEquals("Calcipotriol", draft.tratamiento)
        assertEquals("Mejoría", draft.observaciones)
        assertEquals("2027-02-05", draft.proximoControlFecha)
        assertEquals("Control de placas", draft.proximoControlMotivo)
        assertEquals(rows[0].rowKey, draft.rowKey)
        assertFalse(draft.focusNextControl)
        assertEquals(emptyMap<String, String>(), draft.changes)
        assertEquals("No hay cambios que guardar", draft.saveDisabledReason)
        // Solo viaja lo que cambió; vaciar un campo lo borra.
        val changed = draft.copy(tratamiento = " Calcipotriol y emoliente ", observaciones = "")
        assertEquals(mapOf("tratamiento" to "Calcipotriol y emoliente", "observaciones" to ""), changed.changes)
        assertNull(changed.saveDisabledReason)
        assertEquals("Elige la fecha de la cita", changed.copy(fecha = "").saveDisabledReason)
        // «Agregar» sigue mandando todo lo escrito.
        assertFalse(EvolutionDraft.start("e2").isEdit)
    }

    @Test
    fun filaArmadaSinFechaProponeHoyYVaPorEpisodio() {
        val draft = EvolutionDraft.edit(FilaEvolucion(episodio = "e9", diagnostico = "L70.0"), discharged = false, today = LocalDate.parse("2026-11-11"))
        assertNull(draft.evolutionId)
        assertEquals("2026-11-11", draft.fecha)
        assertEquals(mapOf("fecha" to "2026-11-11"), draft.changes)
        assertNull(draft.saveDisabledReason)
    }

    @Test
    fun proximoControlConFichaDeAlta() {
        val e1 = EvolutionGrouping.group(rows)[1]
        assertEquals("Ficha de alta: abre una consulta nueva para otro control", NextControl.editDisabledReason(e1, busy = false))
        val e2 = EvolutionGrouping.group(rows)[0]
        assertNull(NextControl.editDisabledReason(e2, busy = false))
        assertEquals("Termina primero lo que estás editando", NextControl.editDisabledReason(e2, busy = true))
        assertEquals(
            "Este paciente todavía no tiene fichas: abre una consulta primero",
            NextControl.editDisabledReason(null, busy = false),
        )
        val draft = EvolutionDraft.edit(e1.latest!!, discharged = true, focusNextControl = true)
        assertTrue(draft.focusNextControl)
        assertEquals("Ficha de alta: no se puede fijar un próximo control", draft.copy(proximoControlFecha = "2027-01-01").saveDisabledReason)
        // Lo demás sí se edita con la ficha de alta.
        assertNull(draft.copy(proximoControlMotivo = "Nada").saveDisabledReason)
        assertEquals("Termina primero el formulario abierto", EvolutionGrouping.editDisabledReason(draftOpen = true, observationOpen = false))
        assertEquals("Termina primero la observación que estás editando", EvolutionGrouping.editDisabledReason(draftOpen = false, observationOpen = true))
        assertNull(EvolutionGrouping.editDisabledReason(draftOpen = false, observationOpen = false))
    }

    @Test
    fun editarDesdeElFormularioMandaSoloLoQueCambio() = runBlocking {
        val s = ServidorFalso().apply {
            fijar("POST /api/bot/evolucion/editar", Respuesta.Http(200, """{"ok":true,"evolution_id":"v2"}"""))
        }
        val api = s.api(Credenciales(AlmacenMemoria("t")))
        val draft = EvolutionDraft.edit(rows[0], discharged = false).copy(fecha = "2026-11-06", observaciones = "", proximoControlMotivo = " Biopsia ")
        val result = api.editEvolution(draft.evolutionId, draft.episodeId, draft.changes)
        assertEquals("v2", result.evolutionId)
        assertEquals(
            """{"evolution_id":"v2","fecha":"2026-11-06","observaciones":"","proximo_control_motivo":"Biopsia"}""",
            s.cuerpo("POST /api/bot/evolucion/editar"),
        )
        // La fila armada va por episode_id.
        assertEquals(
            """{"episode_id":"e1","tratamiento":"Crema"}""",
            CepiApi.editEvolutionBody(null, "e1", mapOf("tratamiento" to "Crema")).toString(),
        )
    }

    @Test
    fun editarConFichaDeAltaFallaConElMotivo() = runBlocking {
        val s = ServidorFalso().apply {
            fijar(
                "POST /api/bot/evolucion/editar",
                Respuesta.Http(400, """{"ok":false,"error":"La ficha está de alta: no se puede fijar un próximo control"}"""),
            )
        }
        val api = s.api(Credenciales(AlmacenMemoria("t")))
        try {
            api.editEvolution(null, "e1", mapOf("proximo_control_fecha" to "2027-01-01"))
            fail("Debió fallar")
        } catch (e: ApiError) {
            assertEquals("La ficha está de alta: no se puede fijar un próximo control", e.mensaje)
        }
    }
}
