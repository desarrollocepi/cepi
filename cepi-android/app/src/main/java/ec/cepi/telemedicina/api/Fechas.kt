package ec.cepi.telemedicina.api

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object Fechas {
    /** ISO 8601 como la manda el backend: con milisegundos (node-pg) o sin ellos. */
    fun iso(texto: String?): Instant? {
        if (texto.isNullOrBlank()) return null
        return runCatching { Instant.parse(texto) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(texto).toInstant() }.getOrNull()
    }

    /** Un día `YYYY-MM-DD` (lo que manda `<input type="date">`). */
    fun dia(texto: String?): LocalDate? =
        texto?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

    private val diaCorto = DateTimeFormatter.ofPattern("dd MMM", Locale.forLanguageTag("es"))

    /** "05 jul", como `.day(.twoDigits).month(.abbreviated)` en iOS (Java agrega un punto). */
    fun textoCorto(dia: LocalDate): String = diaCorto.format(dia).replace(".", "")

    fun textoCorto(instante: Instant): String = textoCorto(instante.atZone(ZoneId.systemDefault()).toLocalDate())
}
