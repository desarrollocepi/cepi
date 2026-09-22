package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.Lista
import ec.cepi.telemedicina.api.Recordatorio
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.app.Sesion
import ec.cepi.telemedicina.notificaciones.BandejaModelo
import ec.cepi.telemedicina.notificaciones.FuenteToken
import ec.cepi.telemedicina.notificaciones.RegistroPush
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** La bandeja y el push (PAPER §25.6) contra el servidor falso. */
class AvisosTest {
    /** Un aviso real de derivación, capturado del stack local. */
    private val aviso = """
        {"id":"5ff1988c-1df3-429e-b593-b2b0a01041e3","entity_id":"12000000-0000-0000-2000-000000000012",
         "owner_user_id":"00000007-0000-0000-0000-000000000003","created_by":"00000007-0000-0000-0000-000000000001",
         "title":"Revisión solicitada: SEED_episode_012","message":"Valorar dermatitis extensa",
         "due_at":"2026-09-22T23:25:30.333Z","recurrence":null,"condition":null,
         "channels":["in_app","email","web_push","native_push"],"status":"pending","result":null,"attempts":0,
         "created_at":"2026-09-21T23:25:30.334Z","updated_at":"2026-09-21T23:25:30.334Z","created_by_name":"Dr. Primario Demo"}
    """

    private class TokenFijo(private val valor: String?) : FuenteToken {
        override suspend fun token() = valor
    }

    @Test
    fun avisoDeDerivacion() {
        val lista = jsonCepi.decodeFromString<Lista<Recordatorio>>("""{"ok":true,"data":[$aviso]}""")
        val r = lista.data.single()
        assertEquals("12000000-0000-0000-2000-000000000012", r.entidad)
        assertEquals("Dr. Primario Demo", r.quienDerivo)
        assertEquals("Valorar dermatitis extensa", r.mensaje)
        assertTrue(r.activo)
        assertEquals("pendiente", r.etiquetaEstado)
        assertFalse(r.copy(estado = "done").activo)
    }

    @Test
    fun laBandejaCuentaLoPendienteYMarcaVisto() = runBlocking {
        val servidor = ServidorFalso()
        val viejo = aviso.replace("5ff1988c", "11111111").replace("2026-09-21T23:25:30.334Z", "2026-07-01T00:00:00.000Z")
            .replace("\"status\":\"pending\"", "\"status\":\"done\"")
        servidor.fijar("GET /api/reminders", Respuesta.Http(200, """{"ok":true,"data":[$viejo,$aviso]}"""))
        servidor.fijar("POST /api/reminders/5ff1988c-1df3-429e-b593-b2b0a01041e3/complete", Respuesta.Http(200, """{"ok":true}"""))
        servidor.fijar(
            "GET /api/review-queue/patient/12000000-0000-0000-2000-000000000012",
            Respuesta.Http(200, """{"ok":true,"patient_id":"11000000-0000-0000-1000-000000000012","patient_name":"Andrés Herrera Calvo"}"""),
        )
        val modelo = BandejaModelo(servidor.api(Credenciales(AlmacenMemoria("t"))))

        modelo.cargar("u3")
        assertEquals(listOf("5ff1988c-1df3-429e-b593-b2b0a01041e3", "11111111-1df3-429e-b593-b2b0a01041e3"), modelo.avisos.map { it.id })
        assertEquals(1, modelo.pendientes)

        assertEquals("11000000-0000-0000-1000-000000000012", modelo.paciente(modelo.avisos.first()))
        modelo.marcarVisto(modelo.avisos.first())
        assertEquals(0, modelo.pendientes)
        assertTrue(modelo.ocupados.isEmpty())
    }

    @Test
    fun elTokenSeRegistraComoAndroidYSeBorraElMismo() = runBlocking {
        val servidor = ServidorFalso()
        servidor.fijar("POST /api/push/device-token", Respuesta.Http(201, """{"ok":true,"data":{"id":"d1"}}"""))
        servidor.fijar("DELETE /api/push/device-token", Respuesta.Http(200, """{"ok":true}"""))
        val registro = RegistroPush(servidor.api(Credenciales(AlmacenMemoria("t"))), TokenFijo("fcm-123"))

        registro.registrar()
        registro.olvidar()

        val alta = jsonCepi.decodeFromString<JsonObject>(servidor.cuerpo("POST /api/push/device-token")!!)
        assertEquals("android", alta["platform"]?.jsonPrimitive?.content)
        assertEquals("fcm-123", alta["token"]?.jsonPrimitive?.content)
        assertEquals("fcm-123", jsonCepi.decodeFromString<JsonObject>(servidor.cuerpo("DELETE /api/push/device-token")!!)["token"]?.jsonPrimitive?.content)
    }

    @Test
    fun sinPushNoSePideNada() = runBlocking {
        val servidor = ServidorFalso()
        val registro = RegistroPush(servidor.api(Credenciales(AlmacenMemoria("t"))), TokenFijo(null))

        registro.registrar()
        registro.olvidar()

        assertTrue(servidor.pedidos.isEmpty())
    }

    /** Si el token se borrara después de soltar la sesión, el DELETE saldría sin Bearer. */
    @Test
    fun alSalirElTokenDePushSeBorraConLaSesionTodaviaAbierta() = runBlocking {
        val servidor = ServidorFalso()
        servidor.fijar(
            "GET /api/auth/me",
            Respuesta.Http(200, """{"ok":true,"token":"t1","user":{"id":"u1","email":"p@cepi.ec","role":"medico_primario"}}"""),
        )
        val credenciales = Credenciales(AlmacenMemoria("t0"))
        var tokenAlBorrar: String? = "sin llamar"
        val sesion = Sesion(credenciales, servidor.api(credenciales), antesDeSalir = { tokenAlBorrar = credenciales.token() })
        sesion.restaurar()

        sesion.salir()

        assertEquals("t1", tokenAlBorrar)
        assertNull(credenciales.token())
        assertEquals(Sesion.Estado.SinSesion, sesion.estado)
    }
}
