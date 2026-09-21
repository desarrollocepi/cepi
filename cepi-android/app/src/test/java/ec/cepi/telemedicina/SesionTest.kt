package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.app.Sesion
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * En la web, cualquier fallo de `/me` al recargar o al cambiar de organización pintaba el
 * login con la sesión todavía válida; la gente volvía a entrar con Google hasta agotar el
 * rate-limit. Estos tests fijan que la app no lo repite: solo un 401 cierra la sesión. Son los
 * de `SesionTests.swift`.
 */
class SesionTest {
    private fun me(token: String, org: String = "o1") = Respuesta.Http(
        200,
        """{"ok":true,"token":"$token","user":{"id":"u1","name":"Dra. Pérez","email":"p@cepi.ec",
           "role":"medico_primario","permissions":[],"org_id":"$org",
           "orgs":[{"id":"o1","slug":"cepi","name":"CEPI"},{"id":"o2","slug":"cepi-testing","name":"CEPI Testing"}]}}""",
    )

    /** Una sesión con su propio almacén y su propio servidor falso. */
    private class Prueba(token: String?) {
        val servidor = ServidorFalso()
        val credenciales = Credenciales(AlmacenMemoria(token))
        val sesion = Sesion(credenciales, servidor.api(credenciales))
        fun token() = runBlocking { credenciales.token() }
    }

    @Test
    fun unFalloDelServidorAlAbrirNoMandaAlLogin() = runBlocking {
        for (status in listOf(500, 502, 429)) {
            val prueba = Prueba("vigente")
            prueba.servidor.fijar("GET /api/auth/me", Respuesta.Http(status, """{"ok":false,"error":"Demasiados intentos"}"""))

            prueba.sesion.restaurar()

            assertEquals(listOf("GET /api/auth/me"), prueba.servidor.pedidos)
            assertEquals(Sesion.Estado.SinValidar("Demasiados intentos"), prueba.sesion.estado)
            assertEquals("vigente", prueba.token())
        }
    }

    @Test
    fun sinRedAlAbrirTampocoMandaAlLoginYElMensajeDiceQuePaso() = runBlocking {
        val prueba = Prueba("vigente")
        prueba.servidor.fijar("GET /api/auth/me", Respuesta.SinRed)

        prueba.sesion.restaurar()

        val estado = prueba.sesion.estado
        assertTrue(estado is Sesion.Estado.SinValidar)
        assertTrue((estado as Sesion.Estado.SinValidar).motivo.contains("UnknownHostException"))
        assertEquals("vigente", prueba.token())
    }

    @Test
    fun sinTokenGuardadoVaAlLoginSinPedirNada() = runBlocking {
        val prueba = Prueba(null)

        prueba.sesion.restaurar()

        assertEquals(Sesion.Estado.SinSesion, prueba.sesion.estado)
        assertTrue(prueba.servidor.pedidos.isEmpty())
    }

    @Test
    fun soloUn401CierraLaSesion() = runBlocking {
        val prueba = Prueba("vencido")
        prueba.servidor.fijar("GET /api/auth/me", Respuesta.Http(401, """{"ok":false,"error":"Token inválido"}"""))

        prueba.sesion.restaurar()

        assertEquals(Sesion.Estado.SinSesion, prueba.sesion.estado)
        assertNull(prueba.token())
    }

    @Test
    fun un401DeOtraLlamadaTambienCierraLaSesion() = runBlocking {
        val prueba = Prueba("t0")
        prueba.servidor.fijar("GET /api/auth/me", me(token = "t1"))
        prueba.servidor.fijar("GET /api/review-queue", Respuesta.Http(401, """{"ok":false,"error":"Token inválido"}"""))
        prueba.sesion.restaurar()

        assertThrows(ApiError::class.java) { runBlocking { prueba.sesion.api.colaRevision() } }

        assertEquals(Sesion.Estado.SinSesion, prueba.sesion.estado)
        assertNull(prueba.token())
    }

    @Test
    fun un403NoTocaLaSesion() = runBlocking {
        val prueba = Prueba("t0")
        prueba.servidor.fijar("GET /api/auth/me", me(token = "t1"))
        prueba.servidor.fijar("DELETE /api/entities/p1", Respuesta.Http(403, """{"ok":false,"error":"Sin permiso"}"""))
        prueba.sesion.restaurar()

        val fallo = assertThrows(ApiError::class.java) { runBlocking { prueba.sesion.api.eliminarPaciente("p1") } }

        assertEquals(403, fallo.status)
        assertEquals("Sin permiso", fallo.mensaje)
        assertEquals(Sesion.Estado.Activa, prueba.sesion.estado)
        assertEquals("t1", prueba.token())
    }

    @Test
    fun cuentaPendiente() = runBlocking {
        val prueba = Prueba("t0")
        prueba.servidor.fijar(
            "GET /api/auth/me",
            Respuesta.Http(200, """{"ok":true,"token":"t1","user":{"id":"u","email":"x@cepi.ec","role":"pendiente"}}"""),
        )

        prueba.sesion.restaurar()

        assertEquals(Sesion.Estado.Pendiente, prueba.sesion.estado)
    }

    @Test
    fun entrarNormalizaElEmailYGuardaElTokenRenovado() = runBlocking {
        val prueba = Prueba(null)
        prueba.servidor.fijar("POST /api/auth/login", me(token = "t-login"))
        prueba.servidor.fijar("GET /api/auth/me", me(token = "t-me"))
        prueba.sesion.restaurar()

        prueba.sesion.entrar("  Primario@CEPI.local ", "Admin123!")

        val cuerpo = jsonCepi.decodeFromString<JsonObject>(prueba.servidor.cuerpo("POST /api/auth/login")!!)
        assertEquals("primario@cepi.local", cuerpo["email"]?.jsonPrimitive?.content)
        assertEquals(Sesion.Estado.Activa, prueba.sesion.estado)
        assertEquals("t-me", prueba.token())
    }

    @Test
    fun cambiarDeOrganizacionNoPasaPorElLogin() = runBlocking {
        val prueba = Prueba("t0")
        prueba.servidor.fijar("GET /api/auth/me", me(token = "t1"), me(token = "t3", org = "o2"))
        prueba.servidor.fijar("POST /api/orgs/switch", Respuesta.Http(200, """{"ok":true,"token":"t2"}"""))
        prueba.sesion.restaurar()

        prueba.sesion.cambiarOrganizacion("o2")

        assertEquals(Sesion.Estado.Activa, prueba.sesion.estado)
        assertEquals("o2", prueba.sesion.usuario?.orgActiva)
        assertEquals("t3", prueba.token())
        assertTrue(prueba.servidor.pedidos.none { "/api/auth/login" in it || "/api/auth/google" in it })
    }

    @Test
    fun siFallaLaRenovacionTrasCambiarDeOrgSeSigueTrabajando() = runBlocking {
        val prueba = Prueba("t0")
        prueba.servidor.fijar("GET /api/auth/me", me(token = "t1"), Respuesta.Http(500, """{"ok":false,"error":"Internal server error"}"""))
        prueba.servidor.fijar("POST /api/orgs/switch", Respuesta.Http(200, """{"ok":true,"token":"t2"}"""))
        prueba.sesion.restaurar()

        prueba.sesion.cambiarOrganizacion("o2")

        assertEquals(Sesion.Estado.Activa, prueba.sesion.estado)
        assertEquals("t2", prueba.token())
    }

    @Test
    fun eliminarLaCuentaMandaLaConfirmacionYCierraLaSesion() = runBlocking {
        val prueba = Prueba("t0")
        prueba.servidor.fijar("GET /api/auth/me", me(token = "t1"))
        prueba.servidor.fijar("DELETE /api/auth/me", Respuesta.Http(200, """{"ok":true}"""))
        prueba.sesion.restaurar()

        prueba.sesion.eliminarCuenta()

        assertEquals("DELETE /api/auth/me", prueba.servidor.pedidos.last())
        assertEquals("""{"confirm":true}""", prueba.servidor.cuerpo("DELETE /api/auth/me"))
        assertEquals(Sesion.Estado.SinSesion, prueba.sesion.estado)
        assertNull(prueba.sesion.usuario)
        assertNull(prueba.token())
    }

    /** Cuerpos reales del backend: si no se borró, la sesión sigue y el motivo llega tal cual. */
    @Test
    fun siNoSeBorraLaSesionSigueAbierta() = runBlocking {
        val casos = listOf(
            409 to "Es la única cuenta de administrador activa. Asigne otro administrador antes de eliminarla.",
            400 to """Falta la confirmación: enviar { \"confirm\": true }.""",
            500 to "Internal server error",
        )
        for ((status, motivo) in casos) {
            val prueba = Prueba("t0")
            prueba.servidor.fijar("GET /api/auth/me", me(token = "t1"))
            prueba.servidor.fijar("DELETE /api/auth/me", Respuesta.Http(status, """{"ok":false,"error":"$motivo"}"""))
            prueba.sesion.restaurar()

            val fallo = assertThrows(ApiError::class.java) { runBlocking { prueba.sesion.eliminarCuenta() } }

            assertEquals(status, fallo.status)
            assertEquals(motivo.replace("\\\"", "\""), fallo.mensaje)
            assertEquals(Sesion.Estado.Activa, prueba.sesion.estado)
            assertEquals("t1", prueba.token())
        }
    }

    @Test
    fun sinRedTampocoSeCierraLaSesionAlEliminar() = runBlocking {
        val prueba = Prueba("t0")
        prueba.servidor.fijar("GET /api/auth/me", me(token = "t1"))
        prueba.servidor.fijar("DELETE /api/auth/me", Respuesta.SinRed)
        prueba.sesion.restaurar()

        val fallo = assertThrows(ApiError::class.java) { runBlocking { prueba.sesion.eliminarCuenta() } }

        assertTrue(fallo.sinRed)
        assertEquals(Sesion.Estado.Activa, prueba.sesion.estado)
        assertEquals("t1", prueba.token())
    }

    /** El 401 de una llamada que salió antes de un login nuevo no tira la sesión recién abierta. */
    @Test
    fun un401ConUnTokenViejoNoCierraLaSesionNueva() = runBlocking {
        val credenciales = Credenciales(AlmacenMemoria("nuevo"))
        var expiro = false
        credenciales.alExpirar = { expiro = true }
        assertEquals("nuevo", credenciales.token())

        credenciales.expirar(tokenRechazado = "viejo")

        assertEquals("nuevo", credenciales.token())
        assertFalse(expiro)
    }
}
