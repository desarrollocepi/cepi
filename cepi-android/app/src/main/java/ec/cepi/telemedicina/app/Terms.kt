package ec.cepi.telemedicina.app

import android.annotation.SuppressLint
import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.jsonCepi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Términos de uso (LOPDP, PAPER §37). El texto es `terminos.html` de la web y la versión
 * vigente, `terminos.json`: los mismos que leen la PWA y iOS. Esta constante solo se usa si
 * `terminos.json` no responde (sin red).
 */
const val FALLBACK_TERMS_VERSION = "2026-11-15"

/** Lee `{ "version": … }` de `terminos.json`; null si no responde o no trae versión. */
suspend fun fetchCurrentTermsVersion(http: OkHttpClient, web: HttpUrl): String? = withContext(Dispatchers.IO) {
    runCatching {
        val pedido = Request.Builder()
            .url(web.newBuilder().addPathSegment("terminos.json").build())
            .header("Cache-Control", "no-cache")
            .build()
        http.newCall(pedido).execute().use { r ->
            if (!r.isSuccessful) return@use null
            jsonCepi.parseToJsonElement(r.body.string()).jsonObject["version"]?.jsonPrimitive?.contentOrNull
        }
    }.getOrNull()
}

/**
 * Puerta tras el login, equivalente a `TermsModal.vue`: sin aceptar la versión vigente no se
 * ve nada de la app. «No acepto» cierra la sesión.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TermsScreen(entorno: Entorno) {
    val sesion = entorno.sesion
    val alcance = rememberCoroutineScope()
    var read by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val url = remember { entorno.config.webBase.newBuilder().addPathSegment("terminos.html").build() }

    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Términos y condiciones de uso", style = MaterialTheme.typography.titleLarge)
        Text(
            buildString {
                append("Antes de seguir, lee y acepta cómo se tratan tus datos personales y los de los pacientes, según la Ley Orgánica de Protección de Datos Personales del Ecuador.")
                if (sesion.usuario?.termsVersion != null) append(" Los términos cambiaron desde que los aceptaste.")
            },
            style = MaterialTheme.typography.bodySmall,
        )
        AndroidView(
            modifier = Modifier.fillMaxWidth().weight(1f),
            factory = { contexto ->
                WebView(contexto).apply {
                    settings.javaScriptEnabled = false
                    webViewClient = object : WebViewClient() {
                        // Los enlaces de la propia web (la política de privacidad) se abren
                        // adentro; un correo u otro sitio, afuera.
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            if (request.url.host == url.host) return false
                            runCatching { contexto.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                            return true
                        }
                    }
                    loadUrl(url.toString())
                }
            },
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = read, onCheckedChange = { read = it }, enabled = !saving)
            Text(
                "Leí y acepto los términos y condiciones y la Política de Privacidad.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        error?.let {
            SelectionContainer {
                Text("No se pudo guardar tu aceptación: $it", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (!read) {
            Text("Marca la casilla de lectura para aceptar.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                modifier = Modifier.weight(1f),
                enabled = !saving,
                onClick = { alcance.launch { sesion.salir() } },
            ) { Text("No acepto") }
            Button(
                modifier = Modifier.weight(1f),
                enabled = read && !saving,
                onClick = {
                    saving = true
                    error = null
                    alcance.launch {
                        try {
                            sesion.acceptTerms()
                        } catch (e: ApiError) {
                            error = e.mensaje
                        } finally {
                            saving = false
                        }
                    }
                },
            ) { Text(if (saving) "Guardando…" else "Acepto") }
        }
    }
}
