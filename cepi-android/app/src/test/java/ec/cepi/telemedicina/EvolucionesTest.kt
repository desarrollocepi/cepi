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
        assertEquals("Psoriasis en codos · 2026-10-01 · Cerrada · 2 evoluciones", groups[0].summary)
        assertEquals("Nevo en espalda · 2026-08-15 · Alta · 1 evolución", groups[1].summary)
        assertEquals("Sin motivo registrado · 2026-07-01 · En curso · 1 evolución", groups[2].summary)
    }

    @Test
    fun filasDeLaFichaAbierta() {
        val groups = EvolutionGrouping.group(rows)
        val open = EvolutionGrouping.openEpisode(groups, "e1")
        assertEquals("e1", open?.episodeId)
        assertEquals(listOf("e2", "e0"), EvolutionGrouping.others(groups, open).map { it.episodeId })
        // Sin ficha en la barra, o una que no es del paciente: la más nueva.
        assertEquals("e2", EvolutionGrouping.openEpisode(groups, null)?.episodeId)
        assertEquals("e2", EvolutionGrouping.openEpisode(groups, "zz")?.episodeId)
        assertNull(EvolutionGrouping.openEpisode(emptyList(), "e1"))
        assertEquals(emptyList<EpisodeEvolutions>(), EvolutionGrouping.others(emptyList(), null))
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
}
