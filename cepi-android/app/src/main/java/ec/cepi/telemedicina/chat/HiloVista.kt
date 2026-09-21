package ec.cepi.telemedicina.chat

import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.AccionPendiente
import ec.cepi.telemedicina.api.MensajeHilo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private val morado = Color(0xFF7C3AED)
private val amarillo = Color(0xFFEAB308)

/**
 * El chat del paciente: sus consultas, los mensajes de todos y el composer. Primera sección de
 * la pantalla del paciente, que es quien abre el hilo. Equivale a IntakeChat.vue.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HiloVista(modelo: HiloModelo, alAbrirImagen: (String) -> Unit) {
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    var borrador by rememberSaveable { mutableStateOf("") }
    var captura by rememberSaveable { mutableStateOf<String?>(null) }
    var refrescando by remember { mutableStateOf(false) }
    val hayCamara = remember { contexto.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }

    val episodios = remember(modelo.mensajes, modelo.episodioActivo) { modelo.episodios }
    val indice = episodios.indice(modelo.pagina)
    val visibles = remember(episodios, indice) { episodios.visibles(modelo.mensajes, indice) }
    val enLaActual = episodios.esActiva(indice, modelo.episodioActivo)

    // La foto se prepara fuera del hilo principal; la captura temporal se borra enseguida.
    fun subir(uri: Uri, temporal: File?) {
        alcance.launch {
            val jpeg = withContext(Dispatchers.IO) { FotoClinica.jpeg(contexto.contentResolver, uri) }
            temporal?.delete()
            if (jpeg == null) {
                modelo.error = "No se pudo leer la foto."
            } else {
                modelo.subir(jpeg, FotoClinica.nombreNuevo())
            }
        }
    }

    val galeria = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) subir(uri, null)
    }
    val camara = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { tomada ->
        val archivo = captura?.let(::File)
        captura = null
        if (archivo == null) return@rememberLauncherForActivityResult
        if (tomada) subir(Uri.fromFile(archivo), archivo) else archivo.delete()
    }

    Column(Modifier.fillMaxSize()) {
        BarraDeConsultas(modelo, episodios, indice, enLaActual)

        PullToRefreshBox(
            isRefreshing = refrescando,
            onRefresh = {
                refrescando = true
                alcance.launch {
                    modelo.releer()
                    refrescando = false
                }
            },
            modifier = Modifier.weight(1f),
        ) {
            Feed(modelo, visibles, alAbrirImagen)
        }

        if (enLaActual) {
            Composer(
                texto = borrador,
                alCambiar = { borrador = it },
                ocupado = modelo.ocupado,
                subiendo = modelo.subiendo,
                adjunto = modelo.adjunto,
                hayCamara = hayCamara,
                alElegirFoto = {
                    galeria.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
                alTomarFoto = {
                    val carpeta = File(contexto.cacheDir, "fotos").apply { mkdirs() }
                    val archivo = File(carpeta, "captura-${System.currentTimeMillis()}.jpg")
                    val uri = FileProvider.getUriForFile(contexto, "${contexto.packageName}.fotos", archivo)
                    captura = archivo.path
                    try {
                        camara.launch(uri)
                    } catch (_: ActivityNotFoundException) {
                        captura = null
                        modelo.error = "No hay una app de cámara en este teléfono."
                    }
                },
                alQuitarAdjunto = { modelo.quitarAdjunto() },
                alEnviar = {
                    val texto = borrador
                    borrador = ""
                    alcance.launch { modelo.enviar(texto) }
                },
            )
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(amarillo.copy(alpha = 0.18f))
                    .padding(12.dp),
            ) {
                Icon(painterResource(R.drawable.ic_ojo), contentDescription = null, modifier = Modifier.size(18.dp))
                Text(
                    "Consulta anterior — solo lectura",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 6.dp),
                )
                OutlinedButton(onClick = { modelo.volverALaActual() }) { Text("Volver a la actual") }
            }
        }
    }
}

@Composable
private fun BarraDeConsultas(modelo: HiloModelo, episodios: Episodios, indice: Int, enLaActual: Boolean) {
    Surface(tonalElevation = 2.dp) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 2.dp),
        ) {
            IconButton(onClick = { modelo.irAnterior() }, enabled = !modelo.ocupado && indice > 0) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Consulta anterior")
            }
            Text(
                if (modelo.cargado) episodios.etiqueta(indice, modelo.mensajes) else "Cargando consultas…",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
            IconButton(onClick = { modelo.irSiguiente() }, enabled = !modelo.ocupado && indice < episodios.orden.size - 1) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Consulta siguiente")
            }
            TextButton(onClick = { modelo.volverALaActual() }, enabled = !modelo.ocupado && !enLaActual) {
                Text("Actual")
            }
        }
    }
}

/**
 * Los mensajes de la página, del último hacia arriba (`reverseLayout`): el hilo arranca en el
 * final y ahí se queda cuando llega un mensaje o una imagen termina de cargar.
 */
@Composable
private fun Feed(modelo: HiloModelo, visibles: List<MensajeHilo>, alAbrirImagen: (String) -> Unit) {
    val alcance = rememberCoroutineScope()
    val lista = rememberLazyListState()
    LaunchedEffect(modelo.pagina) { lista.scrollToItem(0) }
    // Lo nuevo entra por abajo (índice 0) y la lista conserva el ítem que estaba a la vista:
    // sin esto, la respuesta del bot quedaba debajo del borde. Igual que `bajar` en iOS.
    LaunchedEffect(visibles.size, modelo.ocupado, modelo.respuestasRapidas, modelo.pendiente, modelo.error) {
        lista.animateScrollToItem(0)
    }

    LazyColumn(
        state = lista,
        reverseLayout = true,
        // Pocos mensajes van abajo, junto al composer, como en cualquier chat.
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        modelo.error?.let { error ->
            item(key = "error") {
                Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
        modelo.pendiente?.let { pendiente ->
            item(key = "pendiente") {
                TarjetaPendiente(pendiente, habilitada = !modelo.ocupado) { respuesta ->
                    alcance.launch { modelo.enviar(respuesta) }
                }
            }
        }
        if (modelo.respuestasRapidas.isNotEmpty() && !modelo.ocupado) {
            item(key = "rapidas") {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                ) {
                    modelo.respuestasRapidas.forEach { respuesta ->
                        OutlinedButton(onClick = { alcance.launch { modelo.enviar(respuesta.send) } }) {
                            Text(respuesta.label)
                        }
                    }
                }
            }
        }
        if (modelo.ocupado && modelo.cargado) {
            item(key = "escribiendo") {
                Text(
                    "escribiendo…",
                    fontStyle = FontStyle.Italic,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(count = visibles.size, key = { "m${visibles.size - 1 - it}" }) { desdeElFinal ->
            val indice = visibles.size - 1 - desdeElFinal
            Burbuja(visibles[indice], Episodios.autor(visibles, indice), alAbrirImagen)
        }
        if (!modelo.cargado && modelo.error == null) {
            item(key = "cargando") {
                Texto("Cargando la información…")
            }
        } else if (visibles.isEmpty() && !modelo.ocupado) {
            item(key = "vacio") {
                Texto(
                    "Escribe o pega un texto con los datos del paciente y la IA los carga en la ficha. " +
                        "También puedes conversar normalmente; antes de guardar se pide confirmación.",
                )
            }
        }
    }
}

@Composable
private fun Texto(texto: String) {
    Text(
        texto,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 40.dp),
    )
}

/**
 * Un mensaje del hilo: el propio a la derecha; los del asistente y de otros profesionales a la
 * izquierda, con el autor encima de cada racha.
 */
@Composable
private fun Burbuja(mensaje: MensajeHilo, autor: String?, alAbrirImagen: (String) -> Unit) {
    val segmentos = remember(mensaje.contenido) { Segmento.dividir(mensaje.contenido) }
    val fondo = when {
        mensaje.propio -> MaterialTheme.colorScheme.primary
        mensaje.esBot -> MaterialTheme.colorScheme.surfaceVariant
        else -> morado.copy(alpha = 0.12f)
    }
    val color = if (mensaje.propio) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface

    Box(
        contentAlignment = if (mensaje.propio) Alignment.CenterEnd else Alignment.CenterStart,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .fillMaxWidth(0.85f)
                .wrapContentWidth(if (mensaje.propio) Alignment.End else Alignment.Start)
                .background(fondo, RoundedCornerShape(16.dp))
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (autor != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(
                        if (mensaje.esBot) painterResource(R.drawable.ic_asistente) else rememberVectorPainter(Icons.Filled.Person),
                        contentDescription = null,
                        tint = if (mensaje.esBot) MaterialTheme.colorScheme.onSurfaceVariant else morado,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(
                        autor,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (mensaje.esBot) MaterialTheme.colorScheme.onSurfaceVariant else morado,
                    )
                }
            }
            segmentos.forEach { segmento ->
                when (segmento) {
                    is Segmento.Texto -> SelectionContainer {
                        Text(segmento.texto, color = color, style = MaterialTheme.typography.bodyLarge)
                    }
                    // Tamaño fijo desde antes de cargar: si la miniatura crece al llegar, el hilo salta.
                    is Segmento.Imagen -> ImagenAutenticada(
                        id = segmento.id,
                        descripcion = segmento.nombre ?: "Imagen clínica",
                        modifier = Modifier
                            .size(220.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color.Black.copy(alpha = 0.06f))
                            .clickable { alAbrirImagen(segmento.id) },
                    )
                }
            }
        }
    }
}

/** Escritura inferida que espera el sí/no (PAPER §13.3.1). */
@Composable
private fun TarjetaPendiente(pendiente: AccionPendiente, habilitada: Boolean, alResponder: (String) -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = amarillo.copy(alpha = 0.15f),
        border = BorderStroke(2.dp, amarillo),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(pendiente.summary, style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { alResponder("sí") },
                    enabled = habilitada,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16A34A), contentColor = Color.White),
                ) {
                    Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(6.dp))
                    Text("Confirmar")
                }
                OutlinedButton(onClick = { alResponder("no") }, enabled = habilitada) {
                    Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(6.dp))
                    Text("Cancelar")
                }
            }
        }
    }
}
