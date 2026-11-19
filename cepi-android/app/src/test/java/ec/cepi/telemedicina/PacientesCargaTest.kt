package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.pacientes.EstadoFicha
import ec.cepi.telemedicina.pacientes.PacientesModelo
import ec.cepi.telemedicina.pacientes.PatientScope
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cambiar de organización con una carga en curso y los fallos parciales. Los de
 * `PacientesCargaTests.swift`, más lo que iOS no probaba.
 */
class PacientesCargaTest {
    private fun lista(vararg nombres: String) =
        nombres.mapIndexed { i, nombre -> """{"id":"p$i-$nombre","data":{"nombre":"$nombre"}}""" }
            .joinToString(",", prefix = """{"ok":true,"data":[""", postfix = "]}")

    private fun servidor() = ServidorFalso().apply {
        fijar("GET /api/review-queue", Respuesta.Http(200, """{"ok":true,"by_patient":{}}"""))
        fijar("GET /api/patient-assignments", Respuesta.Http(200, """{"ok":true,"assignments":{}}"""))
    }

    private fun ServidorFalso.api() = api(Credenciales(AlmacenMemoria("t")))

    @Test
    fun alCambiarDeOrgSeVaciaYNoQuedaLaListaAnterior() = runBlocking {
        val servidor = servidor()
        servidor.fijar("GET /api/entities", Respuesta.Http(200, lista("Ana")))
        val modelo = PacientesModelo()

        modelo.usarOrganizacion("org-a")
        modelo.cargar(servidor.api())
        assertEquals(listOf("Ana"), modelo.filas.map { it.nombre })

        modelo.usarOrganizacion("org-b")
        assertTrue(modelo.filas.isEmpty())
        assertFalse(modelo.cargado)   // la vista vuelve a "Cargando pacientes…"
    }

    @Test
    fun unaRespuestaTardiaDeLaOrgAnteriorNoPisaLaNueva() = runBlocking {
        val servidor = servidor()
        // La primera carga (org A) tarda; la segunda (org B) llega enseguida.
        servidor.fijar(
            "GET /api/entities",
            Respuesta.Http(200, lista("De la org A"), demoraMs = 1_000),
            Respuesta.Http(200, lista("De la org B")),
        )
        val api = servidor.api()
        val modelo = PacientesModelo()
        modelo.usarOrganizacion("org-a")

        val vieja = async { modelo.cargar(api) }
        delay(200)
        modelo.usarOrganizacion("org-b")
        modelo.cargar(api)
        assertEquals(listOf("De la org B"), modelo.filas.map { it.nombre })

        vieja.await()
        assertEquals(listOf("De la org B"), modelo.filas.map { it.nombre })
        assertTrue(modelo.cargado)
    }

    @Test
    fun siFallanLosAccesoriosSeConservaRevisar() = runBlocking {
        val servidor = servidor()
        servidor.fijar("GET /api/entities", Respuesta.Http(200, lista("Ana")))
        servidor.fijar(
            "GET /api/review-queue",
            Respuesta.Http(200, """{"ok":true,"by_patient":{"p0-Ana":{"pending":1}}}"""),
            Respuesta.Http(500, """{"ok":false,"error":"Internal server error"}"""),
        )
        val api = servidor.api()
        val modelo = PacientesModelo()

        modelo.cargar(api)
        modelo.cargar(api)

        assertEquals(1, modelo.revision["p0-Ana"]?.pendientes)
        assertNull(modelo.error)
    }

    @Test
    fun unFalloDeLaListaSoloSeMuestraSiNuncaCargo() = runBlocking {
        val servidor = servidor()
        servidor.fijar(
            "GET /api/entities",
            Respuesta.Http(500, """{"ok":false,"error":"Internal server error"}"""),
            Respuesta.Http(200, lista("Ana")),
            Respuesta.SinRed,
        )
        val api = servidor.api()
        val modelo = PacientesModelo()

        modelo.cargar(api)
        assertEquals("Internal server error", modelo.error)
        assertFalse(modelo.cargado)

        modelo.cargar(api)
        modelo.cargar(api)   // sin red en un refresco: la lista se queda
        assertNull(modelo.error)
        assertEquals(listOf("Ana"), modelo.filas.map { it.nombre })
    }

    @Test
    fun filtraPorEstadoYCuentaCadaUno() = runBlocking {
        val servidor = servidor()
        servidor.fijar("GET /api/entities", Respuesta.Http(200, lista("Ana", "Beto", "Caro")))
        servidor.fijar(
            "GET /api/patient-assignments",
            Respuesta.Http(
                200,
                """{"ok":true,"assignments":{"p0-Ana":{"estado":"derivada"},"p1-Beto":{"estado":"derivada"},"p2-Caro":{"estado":"cerrado"}}}""",
            ),
        )
        val modelo = PacientesModelo()
        modelo.cargar(servidor.api())

        assertEquals(EstadoFicha.Derivada, modelo.estado("p1-Beto"))
        assertEquals(listOf("p0-Ana", "p1-Beto"), modelo.filtradas("", EstadoFicha.Derivada).map { it.id })
        assertEquals(listOf("p1-Beto"), modelo.filtradas("beto", EstadoFicha.Derivada).map { it.id })
        assertTrue(modelo.filtradas("ana", EstadoFicha.Cerrada).isEmpty())
        assertEquals(3, modelo.filtradas("", null).size)
        assertEquals(
            mapOf(EstadoFicha.Derivada to 2, EstadoFicha.Cerrada to 1),
            modelo.conteoPorEstado(),
        )
    }

    /** PAPER §35: de alta desde antes de hoy no sale, salvo buscándolo o en el filtro «Alta». */
    @Test
    fun deAltaDesdeAyerNoSaleSalvoBuscandoloOEnElFiltro() = runBlocking {
        val servidor = servidor()
        servidor.fijar("GET /api/entities", Respuesta.Http(200, lista("Ana", "Beto", "Caro")))
        servidor.fijar(
            "GET /api/patient-assignments",
            Respuesta.Http(
                200,
                """{"ok":true,"assignments":{"p0-Ana":{"estado":"alta","alta_at":"2026-11-08"},
                   "p1-Beto":{"estado":"alta","alta_at":"2026-11-09"},"p2-Caro":{"estado":"en_curso","alta_at":null}}}""",
            ),
        )
        val modelo = PacientesModelo()
        modelo.cargar(servidor.api())
        val hoy = "2026-11-09"

        assertEquals(EstadoFicha.Alta, modelo.estado("p0-Ana"))
        // Alta de ayer: oculta. Alta de hoy: todavía se ve.
        assertEquals(listOf("p2-Caro", "p1-Beto"), modelo.filtradas("", null, hoy).map { it.id })
        // Buscándola por nombre sí sale.
        assertEquals(listOf("p0-Ana"), modelo.filtradas("ana", null, hoy).map { it.id })
        // En el filtro «Alta» salen las dos.
        assertEquals(listOf("p0-Ana", "p1-Beto"), modelo.filtradas("", EstadoFicha.Alta, hoy).map { it.id })
        // Al día siguiente, la de hoy también se oculta.
        assertEquals(listOf("p2-Caro"), modelo.filtradas("", null, "2026-11-10").map { it.id })
    }

    /** PAPER §39: alcance «Mis pacientes» / «Todos», combinado con el estado. */
    @Test
    fun misPacientesYTodos() = runBlocking {
        val servidor = servidor()
        servidor.fijar("GET /api/entities", Respuesta.Http(200, lista("Ana", "Beto", "Caro")))
        servidor.fijar(
            "GET /api/patient-assignments",
            Respuesta.Http(
                200,
                """{"ok":true,"assignments":{"p0-Ana":{"estado":"derivada"},"p1-Beto":{"estado":"derivada"},
                   "p2-Caro":{"estado":"cerrado"}},"mine":["p1-Beto","p2-Caro","otro-de-otra-org"]}""",
            ),
        )
        val modelo = PacientesModelo()
        modelo.cargar(servidor.api())
        val mine = PatientScope.Mine

        assertEquals(setOf("p1-Beto", "p2-Caro", "otro-de-otra-org"), modelo.mine)
        // Solo cuenta los míos que están en la lista.
        assertEquals(mapOf(PatientScope.Mine to 2, PatientScope.All to 3), modelo.scopeCounts())
        assertEquals(listOf("p1-Beto", "p2-Caro"), modelo.filtradas("", null, scope = mine).map { it.id })
        // Los dos filtros se combinan.
        assertEquals(listOf("p1-Beto"), modelo.filtradas("", EstadoFicha.Derivada, scope = mine).map { it.id })
        assertEquals(listOf("p0-Ana", "p1-Beto"), modelo.filtradas("", EstadoFicha.Derivada, scope = PatientScope.All).map { it.id })
        // Las cuentas de estado, dentro del alcance.
        assertEquals(mapOf(EstadoFicha.Derivada to 1, EstadoFicha.Cerrada to 1), modelo.conteoPorEstado(mine))
        assertEquals(mapOf(EstadoFicha.Derivada to 2, EstadoFicha.Cerrada to 1), modelo.conteoPorEstado(PatientScope.All))
        // Buscando, el alcance no cuenta: Ana no es mía pero se encuentra.
        assertEquals(listOf("p0-Ana"), modelo.filtradas("ana", null, scope = mine).map { it.id })
    }

    /** Un backend sin `mine`: «Mis pacientes · 0» y la lista vacía; «Todos» sigue igual. */
    @Test
    fun sinMineNingunoEsMio() = runBlocking {
        val servidor = servidor()
        servidor.fijar("GET /api/entities", Respuesta.Http(200, lista("Ana", "Beto")))
        val modelo = PacientesModelo()
        modelo.cargar(servidor.api())

        assertTrue(modelo.mine.isEmpty())
        assertEquals(mapOf(PatientScope.Mine to 0, PatientScope.All to 2), modelo.scopeCounts())
        assertTrue(modelo.filtradas("", null, scope = PatientScope.Mine).isEmpty())
        assertTrue(modelo.conteoPorEstado(PatientScope.Mine).isEmpty())
        assertEquals(2, modelo.filtradas("", null, scope = PatientScope.All).size)
        assertEquals(listOf("p1-Beto"), modelo.filtradas("beto", null, scope = PatientScope.Mine).map { it.id })
    }

    /** Las funciones puras, sin servidor. */
    @Test
    fun filtroPuroPorAlcance() {
        val filas = PacientesModelo.preparar(
            listOf(
                ec.cepi.telemedicina.api.jsonCepi.decodeFromString<ec.cepi.telemedicina.api.Registro>("""{"id":"a","data":{"nombre":"Ana"}}"""),
                ec.cepi.telemedicina.api.jsonCepi.decodeFromString<ec.cepi.telemedicina.api.Registro>("""{"id":"b","data":{"nombre":"Beto"}}"""),
            ),
            emptyMap(),
        )
        val mine = setOf("b")
        assertEquals(
            listOf("b"),
            PacientesModelo.filter(filas, emptyMap(), mine, "", null, PatientScope.Mine, "2026-11-19").map { it.id },
        )
        assertEquals(
            listOf("a"),
            PacientesModelo.filter(filas, emptyMap(), mine, "an", null, PatientScope.Mine, "2026-11-19").map { it.id },
        )
        assertEquals(
            mapOf(EstadoFicha.SinConsulta to 1),
            PacientesModelo.countByState(filas, emptyMap(), mine, PatientScope.Mine),
        )
        assertEquals(mapOf(PatientScope.Mine to 1, PatientScope.All to 2), PacientesModelo.countByScope(filas, mine))
    }
}
