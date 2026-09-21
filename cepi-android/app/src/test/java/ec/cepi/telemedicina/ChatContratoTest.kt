package ec.cepi.telemedicina

import ec.cepi.telemedicina.api.Adjunto
import ec.cepi.telemedicina.api.ApiClient
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.HiloRespuesta
import ec.cepi.telemedicina.api.RespuestaChat
import ec.cepi.telemedicina.api.RespuestaGaleria
import ec.cepi.telemedicina.api.SesionesBot
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.galeria.pie
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Respuestas reales del bot, del hilo, de adjuntos y de la galería, capturadas del stack local:
 * los mismos cuerpos que `ChatContratoTests.swift` y `GaleriaContratoTests.swift`.
 */
class ChatContratoTest {
    private fun chat(json: String) = RespuestaChat.desde(jsonCepi.decodeFromString<JsonObject>(json))

    @Test
    fun activacionTraeConsultaSinPendiente() {
        val respuesta = chat(
            """
            {"ok":true,"session_id":"465745e9-4100-4b85-b58f-9d0a761626d2","text":"Paciente activo: Valentina Castro Reyes",
             "history":[],"toolCalls":[],"active_patient_id":"11000000-0000-0000-1000-000000000009",
             "active_episode_id":"528a71b8-e7c0-4e0a-b059-f7d4fb672b90","status_header":"👤 Valentina Castro Reyes",
             "form":{"id":"ficha_grp_g_1_4","title":"1.4 Etnia","submit_mode":"structured",
                     "fields":[{"key":"etnia","label":"Etnia","type":"radio","options":["mestiza","blanco"]}]},
             "bookmarks":[{"id":"g_1_1","label":"1.1 Datos de contacto","category":"Filiación","done":true,"conDato":true}]}
            """,
        )
        assertEquals("465745e9-4100-4b85-b58f-9d0a761626d2", respuesta.sessionId)
        assertTrue(respuesta.traeEpisodioActivo)
        assertEquals("528a71b8-e7c0-4e0a-b059-f7d4fb672b90", respuesta.episodioActivo)
        assertFalse(respuesta.traePendiente)
        assertTrue(respuesta.respuestasRapidas.isEmpty())
    }

    @Test
    fun adjuntoPideRespuestaRapida() {
        val respuesta = chat(
            """
            {"ok":true,"session_id":"s1","text":"¿Esta imagen es de la lesión o un formulario de consentimiento?",
             "history":[],"toolCalls":[],"active_patient_id":"p1","active_episode_id":null,
             "quick_replies":[{"label":"🔬 Imagen de lesión","send":"imagen lesion"},
                              {"label":"📄 Consentimiento","send":"imagen consentimiento"}]}
            """,
        )
        assertEquals(listOf("imagen lesion", "imagen consentimiento"), respuesta.respuestasRapidas.map { it.send })
        assertTrue(respuesta.traeEpisodioActivo)
        assertNull(respuesta.episodioActivo)
    }

    @Test
    fun pendienteNuloNoEsPendienteAusente() {
        val nulo = chat("""{"ok":true,"session_id":"s","pending_action":null}""")
        assertTrue(nulo.traePendiente)
        assertNull(nulo.pendiente)
        assertFalse(nulo.traeEpisodioActivo)

        val conConfirmacion = chat(
            """
            {"ok":true,"session_id":"s","pending_action":{"summary":"Crear episodio 'control'","tool":"entities.create",
             "args":{},"successMessage":"Listo","createdAt":"2026-09-14T20:00:00Z"}}
            """,
        )
        assertEquals("Crear episodio 'control'", conConfirmacion.pendiente?.summary)
    }

    @Test
    fun mensajesDelHilo() {
        val hilo = jsonCepi.decodeFromString<HiloRespuesta>(
            """
            {"ok":true,"patient_id":"p","me":{"id":"u4"},"messages":[
             {"session_id":"s","role":"user","content":"escalar a u1 Revisar lesión","author_id":"u4",
              "author_name":"Dra. Derma Dos","self":true,"is_bot":false,"ts":"2026-09-14T20:35:49.014Z",
              "episode_id":"e2","estado":"abierta"},
             {"session_id":"s","role":"assistant","content":"Episodio escalado.","author_id":"bot",
              "author_name":"Asistente","self":false,"is_bot":true,"ts":"2026-09-14T20:35:49.014Z",
              "episode_id":null,"estado":"abierta"}]}
            """,
        )
        assertEquals(2, hilo.mensajes.size)
        assertTrue(hilo.mensajes[0].propio && !hilo.mensajes[0].esBot)
        assertNotNull(hilo.mensajes[0].fecha)
        assertTrue(hilo.mensajes[1].esBot)
        assertNull(hilo.mensajes[1].episodio)
    }

    @Test
    fun sesionesYAdjunto() {
        val sesiones = jsonCepi.decodeFromString<SesionesBot>(
            """
            {"ok":true,"sessions":[{"id":"s1","title":"","created_at":"x","updated_at":"y","estado":"abierta",
             "active_patient_id":"p1","preview":"hola","patient_name":"Ana"}]}
            """,
        )
        assertEquals("p1", sesiones.sesiones.first().pacienteActivo)

        val adjunto = jsonCepi.decodeFromString<Adjunto>(
            """
            {"id":"1f61150b-40c5-4c08-9ea8-2588a271268d","entity_id":null,"field_key":null,"filename":"b9e4.jpg",
             "original_name":"lesion-prueba.jpg","mimetype":"image/jpeg","size":61253,"created_at":"2026-09-14T20:38:01.128Z"}
            """,
        )
        assertEquals("lesion-prueba.jpg", adjunto.nombre)
    }

    @Test
    fun lasRutasDelBotVanAlBot() {
        val cliente = ApiClient(
            base = "http://127.0.0.1:3001".toHttpUrl(),
            baseBot = "http://127.0.0.1:3002".toHttpUrl(),
            credenciales = Credenciales(AlmacenMemoria()),
        )
        assertEquals("http://127.0.0.1:3002/api/bot/chat", cliente.url("/api/bot/chat").toString())
        assertEquals("http://127.0.0.1:3001/api/patient-thread", cliente.url("/api/patient-thread").toString())
    }

    @Test
    fun paginaDeLaGaleria() {
        val respuesta = jsonCepi.decodeFromString<RespuestaGaleria>(
            """
            {"ok":true,"total":138,"data":[
              {"id":"i1","attachment_id":"a1","patient_id":"p1","paciente":"Ana Ruiz","cedula":"1712345678",
               "episode_id":"e1","fecha":"2026-07-05","diagnostico":"Dermatitis atópica",
               "codigo_cie10":"L20.9","body_region":"torax","privada":false}]}
            """,
        )
        assertEquals(138, respuesta.total)
        val imagen = respuesta.data.single()
        assertEquals("a1", imagen.adjunto)
        assertEquals("p1", imagen.pacienteId)
        assertEquals("e1", imagen.episodioId)
        assertEquals("L20.9", imagen.codigoCIE10)
        assertEquals("torax", imagen.region)
        assertEquals("05 jul · L20.9 · Dermatitis atópica", pie(imagen))
    }

    /** Una imagen puede no tener episodio, diagnóstico ni región: se sube antes de llenar nada. */
    @Test
    fun imagenSinDatosDelCaso() {
        val respuesta = jsonCepi.decodeFromString<RespuestaGaleria>(
            """{"ok":true,"data":[{"id":"i2","attachment_id":"a2","patient_id":"p2","paciente":"Bruno Paz"}]}""",
        )
        val imagen = respuesta.data.single()
        assertNull(imagen.episodioId)
        assertNull(imagen.diagnostico)
        assertNull(respuesta.total)
        assertEquals("", pie(imagen))

        val vacia = jsonCepi.decodeFromString<RespuestaGaleria>("""{"ok":true,"data":[],"total":0}""")
        assertTrue(vacia.data.isEmpty())
        assertEquals(0, vacia.total)
    }
}
