package ec.cepi.telemedicina.ficha

import android.annotation.SuppressLint
import android.content.Context
import android.print.PrintManager
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.jsonCepi
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl
import kotlin.coroutines.resume

/**
 * El WebView de `ficha.html`: cargar, avisar cuando terminó y hablar con su API (`fillFicha`,
 * `markChanges`, `readFicha`). Solo navega dentro del host de la web: un enlace a otro sitio no
 * se abre adentro de la app con la ficha del paciente a la vista.
 */
@SuppressLint("SetJavaScriptEnabled")
private class ControladorFicha(contexto: Context, private val web: HttpUrl, alTerminar: () -> Unit) {
    val vista = WebView(contexto).apply {
        settings.javaScriptEnabled = true
        // La hoja mide 210 mm y no declara viewport: se diagrama ancha y se muestra entera,
        // como en Safari, con zoom para leer de cerca.
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) = alTerminar()

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != web.host
        }
    }

    fun cargar() = vista.loadUrl(web.newBuilder().addPathSegment("ficha.html").build().toString())

    /** Evalúa JavaScript y devuelve el resultado si es texto. */
    suspend fun texto(codigo: String): String? = suspendCancellableCoroutine { continuacion ->
        vista.evaluateJavascript(codigo) { resultado ->
            // El resultado llega como JSON: un texto viene entre comillas y escapado.
            val texto = runCatching { jsonCepi.decodeFromString<String>(resultado) }.getOrNull()
            continuacion.resume(texto)
        }
    }

    suspend fun ejecutar(codigo: String) {
        texto("$codigo; ''")
    }

    suspend fun leerFicha(): JsonObject? =
        texto("JSON.stringify(window.readFicha ? window.readFicha() : {})")
            ?.let { runCatching { jsonCepi.decodeFromString<JsonObject>(it) }.getOrNull() }

    fun imprimir(contexto: Context, titulo: String) {
        contexto.getSystemService(PrintManager::class.java)
            ?.print(titulo, vista.createPrintDocumentAdapter(titulo), null)
    }
}

/**
 * La ficha clínica como documento: la hoja imprimible de la web, editable, paginada por
 * consulta y con lo que cambió respecto de la anterior en rojo (PAPER §24.2.1). La hoja se pide
 * al servidor, no se empaqueta: una sola copia del documento.
 *
 * `mostrada` pasa a `true` la primera vez que se ve la sección: antes no se carga nada.
 * `visible` es si está a la vista ahora: el WebView fuera de la vista se oculta, porque dentro
 * del pager se dibujaba encima del chat aunque su página estuviera corrida.
 */
@Composable
fun VisorFicha(
    pacienteId: String,
    nombre: String,
    episodioActivo: String?,
    api: CepiApi,
    web: HttpUrl,
    mostrada: Boolean,
    visible: Boolean,
    alGuardar: suspend (JsonObject, String?) -> Boolean,
) {
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    var episodios by remember { mutableStateOf(emptyList<Registro>()) }
    var paciente by remember { mutableStateOf(emptyMap<String, JsonElement>()) }
    var indice by remember { mutableIntStateOf(0) }
    var cargando by remember { mutableStateOf(true) }
    var guardando by remember { mutableStateOf(false) }
    var aviso by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var paginasListas by remember { mutableIntStateOf(0) }
    val controlador = remember { ControladorFicha(contexto, web) { paginasListas++ } }
    DisposableEffect(Unit) { onDispose { controlador.vista.destroy() } }

    // Cada consulta en una página limpia, como la web que vuelve a montar el iframe.
    fun recargarPagina() {
        cargando = true
        controlador.cargar()
    }

    suspend fun cargar() = coroutineScope {
        error = null
        val lista = async { api.episodios(pacienteId) }
        val registro = async {
            try {
                api.entidad(pacienteId).data
            } catch (_: ApiError) {
                emptyMap()
            }
        }
        episodios = try {
            lista.await()
        } catch (e: ApiError) {
            error = "No se pudieron cargar las consultas: ${e.mensaje}"
            emptyList()
        }
        paciente = registro.await()
        indice = episodios.indexOfFirst { it.id == episodioActivo }.coerceAtLeast(0)
        recargarPagina()
    }

    LaunchedEffect(mostrada, episodioActivo) {
        if (mostrada) cargar()
    }
    LaunchedEffect(paginasListas) {
        if (paginasListas == 0) return@LaunchedEffect
        val episodio = episodios.getOrNull(indice)?.data.orEmpty()
        val anterior = episodios.getOrNull(indice + 1)?.data
        val datos = DatosFicha.combinar(paciente, episodio)
        val cambios = DatosFicha.cambios(episodio, anterior)
        controlador.ejecutar("window.fillFicha && window.fillFicha(${DatosFicha.javascript(datos)})")
        controlador.ejecutar("window.markChanges && window.markChanges(${DatosFicha.javascript(cambios)})")
        cargando = false
    }

    Column(Modifier.fillMaxSize()) {
        Surface(tonalElevation = 2.dp) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp),
            ) {
                // Las consultas van de la más nueva a la más vieja: "anterior" es la siguiente.
                IconButton(
                    onClick = {
                        indice++
                        recargarPagina()
                    },
                    enabled = !cargando && indice < episodios.size - 1,
                ) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Consulta anterior")
                }
                Text(
                    etiqueta(episodios, indice, cargando),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        indice--
                        recargarPagina()
                    },
                    enabled = !cargando && indice > 0,
                ) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Consulta siguiente")
                }
            }
        }

        Box(Modifier.weight(1f)) {
            AndroidView(
                factory = {
                    (controlador.vista.parent as? ViewGroup)?.removeView(controlador.vista)
                    controlador.vista
                },
                update = { it.visibility = if (visible) View.VISIBLE else View.INVISIBLE },
                modifier = Modifier.fillMaxSize(),
            )
            if (cargando) CircularProgressIndicator(Modifier.align(Alignment.Center))
        }

        (error ?: aviso)?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }

        // Guardar e imprimir donde se ven siempre, sin robarle la barra al paciente.
        Surface(tonalElevation = 3.dp) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                TextButton(onClick = { controlador.imprimir(contexto, "Ficha — $nombre") }, enabled = !cargando) {
                    Icon(painterResource(R.drawable.ic_imprimir), contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(6.dp))
                    Text("Imprimir")
                }
                Spacer(Modifier.weight(1f))
                Button(
                    onClick = {
                        alcance.launch {
                            val datos = controlador.leerFicha()
                            if (datos == null) {
                                error = "No se pudo leer la ficha."
                                return@launch
                            }
                            guardando = true
                            aviso = null
                            try {
                                if (alGuardar(datos, episodios.getOrNull(indice)?.id)) {
                                    aviso = "Ficha guardada."
                                    cargar()
                                } else {
                                    error = "No se pudo guardar la ficha."
                                }
                            } finally {
                                guardando = false
                            }
                        }
                    },
                    enabled = !cargando && !guardando && episodios.isNotEmpty(),
                ) {
                    if (guardando) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Guardar")
                }
            }
        }
    }
}

private fun etiqueta(episodios: List<Registro>, indice: Int, cargando: Boolean): String {
    val episodio = episodios.getOrNull(indice) ?: return if (cargando) "" else "Sin consultas registradas"
    val fecha = episodio["fecha"] ?: "s/f"
    if (episodios.size == 1) return "$fecha · única consulta registrada"
    return "$fecha · episodio ${episodios.size - indice} de ${episodios.size}"
}
