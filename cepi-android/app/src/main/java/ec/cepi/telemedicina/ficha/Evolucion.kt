package ec.cepi.telemedicina.ficha

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.print.PrintManager
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
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
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.FilaEvolucion
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate

/**
 * Lo que se le pasa a `fillEvolucion`, como en `VisorEvolucion.vue` de la web y en
 * `DatosEvolucion` de iOS. Sin UI, para poder probarlo.
 */
object DatosEvolucion {
    fun objeto(
        paciente: Map<String, JsonElement>,
        filas: List<FilaEvolucion>,
        actual: String?,
        hoy: LocalDate = LocalDate.now(),
        /** Observaciones editables desde el documento (solo la sección Evolución). */
        editable: Boolean = false,
    ): Map<String, JsonElement> {
        val combinado = DatosFicha.combinar(paciente, emptyMap(), hoy)
        val texto = { valor: String? -> valor?.let(::JsonPrimitive) ?: JsonNull }
        return mapOf(
            "paciente" to JsonObject(mapOf(
                "nombre" to (combinado["nombre"] ?: JsonPrimitive("")),
                "cedula" to (paciente["cedula"] ?: JsonPrimitive("")),
                "edad" to (combinado["edad"] ?: JsonNull),
            )),
            "filas" to JsonArray(filas.map { fila ->
                JsonObject(mapOf(
                    "episode_id" to JsonPrimitive(fila.episodio),
                    "fecha" to texto(fila.fecha),
                    "medico" to texto(fila.medico),
                    "especialista" to texto(fila.especialista),
                    "diagnostico" to texto(fila.diagnostico),
                    "diagnostico_histopatologico" to texto(fila.diagnosticoHistopatologico),
                    "tratamiento" to texto(fila.tratamiento),
                    "observaciones" to texto(fila.observaciones),
                ))
            }),
            "actual" to texto(actual),
        ) + (if (editable) mapOf("editable" to JsonPrimitive(true)) else emptyMap())
    }

    /** Una cadena de JavaScript con el texto escapado. */
    fun cadena(texto: String): String = DatosFicha.javascript(mapOf("m" to JsonPrimitive(texto))) + ".m"
}

/**
 * El WebView de `evolucion.html`. Tocar una fila llama a `window.onAbrirFicha(id)`, que acá va
 * al puente `CepiEvolucion`. Solo navega dentro del host de la web, como el de la ficha.
 */
@SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
private class ControladorEvolucion(
    contexto: Context,
    web: okhttp3.HttpUrl,
    alTerminar: () -> Unit,
    alElegir: (String) -> Unit,
    /**
     * Guardar las observaciones de una ficha (id, texto, y con qué responderle al documento);
     * `null` las deja de solo lectura.
     */
    onSaveObservations: ((String, String, (String) -> Unit) -> Unit)? = null,
) {
    private val principal = Handler(Looper.getMainLooper())
    val vista = WebView(contexto).apply {
        settings.javaScriptEnabled = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        addJavascriptInterface(object {
            @JavascriptInterface
            fun abrirFicha(id: String) = principal.post { alElegir(id) }

            @JavascriptInterface
            fun guardarObservaciones(id: String, texto: String) = principal.post { onSaveObservations?.invoke(id, texto, this@ControladorEvolucion::ejecutar) }
        }, "CepiEvolucion")
        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript("window.onAbrirFicha = function (id) { CepiEvolucion.abrirFicha(String(id)); }; ''", null)
                if (onSaveObservations != null) {
                    view.evaluateJavascript(
                        "window.onGuardarObservaciones = function (id, texto) { CepiEvolucion.guardarObservaciones(String(id), String(texto == null ? '' : texto)); }; ''",
                        null,
                    )
                }
                alTerminar()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != web.host
        }
        loadUrl(web.newBuilder().addPathSegment("evolucion.html").build().toString())
    }

    fun ejecutar(codigo: String) {
        vista.evaluateJavascript("$codigo; ''", null)
    }

    fun imprimir(contexto: Context) {
        contexto.getSystemService(PrintManager::class.java)
            ?.print("Ficha de evolución", vista.createPrintDocumentAdapter("Ficha de evolución"), null)
    }
}

/**
 * Lo que la sección Evolución le pide a la Ficha: abrir ese episodio. Sin `equals` de datos a
 * propósito: pedir dos veces la misma ficha (después de moverse con las flechas) vuelve a llevar
 * el visor a ella.
 */
class EpisodeRequest(val episodeId: String)

/**
 * La ficha de evolución del paciente (PAPER §28), como sección del paciente: Chat · Ficha ·
 * Evolución · Imágenes (§24.2.1, §28.3). Fecha, médico, diagnósticos, tratamiento y
 * observaciones de cada ficha, la más nueva primero. Es el mismo documento de la web
 * (`evolucion.html`), así se lee e imprime igual en las tres. La ficha que se está viendo va
 * resaltada; tocar una fila la abre en la sección Ficha.
 * Se pide cada vez que la página queda a la vista: entre una vez y otra se pudo guardar un
 * diagnóstico.
 */
@Composable
fun EvolutionPage(
    pacienteId: String,
    /** La ficha que muestra la sección Ficha: se resalta. */
    currentEpisode: String?,
    api: CepiApi,
    web: okhttp3.HttpUrl,
    /** La página está asentada en pantalla: se recarga cada vez que pasa a `true`. */
    visible: Boolean,
    onOpenEpisode: (String) -> Unit,
) {
    val contexto = LocalContext.current
    val open by rememberUpdatedState(onOpenEpisode)
    var documentoListo by remember { mutableIntStateOf(0) }
    var datos by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var cargando by remember { mutableStateOf(true) }
    var reloadCount by remember { mutableIntStateOf(0) }
    val alcance = rememberCoroutineScope()
    val controlador = remember {
        ControladorEvolucion(contexto, web, { documentoListo++ }, { open(it) }) { id, texto, reply ->
            alcance.launch {
                val respuesta = try {
                    api.saveObservations(pacienteId, id, texto)
                    "window.observacionesGuardadas && window.observacionesGuardadas(${DatosEvolucion.cadena(id)}, ${DatosEvolucion.cadena(texto)})"
                } catch (e: ApiError) {
                    "window.errorObservaciones && window.errorObservaciones(${DatosEvolucion.cadena(id)}, ${DatosEvolucion.cadena("No se pudieron guardar las observaciones: ${e.mensaje}")})"
                }
                reply(respuesta)
            }
        }
    }
    DisposableEffect(Unit) { onDispose { controlador.vista.destroy() } }

    LaunchedEffect(pacienteId, visible, reloadCount) {
        if (!visible) return@LaunchedEffect
        cargando = true
        try {
            datos = coroutineScope {
                val filas = async { api.evolucion(pacienteId) }
                val paciente = async { runCatching { api.entidad(pacienteId).data }.getOrDefault(emptyMap()) }
                DatosFicha.javascript(DatosEvolucion.objeto(paciente.await(), filas.await(), currentEpisode, editable = true))
            }
            error = null
        } catch (e: ApiError) {
            datos = null
            error = "No se pudo cargar la evolución: ${e.mensaje}"
        }
    }
    // Los datos y el documento llegan en cualquier orden: se llena cuando están los dos.
    LaunchedEffect(documentoListo, datos, error) {
        if (documentoListo == 0) return@LaunchedEffect
        val falla = error
        val listos = datos
        when {
            falla != null -> controlador.ejecutar("window.errorEvolucion && window.errorEvolucion(${DatosEvolucion.cadena(falla)})")
            listos != null -> controlador.ejecutar("window.fillEvolucion && window.fillEvolucion($listos)")
            else -> return@LaunchedEffect
        }
        cargando = false
    }

    Column(Modifier.fillMaxSize()) {
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
        Surface(tonalElevation = 3.dp) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                TextButton(onClick = { reloadCount++ }, enabled = !cargando) {
                    Text("Actualizar")
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { controlador.imprimir(contexto) }, enabled = !cargando && error == null) {
                    Text("Imprimir")
                }
            }
        }
    }
}
