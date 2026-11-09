package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.FollowUpList
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.controles.FollowUpSchedule
import ec.cepi.telemedicina.controles.FollowUpsModel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** Próximos controles (PAPER §33): contrato con cepi-bot, agrupación por semanas y la carga. */
class ControlesTest {
    private val controlesJson = """
        {"ok":true,"today":"2026-11-09","from":"2026-10-10","to":"2027-02-07","data":[
        {"episode_id":"e1","patient_id":"p1","paciente":"Luis Mora","cedula":"0911","fecha_control":"2026-11-02","motivo":null,"plan":null,"diagnostico":"Acné","fecha_consulta":"2026-09-01","medico":"Dr. Paz","estado_control":"atrasado"},
        {"episode_id":"e2","patient_id":"p2","paciente":"Ana Pérez","cedula":"0102","fecha_control":"2026-11-11","motivo":"Control de nevus","plan":"Dermatoscopía","diagnostico":"Nevus","fecha_consulta":"2026-10-01","medico":"Dra. Gaby","estado_control":"proximo"},
        {"episode_id":"e3","patient_id":"p3","paciente":"Eva Ruiz","cedula":null,"fecha_control":"2026-11-09","motivo":null,"plan":null,"diagnostico":null,"fecha_consulta":null,"medico":null,"estado_control":"hoy"},
        {"episode_id":"e4","patient_id":null,"paciente":"Sin Ficha","cedula":"0303","fecha_control":"2026-11-16","motivo":"Retirar puntos","plan":null,"diagnostico":null,"fecha_consulta":null,"medico":null,"estado_control":"proximo"},
        {"episode_id":"e5","patient_id":"p5","paciente":"José Gil","cedula":"0404","fecha_control":"2026-12-03","motivo":"Biopsia","plan":null,"diagnostico":null,"fecha_consulta":null,"medico":null,"estado_control":"proximo"}]}
    """

    private fun d(texto: String) = LocalDate.parse(texto)

    private val lista: FollowUpList get() = jsonCepi.decodeFromString(controlesJson)

    @Test
    fun contrato() {
        val r = lista
        assertEquals("2026-11-09", r.today)
        assertEquals("2026-10-10", r.from)
        assertEquals("2027-02-07", r.to)
        val ana = r.data[1]
        assertEquals("e2", ana.episodeId)
        assertEquals("p2", ana.patientId)
        assertEquals("Ana Pérez", ana.paciente)
        assertEquals("0102", ana.cedula)
        assertEquals("2026-11-11", ana.fechaControl)
        assertEquals("Control de nevus", ana.motivo)
        assertEquals("Dermatoscopía", ana.plan)
        assertEquals("Nevus", ana.diagnostico)
        assertEquals("2026-10-01", ana.fechaConsulta)
        assertEquals("Dra. Gaby", ana.medico)
        assertEquals("proximo", ana.estadoControl)
        assertTrue(r.data[0].overdue)
        assertTrue(r.data[2].isToday)
        assertNull(r.data[2].cedula)
        assertNull(r.data[3].patientId)
    }

    @Test
    fun fechasEnEspanol() {
        assertEquals("miércoles", FollowUpSchedule.weekday("2026-11-11"))
        assertEquals("domingo", FollowUpSchedule.weekday("2026-11-15"))
        assertEquals("11 nov 2026", FollowUpSchedule.longDate("2026-11-11"))
        assertEquals("30 nov 2026", FollowUpSchedule.longDate(d("2026-11-30")))
        assertEquals(d("2026-11-09"), FollowUpSchedule.mondayOf(d("2026-11-15")))
    }

    @Test
    fun gruposPorSemana() {
        val grupos = FollowUpSchedule.groups(lista.data, d("2026-11-09"))
        assertEquals(listOf("Atrasados", "Esta semana", "Próxima semana", "Semana del 30 nov 2026"), grupos.map { it.title })
        assertTrue(grupos[0].overdue)
        assertFalse(grupos[1].overdue)
        assertEquals(listOf("e1"), grupos[0].rows.map { it.episodeId })
        assertEquals(listOf("e2", "e3"), grupos[1].rows.map { it.episodeId })
        assertEquals(listOf("e4"), grupos[2].rows.map { it.episodeId })
        assertEquals(listOf("e5"), grupos[3].rows.map { it.episodeId })
        assertEquals("2026-11-30", grupos[3].key)
    }

    @Test
    fun hoyDelServidorEnDomingo() {
        // Domingo 15: «esta semana» sigue siendo la del lunes 9; el 16 ya es la próxima.
        val grupos = FollowUpSchedule.groups(lista.data.filter { !it.overdue }, d("2026-11-15"))
        assertEquals(listOf("Esta semana", "Próxima semana", "Semana del 30 nov 2026"), grupos.map { it.title })
    }

    @Test
    fun sinAtrasadosNoHayGrupoAtrasados() {
        val grupos = FollowUpSchedule.groups(lista.data.filter { !it.overdue }, d("2026-11-09"))
        assertEquals("Esta semana", grupos.first().title)
        assertTrue(FollowUpSchedule.groups(emptyList(), d("2026-11-09")).isEmpty())
    }

    @Test
    fun filtroPorPacienteOCedula() {
        val filas = lista.data
        assertEquals(listOf("e2"), FollowUpSchedule.filter(filas, "0102").map { it.episodeId })
        assertEquals(listOf("e2"), FollowUpSchedule.filter(filas, "  ana pé ").map { it.episodeId })
        assertEquals(filas, FollowUpSchedule.filter(filas, "  "))
        assertTrue(FollowUpSchedule.filter(filas, "xyz").isEmpty())
        val grupos = FollowUpSchedule.groups(FollowUpSchedule.filter(filas, "0404"), d("2026-11-09"))
        assertEquals(listOf("Semana del 30 nov 2026"), grupos.map { it.title })
    }

    @Test
    fun textos() {
        val filas = lista.data
        assertEquals("Nevus · indicó Dra. Gaby · consulta del 1 oct 2026", FollowUpSchedule.metaLine(filas[1]))
        assertEquals("", FollowUpSchedule.metaLine(filas[2]))
        assertEquals("No hay controles agendados en los próximos 90 días", FollowUpSchedule.emptyText(" "))
        assertEquals("Ningún control para «xyz»", FollowUpSchedule.emptyText(" xyz "))
    }

    @Test
    fun cargaContraElBot() = runBlocking {
        val s = ServidorFalso().apply { fijar("GET /api/bot/controles", Respuesta.Http(200, controlesJson)) }
        val modelo = FollowUpsModel(s.api(Credenciales(AlmacenMemoria("t"))))
        modelo.load()
        assertNull(modelo.error)
        assertFalse(modelo.loading)
        assertEquals(d("2026-11-09"), modelo.today)
        assertEquals(5, modelo.rows.size)
        assertEquals(4, modelo.groups("").size)
        assertEquals(listOf("GET /api/bot/controles"), s.pedidos)
    }

    @Test
    fun errorDeCarga() = runBlocking {
        val s = ServidorFalso().apply { fijar("GET /api/bot/controles", Respuesta.Http(500, """{"ok":false,"error":"falló"}""")) }
        val modelo = FollowUpsModel(s.api(Credenciales(AlmacenMemoria("t"))))
        modelo.load()
        assertTrue(modelo.error!!.startsWith("No se pudieron cargar los controles"))
        assertFalse(modelo.loading)
    }
}
