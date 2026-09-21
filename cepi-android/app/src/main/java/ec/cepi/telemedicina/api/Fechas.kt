package ec.cepi.telemedicina.api

import java.time.Instant
import java.time.OffsetDateTime

object Fechas {
    /** ISO 8601 como la manda el backend: con milisegundos (node-pg) o sin ellos. */
    fun iso(texto: String?): Instant? {
        if (texto.isNullOrBlank()) return null
        return runCatching { Instant.parse(texto) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(texto).toInstant() }.getOrNull()
    }
}
