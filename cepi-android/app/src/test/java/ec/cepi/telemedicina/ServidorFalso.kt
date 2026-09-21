package ec.cepi.telemedicina

import ec.cepi.telemedicina.api.Almacen
import ec.cepi.telemedicina.api.ApiClient
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Credenciales
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.net.UnknownHostException

/**
 * Respuestas en cola por "MÉTODO /ruta"; la última se repite. Es un interceptor de OkHttp que
 * nunca sale a la red, igual que `ServidorFalso` sobre `URLProtocol` en iOS.
 */
class ServidorFalso : Interceptor {
    sealed interface Respuesta {
        /** `demoraMs` > 0 responde igual, pero después de esperar. */
        data class Http(val status: Int, val cuerpo: String, val demoraMs: Long = 0) : Respuesta
        data object SinRed : Respuesta
    }

    private val colas = mutableMapOf<String, ArrayDeque<Respuesta>>()
    private val registro = mutableListOf<String>()
    private val cuerpos = mutableMapOf<String, String>()

    val pedidos: List<String> get() = synchronized(this) { registro.toList() }

    /** El cuerpo del último pedido a esa clave, si llevaba. */
    fun cuerpo(clave: String): String? = synchronized(this) { cuerpos[clave] }

    fun fijar(clave: String, vararg respuestas: Respuesta) = synchronized(this) {
        colas[clave] = ArrayDeque(respuestas.toList())
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val pedido = chain.request()
        val clave = "${pedido.method} ${pedido.url.encodedPath}"
        val cuerpo = pedido.body?.let { Buffer().also(it::writeTo).readUtf8() }
        val respuesta = synchronized(this) {
            registro += clave
            if (cuerpo != null) cuerpos[clave] = cuerpo
            val cola = colas[clave]
            when {
                cola.isNullOrEmpty() -> Respuesta.Http(404, """{"ok":false,"error":"sin respuesta fijada"}""")
                cola.size > 1 -> cola.removeFirst()
                else -> cola.first()
            }
        }
        return when (respuesta) {
            Respuesta.SinRed -> throw UnknownHostException("sin red")
            is Respuesta.Http -> {
                if (respuesta.demoraMs > 0) Thread.sleep(respuesta.demoraMs)
                Response.Builder()
                    .request(pedido)
                    .protocol(Protocol.HTTP_1_1)
                    .code(respuesta.status)
                    .message("prueba")
                    .body(respuesta.cuerpo.toResponseBody("application/json".toMediaType()))
                    .build()
            }
        }
    }

    fun api(credenciales: Credenciales): CepiApi {
        val http = OkHttpClient.Builder().addInterceptor(this).build()
        return CepiApi(ApiClient("https://prueba.local".toHttpUrl(), credenciales = credenciales, http = http))
    }
}

class AlmacenMemoria(private var valor: String? = null) : Almacen {
    override fun leer(): String? = valor
    override fun guardar(valor: String?) {
        this.valor = valor
    }
}
