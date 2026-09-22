package ec.cepi.telemedicina

import ec.cepi.telemedicina.chat.FotoClinica
import ec.cepi.telemedicina.ficha.DatosFicha
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class FichaTest {
    /** El de `LogicaFichaTests.datosDelVisorComoLaWeb`. */
    @Test
    fun datosDelVisorComoLaWeb() {
        val paciente = mapOf<String, JsonElement>(
            "nombre" to JsonPrimitive("Ana"),
            "apellidos" to JsonPrimitive("Ruiz"),
            "fecha_nac" to JsonPrimitive("2000-06-15"),
        )
        val episodio = mapOf<String, JsonElement>("motivo_consulta" to JsonPrimitive("control"), "picor" to JsonPrimitive("leve"))
        val datos = DatosFicha.combinar(paciente, episodio, hoy = LocalDate.parse("2026-09-16"))
        assertEquals(JsonPrimitive("Ana Ruiz"), datos["nombre"])
        assertEquals(JsonPrimitive(26), datos["edad"])
        assertEquals(JsonPrimitive("control"), datos["motivo_consulta"])

        val anterior = mapOf<String, JsonElement>(
            "picor" to JsonPrimitive("severo"),
            "dolor" to JsonPrimitive(false),
            "fecha" to JsonPrimitive("2026-01-01"),
            "x:rel" to JsonPrimitive("1"),
        )
        // `dolor: false` vale lo mismo que ausente; `fecha` y las relaciones no se comparan.
        assertEquals(
            mapOf("motivo_consulta" to JsonNull, "picor" to JsonPrimitive("severo")),
            DatosFicha.cambios(episodio, anterior),
        )
        assertTrue(DatosFicha.cambios(episodio, null).isEmpty())

        assertEquals("{\"a\":\"x\\u2028y\"}", DatosFicha.javascript(mapOf("a" to JsonPrimitive("x y"))))
    }

    @Test
    fun laEdadGuardadaNoSeRecalcula() {
        val paciente = mapOf<String, JsonElement>("fecha_nac" to JsonPrimitive("2000-06-15"), "edad" to JsonPrimitive(30))
        assertEquals(JsonPrimitive(30), DatosFicha.combinar(paciente, emptyMap(), LocalDate.parse("2026-09-16"))["edad"])
    }

    @Test
    fun laFotoSeAcotaSinAgrandar() {
        assertEquals(4096 to 2458, FotoClinica.medidas(8000, 4800, 4096))
        assertEquals(1600 to 1200, FotoClinica.medidas(1600, 1200, 4096))
        assertEquals(1 to 4096, FotoClinica.medidas(5, 20000, 4096))
        // Android < 9 decodifica por potencias de 2 y nunca el original entero de 50 MP.
        assertEquals(2, FotoClinica.muestreo(8000, 6000, 4096))
        assertEquals(1, FotoClinica.muestreo(4096, 3072, 4096))
        assertEquals(4, FotoClinica.muestreo(12000, 9000, 4096))
    }
}

class DictadoTest {
    @Test
    fun losTramosSePeganAlBorradorConUnEspacio() {
        assertEquals("Paciente con prurito", ec.cepi.telemedicina.chat.Dictado.unir("Paciente ", " con prurito "))
        assertEquals("hola", ec.cepi.telemedicina.chat.Dictado.unir("", "hola"))
        assertEquals("ya escrito", ec.cepi.telemedicina.chat.Dictado.unir("ya escrito", "  "))
    }
}

class IdiomasDictadoTest {
    @Test
    fun primeroElEspanolDelTelefonoYDespuesLasVariantesDeLosMotores() {
        assertEquals(listOf("es-MX", "es-EC", "es-US", "es-ES"), ec.cepi.telemedicina.chat.Dictado.variantes(java.util.Locale.forLanguageTag("es-MX")))
        assertEquals(listOf("es-EC", "es-US", "es-ES"), ec.cepi.telemedicina.chat.Dictado.variantes(java.util.Locale.forLanguageTag("en-US")))
        assertEquals(listOf("es-US", "es-EC", "es-ES"), ec.cepi.telemedicina.chat.Dictado.variantes(java.util.Locale.forLanguageTag("es-US")))
    }
}
