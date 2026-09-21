package ec.cepi.telemedicina.api

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** El JSON del backend: claves de más se ignoran y un `null` donde hay valor por defecto toma el defecto. */
val jsonCepi = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
}

/**
 * Cliente del backend. Espejo de `call()` en `cepi-frontend/src/api.js` y de `APIClient.swift`:
 * Bearer si hay sesión, `{ok, error}` en los fallos.
 *
 * Nada corre en el hilo principal: OkHttp espera la red en sus hilos y el JSON se decodifica en
 * `Dispatchers.Default`. OkHttp ya reintenta sobre una conexión reusada que el servidor cerró
 * por inactividad (`retryOnConnectionFailure`), lo que en iOS hubo que hacer a mano.
 */
class ApiClient(
    val base: HttpUrl,
    /** A dónde van las rutas `/api/bot/…` (cepi-bot). En producción es el mismo host. */
    val baseBot: HttpUrl = base,
    private val credenciales: Credenciales,
    http: OkHttpClient = OkHttpClient(),
) {
    // Un turno del bot espera al LLM: los 10 s por defecto se quedan cortos.
    private val http = http.newBuilder()
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    suspend inline fun <reified T> get(ruta: String, vararg query: Pair<String, String?>): T =
        decodificar(serializer(), ejecutar("GET", ruta, query.toList()))

    suspend inline fun <reified T> post(ruta: String, cuerpo: JsonElement): T =
        decodificar(serializer(), ejecutar("POST", ruta, cuerpo = cuerpo.comoCuerpo()))

    /** DELETE con cuerpo JSON: el borrado de cuenta viaja con su confirmación explícita. */
    suspend inline fun <reified T> delete(ruta: String, cuerpo: JsonElement? = null): T =
        decodificar(serializer(), ejecutar("DELETE", ruta, cuerpo = cuerpo?.comoCuerpo()))

    /** La URL final de una ruta: las de cepi-bot van a su host. */
    fun url(ruta: String, query: List<Pair<String, String?>> = emptyList()): HttpUrl =
        url(if (ruta.startsWith("/api/bot")) baseBot else base, ruta, query)

    @PublishedApi
    internal suspend fun ejecutar(
        metodo: String,
        ruta: String,
        query: List<Pair<String, String?>> = emptyList(),
        cuerpo: RequestBody? = null,
    ): ByteArray {
        val token = credenciales.token()
        val pedido = Request.Builder()
            .url(url(ruta, query))
            .method(metodo, cuerpo)
            .header("Accept", "application/json")
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .build()

        val (status, datos) = try {
            http.newCall(pedido).esperar()
        } catch (e: IOException) {
            // El tipo de la excepción queda en el mensaje y en el log: "sin conexión" cubre
            // desde un teléfono sin red hasta un TLS roto, y sin el tipo no se distinguen.
            val tipo = e.javaClass.simpleName
            Log.e("red", "$metodo $ruta falló en la red: $tipo")
            throw ApiError(0, "Sin conexión con el servidor ($tipo).")
        }

        if (status !in 200..299) {
            // 401 = token vencido o inválido (authMiddleware.ts). Un 403 es falta de permiso
            // y no toca la sesión.
            if (status == 401 && token != null) credenciales.expirar(token)
            val mensaje = runCatching {
                jsonCepi.decodeFromString(CuerpoError.serializer(), datos.decodeToString()).error
            }.getOrNull()
            throw ApiError(status, mensaje ?: "Error del servidor (HTTP $status).")
        }
        return datos
    }

    @PublishedApi
    internal suspend fun <T> decodificar(serializador: KSerializer<T>, datos: ByteArray): T =
        withContext(Dispatchers.Default) {
            try {
                jsonCepi.decodeFromString(serializador, datos.decodeToString())
            } catch (_: IllegalArgumentException) {
                // SerializationException es una IllegalArgumentException.
                throw ApiError(-1, "Respuesta inesperada del servidor.")
            }
        }

    companion object {
        private val TIPO_JSON = "application/json; charset=utf-8".toMediaType()

        @PublishedApi
        internal fun JsonElement.comoCuerpo(): RequestBody = toString().toRequestBody(TIPO_JSON)

        /**
         * Arma la URL. `addQueryParameter` codifica el `+` como `%2B`: Express lee un `+`
         * literal como espacio, y buscar "a+b" buscaría "a b".
         */
        fun url(base: HttpUrl, ruta: String, query: List<Pair<String, String?>>): HttpUrl =
            base.newBuilder()
                .addPathSegments(ruta.removePrefix("/"))
                .apply { query.forEach { (clave, valor) -> if (valor != null) addQueryParameter(clave, valor) } }
                .build()
    }
}

@Serializable
private class CuerpoError(val error: String? = null)

/** Espera la respuesta sin bloquear un hilo; cancelar la corrutina cancela el pedido. */
private suspend fun Call.esperar(): Pair<Int, ByteArray> = suspendCancellableCoroutine { continuacion ->
    continuacion.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            continuacion.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            try {
                val leido = response.use { it.code to it.body.bytes() }
                continuacion.resume(leido)
            } catch (e: IOException) {
                continuacion.resumeWithException(e)
            }
        }
    })
}
