package ec.cepi.telemedicina

import ec.cepi.telemedicina.api.ApiClient
import ec.cepi.telemedicina.api.Asignaciones
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.ColaRevision
import ec.cepi.telemedicina.api.Confirmacion
import ec.cepi.telemedicina.api.Lista
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.SesionRespuesta
import ec.cepi.telemedicina.api.jsonCepi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Las formas JSON que devuelve el backend hoy (PAPER §24.4): los mismos cuerpos que
 * `ContratoTests.swift`. Si el backend cambia una clave, fallan las dos suites y no la mano de
 * un médico.
 */
class ContratoTest {
    private inline fun <reified T> decodificar(json: String): T = jsonCepi.decodeFromString(json)

    @Test
    fun sesionDeMe() {
        val respuesta = decodificar<SesionRespuesta>(
            """
            {"ok":true,"token":"abc","user":{"id":"u1","name":"Dra. Pérez","email":"p@cepi.ec",
             "role":"medico_primario","phone":"","cedula":"","permissions":["entity:x:record:create"],
             "org_id":"o2","orgs":[{"id":"o1","slug":"cepi","name":"CEPI","role_in_org":"member"},
             {"id":"o2","slug":"cepi-testing","name":"CEPI Testing","role_in_org":"member"}]}}
            """,
        )
        assertEquals("abc", respuesta.token)
        assertEquals("o2", respuesta.user.orgActiva)
        assertEquals(listOf("CEPI", "CEPI Testing"), respuesta.user.orgs.map { it.name })
        assertEquals(listOf("entity:x:record:create"), respuesta.user.permissions)
    }

    @Test
    fun loginSinOrganizaciones() {
        val respuesta = decodificar<SesionRespuesta>(
            """{"ok":true,"token":"t","user":{"id":"u","name":"X","email":"x@cepi.ec","role":"pendiente","permissions":[]}}""",
        )
        assertTrue(respuesta.user.orgs.isEmpty())
        assertNull(respuesta.user.orgActiva)
        assertEquals("pendiente", respuesta.user.role)
    }

    /** `DELETE /api/auth/me {"confirm":true}`. Los rechazos los prueba `SesionTest`. */
    @Test
    fun borradoDeCuenta() {
        assertTrue(decodificar<Confirmacion>("""{"ok":true}""").ok)
    }

    @Test
    fun registroConCamposDinamicos() {
        val lista = decodificar<Lista<Registro>>(
            """
            {"ok":true,"data":[{"id":"p1","title":"Ana Ruiz","entity_id":"11000000-0000-0000-0000-000000000000",
              "data":{"nombre":"Ana","apellidos":" Ruiz ","cedula":1712345678,"alergias":null,
                      "fumador":true,"peso":61.5,"regiones":["torax"],"vacio":""}}]}
            """,
        )
        val paciente = lista.data.single()
        assertEquals(CepiApi.DEFINICION_PACIENTE, paciente.definicion)
        assertEquals("Ana", paciente["nombre"])
        assertEquals("Ruiz", paciente["apellidos"])
        assertEquals("1712345678", paciente["cedula"])
        assertEquals("61.5", paciente["peso"])
        assertEquals("sí", paciente["fumador"])
        assertNull(paciente["alergias"])
        assertNull(paciente["vacio"])
        assertNull(paciente["regiones"])
        assertEquals(JsonArray(listOf(JsonPrimitive("torax"))), paciente.data["regiones"])
    }

    @Test
    fun registroSinData() {
        val registro = decodificar<Registro>("""{"id":"r1","title":null}""")
        assertTrue(registro.data.isEmpty())
        assertNull(registro.title)
    }

    @Test
    fun colaDeRevisionYAsignaciones() {
        val cola = decodificar<ColaRevision>(
            """{"ok":true,"patient_ids":["p1"],"by_patient":{"p1":{"pending":2,"earliest_due":"2026-09-15T10:00:00.000Z"}}}""",
        )
        assertEquals(2, cola.porPaciente["p1"]?.pendientes)

        val asignaciones = decodificar<Asignaciones>(
            """{"ok":true,"assignments":{"p1":{"assignee_id":"u9","assignee_name":"Dr. Mora","source":"derivado_grupo","estado":"derivada"}}}""",
        )
        assertEquals("Dr. Mora", asignaciones.porPaciente["p1"]?.nombre)
        assertEquals("derivado_grupo", asignaciones.porPaciente["p1"]?.origen)
    }

    @Test
    fun urlCodificaElMas() {
        val url = ApiClient.url(
            "https://telemedicina.cepi.ec".toHttpUrl(),
            "/api/entities",
            listOf("q" to "a+b ñ", "filter[patient_id]" to "p1", "vacio" to null),
        )
        assertTrue(url.toString().startsWith("https://telemedicina.cepi.ec/api/entities?"))
        assertTrue(url.encodedQuery!!, url.encodedQuery!!.contains("q=a%2Bb%20%C3%B1"))
        assertEquals("a+b ñ", url.queryParameter("q"))
        assertEquals("p1", url.queryParameter("filter[patient_id]"))
        assertNull(url.queryParameter("vacio"))
    }
}
