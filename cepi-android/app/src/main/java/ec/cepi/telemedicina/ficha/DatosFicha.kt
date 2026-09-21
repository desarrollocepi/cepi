package ec.cepi.telemedicina.ficha

import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.texto
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.time.LocalDate
import java.time.Period

/**
 * Los datos que el visor le pasa a `ficha.html`, armados como en `onFichaLoad` de
 * IntakeChat.vue y en `DatosFicha.swift`. Sin UI, para poder probarlos.
 */
object DatosFicha {
    /** Campos que no cuentan como "cambió respecto de la consulta anterior". */
    val sinComparar = setOf(
        "id", "fecha", "medico_id", "patient_id", "estado", "tipo", "created_at", "updated_at",
        "ficha_num", "examinador_nombre", "gravedad_total", "location",
    )

    /** Paciente + episodio (el episodio pisa), con el nombre completo y la edad si falta. */
    fun combinar(
        paciente: Map<String, JsonElement>,
        episodio: Map<String, JsonElement>,
        hoy: LocalDate = LocalDate.now(),
    ): Map<String, JsonElement> {
        val datos = (paciente + episodio).toMutableMap()
        val nombre = listOfNotNull(paciente["nombre"]?.texto(), paciente["apellidos"]?.texto())
            .filter { it.isNotEmpty() }
            .joinToString(" ")
        if (nombre.isNotEmpty()) datos["nombre"] = JsonPrimitive(nombre)
        val edad = datos["edad"]
        val sinEdad = edad == null || edad is JsonNull || (edad is JsonPrimitive && edad.isString && edad.content.isEmpty())
        val nacimiento = Fechas.dia(paciente["fecha_nac"]?.texto())
        if (sinEdad && nacimiento != null) {
            val anios = Period.between(nacimiento, hoy).years
            if (anios in 0 until 150) datos["edad"] = JsonPrimitive(anios)
        }
        return datos
    }

    /**
     * Lo que cambió respecto de la consulta anterior, con el valor que tenía (el visor pinta la
     * etiqueta en rojo y muestra "Valor anterior: …").
     */
    fun cambios(actual: Map<String, JsonElement>, anterior: Map<String, JsonElement>?): Map<String, JsonElement> {
        if (anterior == null) return emptyMap()
        return (actual.keys + anterior.keys)
            .filter { it !in sinComparar && ':' !in it }
            .filter { normalizado(actual[it]) != normalizado(anterior[it]) }
            .associateWith { anterior[it] ?: JsonNull }
    }

    /** Como `norm` en la web: nulo, `false` y vacío valen lo mismo. */
    fun normalizado(valor: JsonElement?): String = when {
        valor == null || valor is JsonNull -> ""
        valor is JsonPrimitive && valor.isString -> valor.content
        valor is JsonPrimitive && valor.booleanOrNull != null -> if (valor.booleanOrNull == true) "true" else ""
        valor is JsonPrimitive -> valor.texto().orEmpty()
        else -> valor.toString()
    }

    /**
     * Un objeto JSON listo para pegar en JavaScript, con las claves ordenadas. U+2028/U+2029 son
     * válidos en JSON pero cortan una cadena de JavaScript.
     */
    fun javascript(datos: Map<String, JsonElement>): String =
        JsonObject(datos.toSortedMap()).toString()
            .replace(" ", "\\u2028")
            .replace(" ", "\\u2029")
}
