package ec.cepi.telemedicina

import ec.cepi.telemedicina.api.MensajeHilo
import ec.cepi.telemedicina.chat.Episodios
import ec.cepi.telemedicina.chat.PaginaHilo
import ec.cepi.telemedicina.chat.Segmento
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los de `EpisodiosTests.swift` y `SegmentosTests.swift`. */
class EpisodiosTest {
    private fun mensaje(contenido: String, episodio: String?, propio: Boolean = false, bot: Boolean = true, autor: String = "bot") =
        MensajeHilo(
            rol = if (propio) "user" else "assistant",
            contenido = contenido,
            propio = propio,
            esBot = bot,
            autorId = autor,
            ts = "2026-09-14T20:35:49.014Z",
            episodio = episodio,
        )

    @Test
    fun unaSolaConsulta() {
        val mensajes = listOf(
            mensaje("Paciente activo: Ana", "e1"),
            mensaje("hola", "e1", propio = true, bot = false, autor = "u1"),
        )
        val episodios = Episodios(mensajes, "e1")
        assertEquals(listOf("e1"), episodios.orden)
        assertEquals("Única consulta", episodios.etiqueta(0, mensajes))
        assertEquals(2, episodios.visibles(mensajes, 0).size)
        assertTrue(episodios.esActiva(0, "e1"))
    }

    @Test
    fun variasConsultasYLaActivaVaAlFinal() {
        val mensajes = listOf(
            mensaje("Paciente activo: Ana", "e1"),
            mensaje("control", "e1", propio = true, bot = false, autor = "u1"),
            mensaje("Paciente activo: Ana", "e2"),
        )
        // e3 es una consulta recién abierta, todavía sin mensajes.
        val episodios = Episodios(mensajes, "e3")
        assertEquals(listOf("e1", "e2", "e3"), episodios.orden)
        assertEquals(2, episodios.indice(PaginaHilo.MasNueva))
        assertEquals(0, episodios.indice(PaginaHilo.Consulta("e1")))
        assertEquals(2, episodios.indice(PaginaHilo.Consulta("no-existe")))
        assertEquals(listOf("Paciente activo: Ana", "control"), episodios.visibles(mensajes, 0).map { it.contenido })
        assertTrue(episodios.visibles(mensajes, 2).isEmpty())
        assertFalse(episodios.esActiva(0, "e3"))
        assertTrue(episodios.esActiva(2, "e3"))
        assertTrue(episodios.etiqueta(0, mensajes).startsWith("Consulta 1/3 · "))
    }

    @Test
    fun elAvisoDeActivacionSeMuestraUnaVez() {
        val mensajes = listOf(
            mensaje("Paciente activo: Ana\n📋 Faltan 24", "e1"),
            mensaje("hola", "e1", propio = true, bot = false, autor = "u1"),
            mensaje("  Paciente activo: Ana\n📋 Faltan 23", "e1"),
        )
        val visibles = Episodios(mensajes, "e1").visibles(mensajes, 0)
        assertEquals(listOf("hola", "  Paciente activo: Ana\n📋 Faltan 23"), visibles.map { it.contenido })
    }

    @Test
    fun elAutorSeMuestraUnaVezPorRacha() {
        val lista = listOf(
            mensaje("a", null, bot = false, autor = "u2"),
            mensaje("b", null, bot = false, autor = "u2"),
            mensaje("c", null),
            mensaje("d", null, propio = true, bot = false, autor = "u1"),
            mensaje("e", null),
        )
        assertEquals(
            listOf("Profesional", null, "Asistente", null, "Asistente"),
            lista.indices.map { Episodios.autor(lista, it) },
        )
    }

    @Test
    fun textoSinMarcadores() {
        assertEquals(listOf(Segmento.Texto("hola\nmundo")), Segmento.dividir("hola\nmundo"))
    }

    @Test
    fun adjuntoDelComposer() {
        val id = "1F61150B-40C5-4C08-9EA8-2588A271268D"
        assertEquals(
            listOf(Segmento.Texto("Foto de la lesión"), Segmento.Imagen(id.lowercase(), "lesion-prueba.jpg")),
            Segmento.dividir("Foto de la lesión\n[adjunto: lesion-prueba.jpg · $id]"),
        )
    }

    @Test
    fun imagenesDelBotEntreTexto() {
        val primera = "11111111-1111-1111-1111-111111111111"
        val segunda = "22222222-2222-2222-2222-222222222222"
        assertEquals(
            listOf(
                Segmento.Texto("Resultados:"),
                Segmento.Imagen(primera, null),
                Segmento.Texto("Melanoma 12%"),
                Segmento.Imagen(segunda, null),
            ),
            Segmento.dividir("Resultados:\n[img:$primera]\nMelanoma 12%\n[img:$segunda]\n"),
        )
    }
}
