package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.pacientes.PacientesModelo
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
}
