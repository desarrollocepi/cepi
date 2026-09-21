package ec.cepi.telemedicina.chat

import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.MensajeHilo

/** Qué página del hilo se mira: la consulta más nueva o una en particular. */
sealed interface PaginaHilo {
    data object MasNueva : PaginaHilo

    /** `null` porque los turnos viejos sin episodio también forman una página. */
    data class Consulta(val id: String?) : PaginaHilo
}

/** El hilo partido por consultas, como en IntakeChat.vue: un episodio por página. */
class Episodios(mensajes: List<MensajeHilo>, activo: String?) {
    /**
     * Episodios distintos en orden de aparición. El activo va al final aunque todavía no tenga
     * mensajes: una consulta recién abierta también es una página.
     */
    val orden: List<String?>

    init {
        val distintos = LinkedHashSet<String?>()
        mensajes.forEach { distintos += it.episodio }
        if (activo != null && activo !in distintos) distintos += activo
        orden = distintos.toList()
    }

    fun indice(pagina: PaginaHilo): Int {
        if (pagina is PaginaHilo.Consulta) {
            val indice = orden.indexOf(pagina.id)
            if (indice >= 0) return indice
        }
        return (orden.size - 1).coerceAtLeast(0)
    }

    /**
     * Los mensajes de una página. El aviso "Paciente activo: …" lo repite el bot en cada
     * activación; se deja solo el último para que no se acumule.
     */
    fun visibles(mensajes: List<MensajeHilo>, indice: Int): List<MensajeHilo> {
        val lista = if (orden.size <= 1) mensajes else mensajes.filter { it.episodio == orden[indice] }
        val ultimo = lista.indexOfLast(::esAvisoDeActivacion)
        if (ultimo < 0) return lista
        return lista.filterIndexed { i, mensaje -> i == ultimo || !esAvisoDeActivacion(mensaje) }
    }

    /** Solo en la consulta activa se escribe; las anteriores son de lectura. */
    fun esActiva(indice: Int, activo: String?): Boolean {
        if (orden.size <= 1) return true
        return orden[indice] == (activo ?: orden.last())
    }

    fun etiqueta(indice: Int, mensajes: List<MensajeHilo>): String {
        // Con una sola consulta, decirlo explica por qué las flechas no llevan a ningún lado.
        if (orden.size == 1) return "Única consulta"
        if (orden.isEmpty()) return "Sin consultas todavía"
        val fecha = mensajes.firstOrNull { it.episodio == orden[indice] }?.fecha
        val cuando = fecha?.let { " · ${Fechas.textoCorto(it)}" }.orEmpty()
        return "Consulta ${indice + 1}/${orden.size}$cuando"
    }

    companion object {
        /**
         * El autor sobre un mensaje ajeno, una vez por racha del mismo autor (como un grupo de
         * WhatsApp). `null` = no se muestra.
         */
        fun autor(lista: List<MensajeHilo>, indice: Int): String? {
            val mensaje = lista[indice]
            if (mensaje.propio) return null
            if (indice > 0) {
                val previo = lista[indice - 1]
                if (!previo.propio && previo.autorId == mensaje.autorId) return null
            }
            return if (mensaje.esBot) "Asistente" else mensaje.autorNombre ?: "Profesional"
        }

        fun esAvisoDeActivacion(mensaje: MensajeHilo): Boolean =
            mensaje.esBot && mensaje.contenido.trimStart().startsWith("Paciente activo:")
    }
}
