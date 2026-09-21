package ec.cepi.telemedicina.chat

/** Un trozo de un mensaje del hilo: texto o una imagen (id de adjunto). */
sealed interface Segmento {
    data class Texto(val texto: String) : Segmento
    data class Imagen(val id: String, val nombre: String?) : Segmento

    companion object {
        private val marcador =
            Regex("""\[img:([0-9a-fA-F-]{36})\]|\[adjunto:\s*([^·\]]+?)\s*·\s*([0-9a-fA-F-]{36})\s*\]""")

        /**
         * Espejo de `MessageContent.vue`. Dos marcadores se pintan como imagen: `[img:<uuid>]`,
         * que emite el bot, y `[adjunto: <nombre> · <uuid>]`, que emite quien sube una foto.
         */
        fun dividir(contenido: String): List<Segmento> {
            val segmentos = mutableListOf<Segmento>()
            var cursor = 0
            for (coincidencia in marcador.findAll(contenido)) {
                val antes = recortado(contenido.substring(cursor, coincidencia.range.first))
                if (antes.isNotEmpty()) segmentos += Texto(antes)
                val (img, nombre, adjunto) = coincidencia.destructured
                segmentos += if (img.isNotEmpty()) {
                    Imagen(img.lowercase(), null)
                } else {
                    Imagen(adjunto.lowercase(), nombre.trim())
                }
                cursor = coincidencia.range.last + 1
            }
            val resto = recortado(contenido.substring(cursor))
            if (resto.isNotEmpty()) segmentos += Texto(resto)
            return segmentos.ifEmpty { listOf(Texto(contenido)) }
        }

        /** Sin saltos de línea al principio ni espacios al final: alrededor de una imagen dejarían renglones vacíos. */
        private fun recortado(texto: String): String = texto.trimStart('\n', '\r').trimEnd()
    }
}
