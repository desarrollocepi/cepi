package ec.cepi.telemedicina.galeria

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.ImagenGaleria
import kotlinx.coroutines.delay

/**
 * Las imágenes clínicas que se ven en una rejilla: la galería de la organización o las de un
 * paciente (PAPER §24.2.1). Pide de a páginas y espera un momento antes de buscar, para no
 * mandar una consulta por tecla. Espejo de `GaleriaModelo.swift`.
 */
class GaleriaModelo(
    private val api: CepiApi,
    /** Solo las de este paciente; `null` = todas las de la organización activa. */
    val paciente: String? = null,
) {
    var imagenes: List<ImagenGaleria> by mutableStateOf(emptyList())
        private set
    var total: Int? by mutableStateOf(null)
        private set
    var cargando: Boolean by mutableStateOf(false)
        private set
    var cargado: Boolean by mutableStateOf(false)
        private set
    var error: String? by mutableStateOf(null)
        private set
    /** Texto que se está mostrando; cambia solo cuando la búsqueda ya se aplicó. */
    var busqueda: String by mutableStateOf("")
        private set

    private var pedido = 0

    val hayMas: Boolean get() = total?.let { imagenes.size < it } ?: false

    /**
     * Llamado desde un `LaunchedEffect(texto)`: espera un momento (la tecla siguiente cancela la
     * corrutina) y recarga desde cero.
     */
    suspend fun buscar(texto: String, esperaMs: Long = 350) {
        val limpio = texto.trim()
        if (limpio != busqueda && (limpio.isNotEmpty() || cargado)) delay(esperaMs)
        busqueda = limpio
        cargar(desde = 0)
    }

    suspend fun siguientePagina() {
        if (!hayMas || cargando) return
        cargar(desde = imagenes.size)
    }

    suspend fun recargar() = cargar(desde = 0)

    private suspend fun cargar(desde: Int) {
        val mio = ++pedido
        cargando = true
        try {
            val pagina = api.galeria(busqueda, paciente, POR_PAGINA, desde)
            if (mio != pedido) return   // llegó otra búsqueda más nueva
            imagenes = if (desde == 0) pagina.data else imagenes + pagina.data
            total = pagina.total
            error = null
            cargado = true
        } catch (e: ApiError) {
            if (mio != pedido) return
            // Un fallo al pedir "más" no borra lo que ya se está viendo.
            if (desde == 0) imagenes = emptyList()
            error = e.mensaje
        } finally {
            if (mio == pedido) cargando = false
        }
    }

    private companion object {
        const val POR_PAGINA = 60
    }
}
