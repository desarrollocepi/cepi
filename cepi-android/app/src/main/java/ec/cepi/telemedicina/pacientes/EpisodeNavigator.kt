package ec.cepi.telemedicina.pacientes

import ec.cepi.telemedicina.api.Registro

/**
 * La barra «Episodio N de M» del paciente (PAPER §28.4.1): debajo de las secciones, la misma en
 * Chat, Ficha, Evolución e Imágenes. El episodio elegido vale para todas. Sin UI, para probarlo.
 *
 * `episodes` va del más nuevo al más viejo, como `CepiApi.episodios`. Un `selected` que no está
 * en la lista (todavía no se recargó) cae en el más nuevo.
 */
data class EpisodeNavigator(
    val episodes: List<Registro>,
    val selected: String?,
    val loading: Boolean = false,
) {
    val index: Int get() = episodes.indexOfFirst { it.id == selected }.coerceAtLeast(0)

    val current: Registro? get() = episodes.getOrNull(index)

    /** El más viejo es el anterior: el siguiente de la lista. */
    val previousId: String? get() = episodes.getOrNull(index + 1)?.id

    val nextId: String? get() = if (index > 0) episodes.getOrNull(index - 1)?.id else null

    val title: String
        get() = when {
            episodes.isEmpty() && loading -> "Buscando episodios…"
            episodes.isEmpty() -> "Sin episodios"
            else -> "Episodio ${episodes.size - index} de ${episodes.size}"
        }

    /** La fecha del episodio (`YYYY-MM-DD`), si la tiene. */
    val date: String? get() = current?.get("fecha")?.take(10)

    /** Cómo se nombra el episodio en otras secciones («episodio 2 de 3 · 2026-11-05»). */
    val label: String?
        get() = current?.let { "episodio ${episodes.size - index} de ${episodes.size}" + (date?.let { d -> " · $d" } ?: "") }

    /** Por qué «‹ Anterior» está deshabilitado; `null` si se puede. Nunca se oculta (CLAUDE.md). */
    fun previousDisabledReason(): String? = common() ?: when {
        episodes.size == 1 -> SINGLE
        previousId == null -> "Es el primer episodio del paciente"
        else -> null
    }

    /** Por qué «Siguiente ›» está deshabilitado; `null` si se puede. */
    fun nextDisabledReason(): String? = common() ?: when {
        episodes.size == 1 -> SINGLE
        nextId == null -> "Es el episodio más reciente"
        else -> null
    }

    /** La línea de abajo del título: lo que explica los botones grises. */
    fun hint(): String? {
        val previous = previousDisabledReason()
        val next = nextDisabledReason()
        return when {
            previous != null && previous == next -> previous
            else -> listOfNotNull(previous, next).joinToString(" · ").ifEmpty { null }
        }
    }

    /** Con el chat ocupado no se bloquea: el cambio queda pendiente (`HiloModelo.cambiarEpisodio`). */
    private fun common(): String? = when {
        episodes.isEmpty() && loading -> "Cargando los episodios…"
        episodes.isEmpty() -> "Este paciente todavía no tiene episodios"
        else -> null
    }

    companion object {
        const val SINGLE = "Único episodio registrado de este paciente"
    }
}
