package ec.cepi.telemedicina

import ec.cepi.telemedicina.api.ImagenGaleria
import ec.cepi.telemedicina.api.MensajeHilo
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.chat.Episodios
import ec.cepi.telemedicina.chat.PaginaHilo
import ec.cepi.telemedicina.ficha.COMMAND_RESPONSIBLE
import ec.cepi.telemedicina.ficha.referralCommand
import ec.cepi.telemedicina.galeria.EpisodeImageFilter
import ec.cepi.telemedicina.pacientes.EpisodeNavigator
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * El navegador de episodios a nivel paciente (PAPER §28.4.1), el filtro de Imágenes por episodio
 * y «Al responsable de turno» de Derivar (§32.2.1).
 */
class EpisodeNavigatorTest {
    private fun ep(id: String, fecha: String) = Registro(id = id, data = mapOf("fecha" to JsonPrimitive(fecha)))

    /** Del más nuevo al más viejo, como `CepiApi.episodios`. */
    private val tres = listOf(ep("e3", "2026-11-05T10:00:00Z"), ep("e2", "2026-09-10"), ep("e1", "2026-05-02"))

    @Test
    fun episodioDeEnMedio() {
        val nav = EpisodeNavigator(tres, "e2")
        assertEquals("Episodio 2 de 3", nav.title)
        assertEquals("2026-09-10", nav.date)
        assertEquals("episodio 2 de 3 · 2026-09-10", nav.label)
        assertEquals("e1", nav.previousId)
        assertEquals("e3", nav.nextId)
        assertNull(nav.previousDisabledReason())
        assertNull(nav.nextDisabledReason())
        assertNull(nav.hint())
    }

    @Test
    fun extremosDeshabilitadosConElMotivo() {
        val nuevo = EpisodeNavigator(tres, "e3")
        assertEquals("Episodio 3 de 3", nuevo.title)
        assertEquals("2026-11-05", nuevo.date)
        assertNull(nuevo.nextId)
        assertEquals("Es el episodio más reciente", nuevo.nextDisabledReason())
        assertNull(nuevo.previousDisabledReason())
        assertEquals("Es el episodio más reciente", nuevo.hint())
        val viejo = EpisodeNavigator(tres, "e1")
        assertEquals("Episodio 1 de 3", viejo.title)
        assertNull(viejo.previousId)
        assertEquals("Es el primer episodio del paciente", viejo.previousDisabledReason())
        // Uno que no está en la lista (todavía no se releyó): el más nuevo.
        assertEquals("e3", EpisodeNavigator(tres, "zz").current?.id)
        assertEquals("e3", EpisodeNavigator(tres, null).current?.id)
    }

    @Test
    fun unSoloEpisodioONinguno() {
        val uno = EpisodeNavigator(tres.take(1), "e3")
        assertEquals("Episodio 1 de 1", uno.title)
        assertEquals(EpisodeNavigator.SINGLE, uno.previousDisabledReason())
        assertEquals(EpisodeNavigator.SINGLE, uno.nextDisabledReason())
        assertEquals(EpisodeNavigator.SINGLE, uno.hint())
        val cargando = EpisodeNavigator(emptyList(), null, loading = true)
        assertEquals("Buscando episodios…", cargando.title)
        assertEquals("Cargando los episodios…", cargando.hint())
        val ninguno = EpisodeNavigator(emptyList(), null)
        assertEquals("Sin episodios", ninguno.title)
        assertEquals("Este paciente todavía no tiene episodios", ninguno.previousDisabledReason())
        assertNull(ninguno.label)
    }

    @Test
    fun imagenesDelEpisodioConAccesoATodas() {
        val fotos = listOf(
            ImagenGaleria(id = "i1", adjunto = "a1", episodioId = "e3"),
            ImagenGaleria(id = "i2", adjunto = "a2", episodioId = "e2"),
            ImagenGaleria(id = "i3", adjunto = "a3", episodioId = null),
            ImagenGaleria(id = "i4", adjunto = "a4", episodioId = "e3"),
        )
        assertEquals(listOf("i1", "i4"), EpisodeImageFilter.visible(fotos, "e3", showAll = false).map { it.id })
        assertEquals(4, EpisodeImageFilter.visible(fotos, "e3", showAll = true).size)
        assertEquals(4, EpisodeImageFilter.visible(fotos, null, showAll = false).size)
        assertEquals(emptyList<ImagenGaleria>(), EpisodeImageFilter.visible(fotos, "e1", showAll = false))
        assertEquals(2, EpisodeImageFilter.hidden(fotos, "e3"))
        assertEquals(0, EpisodeImageFilter.hidden(fotos, null))
    }

    @Test
    fun elChatMiraUnEpisodioSinMensajes() {
        val mensajes = listOf(MensajeHilo.eco("hola", "e3"))
        val episodios = Episodios(mensajes, "e3")
        assertTrue(episodios.sinMensajes(PaginaHilo.Consulta("e2")))
        assertFalse(episodios.sinMensajes(PaginaHilo.Consulta("e3")))
        assertFalse(episodios.sinMensajes(PaginaHilo.MasNueva))
        assertFalse(episodios.sinMensajes(PaginaHilo.Consulta(null)))
    }

    @Test
    fun derivarAlResponsableDeTurno() {
        assertEquals("derivar a responsable", referralCommand(COMMAND_RESPONSIBLE, "  "))
        assertEquals("derivar a responsable lesión que creció", referralCommand(COMMAND_RESPONSIBLE, " lesión que creció "))
    }
}
