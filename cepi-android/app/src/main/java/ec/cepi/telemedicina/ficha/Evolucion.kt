package ec.cepi.telemedicina.ficha

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.print.PrintManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.FilaEvolucion
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
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
                    "diagnostico" to texto(fila.diagnostico),
                    "tratamiento" to texto(fila.tratamiento),
                ))
            }),
            "actual" to texto(actual),
        )
    }

    /** Una cadena de JavaScript con el texto escapado. */
    fun cadena(texto: String): String = DatosFicha.javascript(mapOf("m" to JsonPrimitive(texto))) + ".m"
}

/**
 * El WebView de `evolucion.html`. Tocar una fila llama a `window.onAbrirFicha(id)`, que acá va
 * al puente `CepiEvolucion`. Solo navega dentro del host de la web, como el de la ficha.
 */
@SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
private class ControladorEvolucion(contexto: Context, web: okhttp3.HttpUrl, alTerminar: () -> Unit, alElegir: (String) -> Unit) {
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
        }, "CepiEvolucion")
        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript("window.onAbrirFicha = function (id) { CepiEvolucion.abrirFicha(String(id)); }; ''", null)
                alTerminar()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != web.host
        }
        loadUrl(web.newBuilder().addPathSegment("evolucion.html").build().toString())
    }

    fun ejecutar(codigo: String) = vista.evaluateJavascript("$codigo; ''", null)

    fun imprimir(contexto: Context) {
        contexto.getSystemService(PrintManager::class.java)
            ?.print("Ficha de evolución", vista.createPrintDocumentAdapter("Ficha de evolución"), null)
    }
}

/**
 * La ficha de evolución del paciente (PAPER §28): fecha, médico, diagnóstico y tratamiento de
 * cada ficha, la más nueva primero. Es el mismo documento de la web (`evolucion.html`), así se
 * lee e imprime igual en las tres. La ficha que se está viendo va resaltada; tocar otra la abre.
 * Se pide cada vez que se abre: entre una vez y otra se pudo guardar un diagnóstico.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EvolucionDocumento(
    pacienteId: String,
    actual: String?,
    api: CepiApi,
    web: okhttp3.HttpUrl,
    alElegir: (String) -> Unit,
    alCerrar: () -> Unit,
) {
    val contexto = LocalContext.current
    val elegir by rememberUpdatedState { id: String ->
        if (id != actual) {
            alElegir(id)
            alCerrar()
        }
    }
    var documentoListo by remember { mutableIntStateOf(0) }
    var datos by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var cargando by remember { mutableStateOf(true) }
    val controlador = remember { ControladorEvolucion(contexto, web, { documentoListo++ }, { elegir(it) }) }
    DisposableEffect(Unit) { onDispose { controlador.vista.destroy() } }

    LaunchedEffect(pacienteId) {
        try {
            datos = coroutineScope {
                val filas = async { api.evolucion(pacienteId) }
                val paciente = async { runCatching { api.entidad(pacienteId).data }.getOrDefault(emptyMap()) }
                DatosFicha.javascript(DatosEvolucion.objeto(paciente.await(), filas.await(), actual))
            }
        } catch (e: ApiError) {
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

    Dialog(onDismissRequest = alCerrar, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Ficha de evolución") },
                    navigationIcon = {
                        IconButton(onClick = alCerrar) { Icon(Icons.Filled.Close, contentDescription = "Cerrar") }
                    },
                    actions = {
                        TextButton(onClick = { controlador.imprimir(contexto) }, enabled = !cargando && error == null) {
                            Text("Imprimir")
                        }
                    },
                )
            },
        ) { relleno ->
            Box(Modifier.padding(relleno).fillMaxSize(), contentAlignment = Alignment.Center) {
                AndroidView(factory = { controlador.vista }, modifier = Modifier.fillMaxSize())
                if (cargando) CircularProgressIndicator()
            }
        }
    }
}
