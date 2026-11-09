package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Confirmacion
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.GrupoDerivacion
import ec.cepi.telemedicina.api.Lista
import ec.cepi.telemedicina.api.MiembroGrupo
import ec.cepi.telemedicina.api.Shift
import ec.cepi.telemedicina.api.ShiftList
import ec.cepi.telemedicina.api.Uno
import ec.cepi.telemedicina.api.Usuario
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.turnos.ShiftCalendar
import ec.cepi.telemedicina.turnos.ShiftMember
import ec.cepi.telemedicina.turnos.ShiftsModel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** Calendario de turnos (PAPER §32): contrato con TodoERP, cuentas de las semanas y la carga. */
class TurnosTest {
    private inline fun <reified T> decodificar(json: String): T = jsonCepi.decodeFromString(json)

    private val turnosJson = """
        {"ok":true,"data":[{"id":"s1","user_id":"u1","user_name":"Dra. Ana","starts_on":"2026-11-09","ends_on":"2026-11-15","created_by":"u9","created_at":"2026-11-08T15:00:00.000Z"},
        {"id":"s2","user_id":"u2","user_name":"Dr. Luis","starts_on":"2026-11-14","ends_on":"2026-11-18","created_by":null,"created_at":"2026-11-08T15:00:00.000Z"}],
        "from":"2026-11-09","to":"2027-01-03","today":"2026-11-11"}
    """

    private val gruposJson = """
        {"ok":true,"data":[{"id":"g0","slug":"todos","name":"Todos","kind":"all","member_count":12},
        {"id":"g1","slug":"turno","name":"Turno","kind":"roster","member_count":3},
        {"id":"g2","slug":"dermatologia","name":"Dermatología","kind":"specialty","member_count":2}]}
    """

    private val miembrosJson = """
        {"ok":true,"data":[{"user_id":"u1","name":"Dra. Ana","email":"ana@cepi.ec","role_in_group":"member","created_at":"2026-01-01T00:00:00.000Z"},
        {"user_id":"u2","name":"Dr. Luis","email":"luis@cepi.ec","role_in_group":"lead","created_at":"2026-01-01T00:00:00.000Z"}]}
    """

    private fun d(texto: String) = LocalDate.parse(texto)

    private fun shift(id: String, user: String, from: String, to: String) =
        Shift(id = id, userId = user, userName = user.uppercase(), startsOn = from, endsOn = to)

    // Contrato

    @Test
    fun listaDeTurnos() {
        val r = decodificar<ShiftList>(turnosJson)
        assertEquals("2026-11-11", r.today)
        assertEquals("2026-11-09", r.from)
        assertEquals("2027-01-03", r.to)
        assertEquals(listOf("s1", "s2"), r.data.map { it.id })
        assertEquals("Dra. Ana", r.data[0].displayName)
        assertEquals(d("2026-11-14"), r.data[1].startDate)
        assertEquals(d("2026-11-18"), r.data[1].endDate)
        assertNull(r.data[1].createdBy)
    }

    @Test
    fun turnoCreado() {
        val r = decodificar<Uno<Shift>>(
            """{"ok":true,"data":{"id":"s3","user_id":"u2","starts_on":"2026-11-16","ends_on":"2026-11-22","created_by":"u1","created_at":"2026-11-09T12:00:00.000Z","org_id":"o1","group_id":"g2","user_name":"Dr. Luis"}}""",
        )
        assertEquals("s3", r.data.id)
        assertEquals("Dr. Luis", r.data.userName)
    }

    @Test
    fun gruposYMiembros() {
        val grupos = decodificar<Lista<GrupoDerivacion>>(gruposJson).data
        assertEquals(listOf("all", "roster", "specialty"), grupos.map { it.tipo })
        val miembros = ShiftCalendar.members(decodificar<Lista<MiembroGrupo>>(miembrosJson).data)
        assertEquals(listOf(ShiftMember("u1", "Dra. Ana"), ShiftMember("u2", "Dr. Luis")), miembros)
        assertTrue(decodificar<Confirmacion>("""{"ok":true}""").ok)
    }

    @Test
    fun cuerpoDelPost() {
        val cuerpo = CepiApi.shiftBody("u2", d("2026-11-16"), d("2026-11-22"))
        assertEquals("""{"user_id":"u2","starts_on":"2026-11-16","ends_on":"2026-11-22"}""", cuerpo.toString())
    }

    // Semanas

    @Test
    fun lunesDeUnaFecha() {
        assertEquals(d("2026-11-09"), ShiftCalendar.mondayOf(d("2026-11-09")))   // lunes
        assertEquals(d("2026-11-09"), ShiftCalendar.mondayOf(d("2026-11-11")))   // miércoles
        assertEquals(d("2026-11-09"), ShiftCalendar.mondayOf(d("2026-11-15")))   // domingo: la semana que termina
        assertEquals(d("2026-12-28"), ShiftCalendar.mondayOf(d("2027-01-01")))   // cruza el año
    }

    @Test
    fun ochoSemanasDeLunesADomingo() {
        val semanas = ShiftCalendar.weeks(d("2026-11-15"), emptyList())
        assertEquals(8, semanas.size)
        assertEquals(d("2026-11-09"), semanas.first().start)
        assertEquals(d("2026-11-15"), semanas.first().end)
        assertTrue(semanas.first().current)
        assertTrue(semanas.drop(1).none { it.current })
        assertEquals(d("2026-12-28"), semanas.last().start)
        assertEquals(d("2027-01-03"), semanas.last().end)
        assertEquals(d("2027-01-03"), ShiftCalendar.rangeEnd(d("2026-11-09")))
        assertEquals("9 nov – 15 nov", ShiftCalendar.weekLabel(semanas.first()))
        assertEquals("28 dic – 3 ene", ShiftCalendar.weekLabel(semanas.last()))
    }

    @Test
    fun turnosQueTocanCadaSemana() {
        val completo = shift("a", "ana", "2026-11-09", "2026-11-15")
        val cruzado = shift("b", "luis", "2026-11-14", "2026-11-18")
        val lejano = shift("c", "eva", "2027-03-01", "2027-03-07")
        val semanas = ShiftCalendar.weeks(d("2026-11-11"), listOf(completo, cruzado, lejano))
        assertEquals(listOf("a", "b"), semanas[0].shifts.map { it.id })
        assertEquals(listOf("b"), semanas[1].shifts.map { it.id })
        assertTrue(semanas.drop(2).all { it.shifts.isEmpty() })

        assertFalse(ShiftCalendar.isPartial(completo, semanas[0]))
        assertTrue(ShiftCalendar.isPartial(cruzado, semanas[0]))
        assertTrue(ShiftCalendar.isPartial(cruzado, semanas[1]))
        assertEquals("(14 nov–18 nov)", ShiftCalendar.partialLabel(cruzado))
    }

    @Test
    fun deTurnoHoyYMiembrosLibres() {
        val turnos = listOf(
            shift("a", "ana", "2026-11-09", "2026-11-15"),
            shift("a2", "ana", "2026-11-15", "2026-11-15"),
            shift("b", "luis", "2026-11-16", "2026-11-22"),
        )
        assertEquals(listOf("ANA"), ShiftCalendar.onCall(d("2026-11-15"), turnos))   // domingo, sin repetir
        assertEquals("LUIS", ShiftCalendar.onCallText(d("2026-11-16"), turnos))
        assertEquals("nadie asignado (avisa a todo el grupo)", ShiftCalendar.onCallText(d("2026-12-01"), turnos))

        val miembros = listOf(ShiftMember("ana", "Ana"), ShiftMember("luis", "Luis"))
        val semana = ShiftCalendar.weeks(d("2026-11-09"), turnos).first()
        assertEquals(listOf("luis"), ShiftCalendar.freeMembers(semana, miembros).map { it.id })
    }

    @Test
    fun motivosDeLosControlesGrises() {
        assertEquals("Espera a que termine el cambio anterior", ShiftCalendar.removeDisabledReason(true))
        assertNull(ShiftCalendar.removeDisabledReason(false))
        assertEquals("Espera a que termine el cambio anterior", ShiftCalendar.assignDisabledReason(true, 2, "u1"))
        assertEquals("Todos los miembros del grupo ya están en esta semana", ShiftCalendar.assignDisabledReason(false, 0, null))
        assertEquals("Elige a quién asignar", ShiftCalendar.assignDisabledReason(false, 2, null))
        assertNull(ShiftCalendar.assignDisabledReason(false, 2, "u1"))
        assertNull(ShiftCalendar.pickerDisabledReason(false, 2))
    }

    @Test
    fun permisoDeEdicion() {
        fun usuario(vararg p: String) = Usuario(id = "u", name = "X", email = "x@cepi.ec", permissions = p.toList())
        assertTrue(usuario("groups:manage_shifts").puede(ShiftCalendar.EDIT_PERMISSION))
        assertTrue(usuario("*:*:*:*").puede(ShiftCalendar.EDIT_PERMISSION))
        assertFalse(usuario("groups:read").puede(ShiftCalendar.EDIT_PERMISSION))
    }

    // Carga

    private fun servidor() = ServidorFalso().apply {
        fijar("GET /api/groups", Respuesta.Http(200, gruposJson))
        fijar("GET /api/groups/dermatologia/members", Respuesta.Http(200, miembrosJson))
        fijar("GET /api/groups/dermatologia/shifts", Respuesta.Http(200, turnosJson))
    }

    @Test
    fun cargaElGrupoPorDefectoSinElVirtualTodos() = runBlocking {
        val s = servidor()
        val modelo = ShiftsModel(s.api(Credenciales(AlmacenMemoria("t"))))
        modelo.start(localToday = d("2026-11-10"))
        assertEquals(listOf("turno", "dermatologia"), modelo.groups.map { it.slug })
        assertEquals("dermatologia", modelo.group)
        assertEquals(d("2026-11-11"), modelo.today)
        assertEquals("Dra. Ana", modelo.onCallText)
        assertEquals(2, modelo.members.size)
        // Misma semana que el teléfono: una sola petición de turnos.
        assertEquals(1, s.pedidos.count { it == "GET /api/groups/dermatologia/shifts" })
        assertNull(modelo.error)
    }

    @Test
    fun siElHoyDelServidorEsOtraSemanaVuelveAPedir() = runBlocking {
        val s = servidor()
        val modelo = ShiftsModel(s.api(Credenciales(AlmacenMemoria("t"))))
        // Domingo 22:00 en el teléfono adelantado: ya es lunes 16 y el servidor dice 11.
        modelo.start(localToday = d("2026-11-16"))
        assertEquals(2, s.pedidos.count { it == "GET /api/groups/dermatologia/shifts" })
        assertEquals(d("2026-11-09"), modelo.weeks.first().start)
    }

    @Test
    fun errorAlGuardarSeVeComoEnLaWeb() = runBlocking {
        val s = servidor()
        s.fijar("POST /api/groups/dermatologia/shifts", Respuesta.Http(403, """{"ok":false,"error":"Sin permiso"}"""))
        val modelo = ShiftsModel(s.api(Credenciales(AlmacenMemoria("t"))))
        modelo.start(localToday = d("2026-11-11"))
        assertFalse(modelo.assign(modelo.weeks[1], "u2"))
        assertEquals("No se pudo guardar: Sin permiso", modelo.notice)
        assertTrue(modelo.noticeIsError)
        assertFalse(modelo.busy)
        assertEquals("""{"user_id":"u2","starts_on":"2026-11-16","ends_on":"2026-11-22"}""", s.cuerpo("POST /api/groups/dermatologia/shifts"))
    }

    @Test
    fun asignarYQuitar() = runBlocking {
        val s = servidor()
        s.fijar(
            "POST /api/groups/dermatologia/shifts",
            Respuesta.Http(201, """{"ok":true,"data":{"id":"s3","user_id":"u2","user_name":"Dr. Luis","starts_on":"2026-11-16","ends_on":"2026-11-22","created_by":"u1","created_at":"x"}}"""),
        )
        s.fijar("DELETE /api/groups/dermatologia/shifts/s1", Respuesta.Http(200, """{"ok":true}"""))
        val modelo = ShiftsModel(s.api(Credenciales(AlmacenMemoria("t"))))
        modelo.start(localToday = d("2026-11-11"))

        assertTrue(modelo.assign(modelo.weeks[1], "u2"))
        assertEquals("Dr. Luis quedó de turno la semana del 16 nov – 22 nov", modelo.notice)
        assertFalse(modelo.noticeIsError)

        assertTrue(modelo.remove(modelo.shifts.first { it.id == "s1" }))
        assertEquals("Se quitó a Dra. Ana del turno", modelo.notice)
    }
}
