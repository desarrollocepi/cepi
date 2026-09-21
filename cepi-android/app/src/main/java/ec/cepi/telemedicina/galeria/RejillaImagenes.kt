package ec.cepi.telemedicina.galeria

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.ImagenGaleria
import ec.cepi.telemedicina.app.Aviso
import ec.cepi.telemedicina.chat.ImagenAutenticada
import ec.cepi.telemedicina.chat.VisorImagen
import kotlinx.coroutines.launch

/**
 * Rejilla de imágenes clínicas. La usan la galería de la organización y la sección de imágenes
 * del paciente: cambia qué se pide, no cómo se ve.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RejillaImagenes(
    modelo: GaleriaModelo,
    /** Qué decir cuando no hay ninguna (con búsqueda vacía). */
    vacio: String,
    modifier: Modifier = Modifier,
    /** Con el paciente abierto no hace falta repetir su nombre en cada foto. */
    mostrarPaciente: Boolean = true,
) {
    val alcance = rememberCoroutineScope()
    var abierta by remember { mutableStateOf<String?>(null) }
    var refrescando by remember { mutableStateOf(false) }

    Box(modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = refrescando,
            onRefresh = {
                refrescando = true
                alcance.launch {
                    modelo.recargar()
                    refrescando = false
                }
            },
        ) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(110.dp),
                contentPadding = PaddingValues(6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(modelo.imagenes, key = { it.id }) { imagen ->
                    Celda(imagen, mostrarPaciente) { abierta = imagen.adjunto }
                    // Al llegar al final de lo cargado se pide la página siguiente.
                    if (imagen.id == modelo.imagenes.lastOrNull()?.id) {
                        LaunchedEffect(imagen.id) { modelo.siguientePagina() }
                    }
                }
                if (modelo.cargando && modelo.imagenes.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Box(Modifier.padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    }
                }
            }
        }

        val error = modelo.error
        when {
            !modelo.cargado && error != null -> Aviso(
                icono = rememberVectorPainter(Icons.Filled.Warning),
                titulo = "No se pudieron cargar las imágenes",
                descripcion = error,
            ) {
                TextButton(onClick = { alcance.launch { modelo.recargar() } }) { Text("Reintentar") }
            }
            !modelo.cargado -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                modifier = Modifier.fillMaxSize(),
            ) {
                CircularProgressIndicator()
                Text("Cargando imágenes…", style = MaterialTheme.typography.bodyMedium)
            }
            modelo.imagenes.isEmpty() && modelo.busqueda.isEmpty() ->
                Aviso(icono = painterResource(R.drawable.ic_galeria), titulo = vacio)
            modelo.imagenes.isEmpty() -> Aviso(
                icono = rememberVectorPainter(Icons.Filled.Search),
                titulo = "Sin resultados",
                descripcion = "Ninguna imagen coincide con «${modelo.busqueda}».",
            )
        }
    }

    abierta?.let { VisorImagen(it) { abierta = null } }
}

@Composable
private fun Celda(imagen: ImagenGaleria, mostrarPaciente: Boolean, alAbrir: () -> Unit) {
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.clickable(onClick = alAbrir),
    ) {
        ImagenAutenticada(
            id = imagen.adjunto,
            descripcion = listOfNotNull(imagen.paciente, imagen.diagnostico).joinToString(" · ").ifEmpty { "Imagen clínica" },
            escala = ContentScale.Crop,
            lado = 420,
            modifier = Modifier
                .fillMaxWidth()
                .height(110.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        )
        if (mostrarPaciente && !imagen.paciente.isNullOrEmpty()) {
            Text(
                imagen.paciente,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            pie(imagen),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Lo que identifica el caso de un vistazo: fecha y diagnóstico (o la región del cuerpo). */
fun pie(imagen: ImagenGaleria): String {
    val fecha = Fechas.dia(imagen.fecha)?.let(Fechas::textoCorto) ?: imagen.fecha?.take(10).orEmpty()
    val detalle = listOfNotNull(imagen.codigoCIE10, imagen.diagnostico ?: imagen.region)
        .filter { it.isNotEmpty() }
        .joinToString(" · ")
    return listOf(fecha, detalle).filter { it.isNotEmpty() }.joinToString(" · ")
}
