package ec.cepi.telemedicina.api

/**
 * Error de una llamada al backend. `status == 0` es falta de red y `-1` una respuesta que no
 * se pudo leer: la UI distingue "no hay conexión" de "el servidor dijo que no" sin parsear
 * mensajes.
 */
class ApiError(val status: Int, val mensaje: String) : Exception(mensaje) {
    val sinRed: Boolean get() = status == 0
}
