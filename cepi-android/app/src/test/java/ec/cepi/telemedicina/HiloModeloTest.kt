package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.chat.HiloModelo
import ec.cepi.telemedicina.galeria.GaleriaModelo
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** El hilo y la galería contra el servidor falso: lo que el médico ve y lo que viaja al backend. */
class HiloModeloTest {
    private val activacion = Respuesta.Http(
        200,
        """{"ok":true,"session_id":"s1","text":"Paciente activo: Ana","active_episode_id":"e1"}""",
    )
    private val hilo = Respuesta.Http(
        200,
        """{"ok":true,"messages":[{"role":"assistant","content":"Paciente activo: Ana","self":false,"is_bot":true,
            "author_id":"bot","episode_id":"e1"}]}""",
    )

    private fun servidor() = ServidorFalso().apply {
        fijar("GET /api/bot/sessions", Respuesta.Http(200, """{"ok":true,"sessions":[]}"""))
        fijar("POST /api/bot/chat", activacion)
        fijar("GET /api/patient-thread", hilo)
    }

    private fun ServidorFalso.api() = api(Credenciales(AlmacenMemoria("t")))

    private fun cuerpo(servidor: ServidorFalso, clave: String) =
        jsonCepi.decodeFromString<JsonObject>(servidor.cuerpo(clave)!!)

    @Test
    fun abrirDosVecesActivaUnaSola() = runBlocking {
        val servidor = servidor()
        val modelo = HiloModelo("p1", servidor.api(), this)

        listOf(async { modelo.abrir() }, async { modelo.abrir() }).awaitAll()

        assertEquals(1, servidor.pedidos.count { it == "POST /api/bot/chat" })
        assertEquals("activar paciente p1", cuerpo(servidor, "POST /api/bot/chat")["message"]?.jsonPrimitive?.content)
        assertEquals("e1", modelo.episodioActivo)
        assertTrue(modelo.cargado)
        assertFalse(modelo.ocupado)
    }

    @Test
    fun laSesionAbiertaPropiaSeReanuda() = runBlocking {
        val servidor = servidor()
        servidor.fijar(
            "GET /api/bot/sessions",
            Respuesta.Http(200, """{"ok":true,"sessions":[{"id":"vieja","active_patient_id":"p1","estado":"abierta"}]}"""),
        )
        val modelo = HiloModelo("p1", servidor.api(), this)

        modelo.abrir()

        assertEquals("vieja", cuerpo(servidor, "POST /api/bot/chat")["session_id"]?.jsonPrimitive?.content)
    }

    @Test
    fun laFotoViajaComoMarcadorDeAdjunto() = runBlocking {
        val servidor = servidor()
        servidor.fijar(
            "POST /api/attachments",
            Respuesta.Http(200, """{"id":"1f61150b-40c5-4c08-9ea8-2588a271268d","original_name":"lesion.jpg"}"""),
        )
        val modelo = HiloModelo("p1", servidor.api(), this)
        modelo.abrir()

        modelo.subir(byteArrayOf(0xFF.toByte(), 0xD8.toByte()), "lesion.jpg")
        assertTrue(modelo.enviar("  Foto de la lesión "))

        val multipart = servidor.cuerpo("POST /api/attachments")!!
        assertTrue(multipart.contains("""name="file"; filename="lesion.jpg""""))
        assertTrue(multipart.contains("Content-Type: image/jpeg"))
        val turno = cuerpo(servidor, "POST /api/bot/chat")
        assertEquals(
            "Foto de la lesión\n[adjunto: lesion.jpg · 1f61150b-40c5-4c08-9ea8-2588a271268d]",
            turno["message"]?.jsonPrimitive?.content,
        )
        assertEquals("s1", turno["session_id"]?.jsonPrimitive?.content)
        assertNull(modelo.adjunto)
    }

    @Test
    fun siElTurnoFallaElEcoNoQuedaYElErrorSeVe() = runBlocking {
        val servidor = servidor()
        val modelo = HiloModelo("p1", servidor.api(), this)
        modelo.abrir()
        servidor.fijar("POST /api/bot/chat", Respuesta.Http(502, """{"ok":false,"error":"El asistente no respondió"}"""))

        assertFalse(modelo.enviar("hola"))

        assertEquals("El asistente no respondió", modelo.error)
        assertEquals(listOf("Paciente activo: Ana"), modelo.mensajes.map { it.contenido })
        assertFalse(modelo.ocupado)
    }

    @Test
    fun guardarLaFichaEsUnEnvioEstructurado() = runBlocking {
        val servidor = servidor()
        val modelo = HiloModelo("p1", servidor.api(), this)
        modelo.abrir()

        modelo.enviarFormulario("ficha_save", buildJsonObject { put("picor", "leve") }, episodio = "e1")

        val envio = cuerpo(servidor, "POST /api/bot/chat")
        assertEquals("", envio["message"]?.jsonPrimitive?.content)
        val formulario = envio["form_submission"]!!.jsonObject
        assertEquals("ficha_save", formulario["form_id"]?.jsonPrimitive?.content)
        assertEquals("e1", formulario["episode_id"]?.jsonPrimitive?.content)
        assertEquals("leve", formulario["data"]!!.jsonObject["picor"]?.jsonPrimitive?.content)
    }

    private val conFormulario = Respuesta.Http(
        200,
        """{"ok":true,"session_id":"s1","active_episode_id":"e1",
            "form":{"id":"ficha_grp_g_1_4","title":"1.4 Etnia","submit_mode":"structured",
                    "fields":[{"key":"etnia","label":"Etnia","type":"radio","options":["mestiza"]}]},
            "bookmarks":[{"id":"g_1_1","label":"1.1","category":"Filiación","done":true},
                         {"id":"g_1_4","label":"1.4 Etnia","category":"Filiación","done":false}]}""",
    )

    /** Con el auto-form apagado (por defecto) el grupo que propone el bot no se abre solo. */
    @Test
    fun sinAutoFormElFormularioNoSeAbreSolo() = runBlocking {
        val servidor = servidor()
        servidor.fijar("POST /api/bot/chat", conFormulario)
        val modelo = HiloModelo("p1", servidor.api(), this)

        modelo.abrir()

        assertNull(modelo.formulario)
        assertEquals(2, modelo.marcadores.size)
    }

    @Test
    fun loPedidoEnSeccionesSeAbreSiempre() = runBlocking {
        val servidor = servidor()
        servidor.fijar("POST /api/bot/chat", conFormulario)
        val modelo = HiloModelo("p1", servidor.api(), this)
        modelo.abrir()

        modelo.abrirSeccion(modelo.marcadores[1])

        assertEquals("ficha_grp_g_1_4", modelo.formulario?.id)
        val envio = cuerpo(servidor, "POST /api/bot/chat")["form_submission"]!!.jsonObject
        assertEquals("ficha_goto", envio["form_id"]?.jsonPrimitive?.content)
        assertEquals("g_1_4", envio["data"]!!.jsonObject["group"]?.jsonPrimitive?.content)
    }

    @Test
    fun encenderElAutoFormAbreLaPrimeraPendienteYSeGuarda() = runBlocking {
        val servidor = servidor()
        servidor.fijar("POST /api/bot/chat", conFormulario)
        val guardado = mutableListOf<Boolean>()
        val modelo = HiloModelo("p1", servidor.api(), this) { guardado += it }
        modelo.abrir()

        modelo.alternarAutoFormulario()

        assertTrue(modelo.autoFormulario)
        assertEquals(listOf(true), guardado)
        assertEquals("ficha_grp_g_1_4", modelo.formulario?.id)
        // La primera sin completar es la 1.4, no la 1.1 ya hecha.
        assertEquals("g_1_4", cuerpo(servidor, "POST /api/bot/chat")["form_submission"]!!.jsonObject["data"]!!.jsonObject["group"]?.jsonPrimitive?.content)
    }

    @Test
    fun conAutoFormEncendidoElGrupoSeAbreAlActivar() = runBlocking {
        val servidor = servidor()
        servidor.fijar("POST /api/bot/chat", conFormulario)
        val modelo = HiloModelo("p1", servidor.api(), this, autoFormularioInicial = true)

        modelo.abrir()

        assertEquals("ficha_grp_g_1_4", modelo.formulario?.id)
    }

    @Test
    fun elResponsableDelCasoOQuienLoCreo() = runBlocking {
        val servidor = servidor()
        val modelo = HiloModelo("p1", servidor.api(), this)
        modelo.abrir()
        servidor.fijar(
            "GET /api/entities/e1",
            Respuesta.Http(200, """{"ok":true,"data":{"id":"e1","data":{"medico_id":"u-creador"}}}"""),
            Respuesta.Http(200, """{"ok":true,"data":{"id":"e1","data":{"medico_id":"u-creador","responsable_actual_id":"u-resp"}}}"""),
        )

        assertEquals("u-creador", modelo.responsableDelCaso())
        assertEquals("u-resp", modelo.responsableDelCaso())
    }

    @Test
    fun laGaleriaPaginaYDescartaUnaBusquedaVieja() = runBlocking {
        val servidor = ServidorFalso()
        fun pagina(vararg ids: String, total: Int) = Respuesta.Http(
            200,
            ids.joinToString(",", prefix = """{"ok":true,"total":$total,"data":[""", postfix = "]}") {
                """{"id":"$it","attachment_id":"a-$it"}"""
            },
        )
        servidor.fijar(
            "GET /api/bot/galeria",
            pagina("vieja", total = 1).copy(demoraMs = 800),
            pagina("i1", "i2", total = 3),
            pagina("i3", total = 3),
        )
        val modelo = GaleriaModelo(servidor.api())

        val vieja = async { modelo.buscar("", esperaMs = 0) }
        delay(100)
        modelo.buscar("ana", esperaMs = 0)
        vieja.await()
        assertEquals(listOf("i1", "i2"), modelo.imagenes.map { it.id })
        assertTrue(modelo.hayMas)

        modelo.siguientePagina()
        assertEquals(listOf("i1", "i2", "i3"), modelo.imagenes.map { it.id })
        assertFalse(modelo.hayMas)
        assertEquals("ana", modelo.busqueda)
    }
}
