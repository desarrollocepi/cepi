package ec.cepi.telemedicina.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.ImageRequest
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Credenciales
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import android.content.Context

/**
 * Las imágenes de adjuntos. Van por el mismo OkHttp que la API, con el token, y se guardan solo
 * en memoria ya reducidas al tamaño en que se muestran: ni fotos clínicas en disco ni 50
 * originales decodificados en un hilo largo (PAPER §25.5).
 */
class Imagenes(val cargador: ImageLoader, private val api: CepiApi) {
    fun url(adjunto: String): String = api.urlAdjunto(adjunto)

    companion object {
        fun crear(contexto: Context, http: OkHttpClient, base: HttpUrl, credenciales: Credenciales, api: CepiApi): Imagenes {
            val conToken = http.newBuilder().addInterceptor(Autorizacion(base, credenciales)).build()
            val cargador = ImageLoader.Builder(contexto)
                .components { add(OkHttpNetworkFetcherFactory(callFactory = { conToken })) }
                .diskCache(null)
                .build()
            return Imagenes(cargador, api)
        }
    }
}

/** Bearer solo hacia el backend: el token no sale a otro host aunque una URL apunte afuera. */
private class Autorizacion(private val base: HttpUrl, private val credenciales: Credenciales) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val pedido = chain.request()
        val propio = pedido.url.host == base.host && pedido.url.port == base.port
        val token = if (propio) credenciales.tokenActual() else null
        return chain.proceed(if (token == null) pedido else pedido.newBuilder().header("Authorization", "Bearer $token").build())
    }
}

val LocalImagenes = staticCompositionLocalOf<Imagenes> { error("Falta proveer Imagenes") }

/**
 * Una imagen de adjunto con su espera y su fallo a la vista. `lado` en píxeles fija el tamaño de
 * decodificación; sin él, Coil usa el del composable.
 */
@Composable
fun ImagenAutenticada(
    id: String,
    descripcion: String?,
    modifier: Modifier = Modifier,
    escala: ContentScale = ContentScale.Fit,
    lado: Int? = null,
) {
    val imagenes = LocalImagenes.current
    val contexto = LocalContext.current
    val pedido = remember(id, lado) {
        ImageRequest.Builder(contexto)
            .data(imagenes.url(id))
            .apply { if (lado != null) size(lado) }
            .build()
    }
    var estado by remember(id) { mutableStateOf<AsyncImagePainter.State>(AsyncImagePainter.State.Empty) }

    Box(modifier, contentAlignment = Alignment.Center) {
        AsyncImage(
            model = pedido,
            contentDescription = descripcion,
            imageLoader = imagenes.cargador,
            contentScale = escala,
            onState = { estado = it },
            modifier = Modifier.matchParentSize(),
        )
        when (estado) {
            is AsyncImagePainter.State.Loading, AsyncImagePainter.State.Empty ->
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            is AsyncImagePainter.State.Error -> Text(
                "No se pudo cargar la imagen",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(8.dp),
            )
            is AsyncImagePainter.State.Success -> Unit
        }
    }
}

/**
 * Una imagen clínica a pantalla completa, con zoom: pellizcar, doble toque y arrastrar.
 * Equivale al lightbox de MessageContent.vue.
 */
@Composable
fun VisorImagen(id: String, alCerrar: () -> Unit) {
    var escala by remember { mutableFloatStateOf(1f) }
    var desplazamiento by remember { mutableStateOf(Offset.Zero) }

    Dialog(onDismissRequest = alCerrar, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black),
        ) {
            // Más grande que la miniatura: el zoom tiene que mostrar detalle de la lesión.
            ImagenAutenticada(
                id = id,
                descripcion = "Imagen clínica",
                lado = 2800,
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, arrastre, zoom, _ ->
                            escala = (escala * zoom).coerceIn(1f, 6f)
                            desplazamiento = if (escala > 1f) desplazamiento + arrastre else Offset.Zero
                        }
                    }
                    .pointerInput(Unit) {
                        detectTapGestures(onDoubleTap = {
                            if (escala > 1f) {
                                escala = 1f
                                desplazamiento = Offset.Zero
                            } else {
                                escala = 2.5f
                            }
                        })
                    }
                    .graphicsLayer {
                        scaleX = escala
                        scaleY = escala
                        translationX = desplazamiento.x
                        translationY = desplazamiento.y
                    },
            )
            IconButton(
                onClick = alCerrar,
                modifier = Modifier
                    .safeDrawingPadding()
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .background(Color.White.copy(alpha = 0.2f), CircleShape),
            ) {
                Icon(Icons.Filled.Close, contentDescription = "Cerrar", tint = Color.White)
            }
            Text(
                "Doble toque para acercar · pellizca para zoom · arrastra para mover",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.7f),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .safeDrawingPadding()
                    .padding(16.dp),
            )
        }
    }
}
