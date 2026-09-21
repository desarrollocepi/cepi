package ec.cepi.telemedicina.ficha

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CampoFormulario
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.ResultadoCIE
import ec.cepi.telemedicina.chat.FotoClinica
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private val rojo = Color(0xFFDC2626)
private val verde = Color(0xFF16A34A)
private val fechaLarga = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.forLanguageTag("es"))

/** Una fecha guardada como `YYYY-MM-DD`, que es lo que manda el `<input type="date">` de la web. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CampoFecha(texto: String, alCambiar: (String) -> Unit, habilitado: Boolean) {
    val fecha = Fechas.dia(texto)
    var abierto by remember { mutableStateOf(false) }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { abierto = true }, enabled = habilitado) {
            Icon(Icons.Filled.DateRange, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.size(6.dp))
            Text(fecha?.let { fechaLarga.format(it).replace(".", "") } ?: "Elegir fecha")
        }
        TextButton(onClick = { alCambiar("") }, enabled = habilitado && fecha != null) { Text("Quitar") }
    }

    if (abierto) {
        // El DatePicker trabaja en milisegundos UTC; el día guardado no tiene zona.
        val estado = rememberDatePickerState(
            initialSelectedDateMillis = (fecha ?: LocalDate.now()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { abierto = false },
            confirmButton = {
                TextButton(onClick = {
                    estado.selectedDateMillis?.let {
                        alCambiar(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())
                    }
                    abierto = false
                }) { Text("Aceptar") }
            },
            dismissButton = { TextButton(onClick = { abierto = false }) { Text("Cancelar") } },
        ) {
            DatePicker(estado)
        }
    }
}

/**
 * Búsqueda de registros del ERP con carga por páginas (EntitySearchField.vue). Elegir uno envía
 * su plantilla (`on_select_send`) como mensaje, p. ej. "activar paciente {id}".
 */
@Composable
fun CampoEntidad(campo: CampoFormulario, api: CepiApi, habilitado: Boolean, alElegir: (String) -> Unit) {
    val alcance = rememberCoroutineScope()
    var consulta by rememberSaveable { mutableStateOf("") }
    var resultados by remember { mutableStateOf(emptyList<Registro>()) }
    var hayMas by remember { mutableStateOf(false) }
    var cargando by remember { mutableStateOf(false) }

    suspend fun cargar(desdeCero: Boolean) {
        val texto = consulta.trim()
        val definicion = campo.definicion
        if (texto.length < campo.minimoCaracteres || definicion == null) {
            resultados = emptyList()
            hayMas = false
            return
        }
        cargando = true
        try {
            val desde = if (desdeCero) 0 else resultados.size
            val pagina = try {
                api.buscar(definicion, texto, desde, campo.tamanoPagina)
            } catch (_: ApiError) {
                emptyList()
            }
            if (texto != consulta.trim()) return
            resultados = if (desdeCero) pagina else resultados + pagina
            hayMas = pagina.size == campo.tamanoPagina
        } finally {
            cargando = false
        }
    }

    LaunchedEffect(consulta) {
        delay(250)
        cargar(desdeCero = true)
    }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value = consulta,
            onValueChange = { consulta = it },
            placeholder = { campo.placeholder?.let { Text(it) } },
            singleLine = true,
            enabled = habilitado,
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth(),
        )
        if (consulta.trim().length < campo.minimoCaracteres) {
            Pie("Escribe al menos ${campo.minimoCaracteres} caracteres…")
            return@Column
        }
        resultados.forEach { registro ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable(enabled = habilitado) { alElegir(LogicaFormulario.mensajeAlElegir(campo, registro)) }
                    .padding(vertical = 6.dp),
            ) {
                Text(LogicaFormulario.etiquetaResultado(campo, registro), fontWeight = FontWeight.Medium)
                campo.subResultado?.let { registro[it] }?.let { Pie(it) }
            }
        }
        when {
            cargando -> Pie("Buscando…")
            resultados.isEmpty() -> Pie("Sin coincidencias.")
        }
        // Siempre visible: gris cuando no quedan más resultados.
        TextButton(
            onClick = { alcance.launch { cargar(desdeCero = false) } },
            enabled = hayMas && !cargando,
        ) { Text(if (hayMas) "Cargar más" else "Fin de resultados") }
    }
}

/**
 * Diagnóstico con autocompletado contra el catálogo CIE-10 del ERP (IcdSearchField.vue). Lo que
 * se escribe también vale: el médico puede dejar texto libre.
 */
@Composable
fun CampoCIE10(campo: CampoFormulario, texto: String, alCambiar: (String) -> Unit, api: CepiApi, habilitado: Boolean) {
    var resultados by remember { mutableStateOf(emptyList<ResultadoCIE>()) }
    var buscando by remember { mutableStateOf(false) }
    /** El texto que puso una elección: no se vuelve a buscar por él. */
    var elegido by remember { mutableStateOf("") }

    LaunchedEffect(texto) {
        buscando = false
        val consulta = texto.trim()
        if (consulta.length < 3 || texto == elegido) {
            resultados = emptyList()
            return@LaunchedEffect
        }
        delay(280)
        buscando = true
        try {
            resultados = try {
                api.buscarCIE10(consulta)
            } catch (_: ApiError) {
                emptyList()
            }
        } finally {
            buscando = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value = texto,
            onValueChange = alCambiar,
            placeholder = { Text(campo.placeholder ?: "Buscar diagnóstico en CIE-10…") },
            enabled = habilitado,
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth(),
        )
        if (buscando) Pie("Buscando en CIE-10…")
        resultados.forEach { resultado ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = habilitado) {
                        val valor = (resultado.code?.let { "$it — " } ?: "") + resultado.title
                        elegido = valor
                        alCambiar(valor)
                        resultados = emptyList()
                    }
                    .padding(vertical = 6.dp),
            ) {
                Text(resultado.code ?: "—", fontWeight = FontWeight.Bold)
                Text(resultado.title)
            }
        }
    }
}

private val ovalo = GenericShape { tamano, _ -> addOval(Rect(0f, 0f, tamano.width, tamano.height)) }

/** §4.6: las dos siluetas con sus 38 regiones tocables (BodyMapField.vue). */
@Composable
fun CampoMapaCorporal(csv: String, alCambiar: (String) -> Unit, habilitado: Boolean) {
    val elegidas = remember(csv) { RegionCorporal.seleccion(csv) }
    val borde = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BoxWithConstraints(
            Modifier
                .fillMaxWidth()
                .aspectRatio(177f / 172f)
                .background(Color.White, RoundedCornerShape(8.dp)),
        ) {
            Image(
                painterResource(R.drawable.cuerpos),
                contentDescription = "Siluetas anterior y posterior",
                contentScale = ContentScale.FillBounds,
                modifier = Modifier.fillMaxSize(),
            )
            RegionCorporal.todas.forEach { region ->
                val elegida = region.clave in elegidas
                // El óvalo circunscribe la región en vez de quedar inscrito, igual que en la web.
                val ancho = maxWidth * (region.ancho / 100f) * 1.414f
                val alto = maxHeight * (region.alto / 100f) * 1.414f
                val x = maxWidth * ((region.izquierda + region.ancho / 2) / 100f) - ancho / 2
                val y = maxHeight * ((region.arriba + region.alto / 2) / 100f) - alto / 2
                Box(
                    Modifier
                        .offset(x, y)
                        .size(ancho, alto)
                        .clip(ovalo)
                        .background(if (elegida) rojo.copy(alpha = 0.34f) else Color.Transparent)
                        .border(1.dp, if (elegida) rojo else borde, ovalo)
                        .clickable(enabled = habilitado) { alCambiar(RegionCorporal.alternar(region.clave, csv)) }
                        .semantics {
                            contentDescription = region.etiqueta
                            selected = elegida
                        },
                )
            }
        }
        Pie(RegionCorporal.resumen(csv))
    }
}

private enum class EstadoSubida { Subiendo, Lista, Error }

private data class Subida(val id: Long, val nombre: String, val miniatura: Bitmap?, val estado: EstadoSubida, val adjunto: String? = null)

/**
 * §4.7 y §8: fotos que se suben al elegirlas; el campo guarda el CSV de ids de adjunto
 * (ImageUploadField.vue). El bot las inspecciona y registra al guardar el grupo.
 */
@Composable
fun CampoImagenes(csv: String, multiple: Boolean, alCambiar: (String) -> Unit, api: CepiApi, habilitado: Boolean) {
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    var items by remember { mutableStateOf(emptyList<Subida>()) }
    var subiendo by remember { mutableStateOf(false) }

    fun sincronizar() {
        alCambiar(items.filter { it.estado == EstadoSubida.Lista }.mapNotNull { it.adjunto }.joinToString(","))
    }

    fun subir(uris: List<android.net.Uri>) {
        if (uris.isEmpty()) return
        alcance.launch {
            subiendo = true
            try {
                if (!multiple) items = emptyList()
                for (uri in uris) {
                    val jpeg = withContext(Dispatchers.IO) { FotoClinica.jpeg(contexto.contentResolver, uri) } ?: continue
                    val nombre = FotoClinica.nombreNuevo()
                    val miniatura = withContext(Dispatchers.Default) { FotoClinica.miniatura(jpeg) }
                    val item = Subida(System.nanoTime(), nombre, miniatura, EstadoSubida.Subiendo)
                    items = items + item
                    val adjunto = try {
                        api.subirImagen(jpeg, nombre)
                    } catch (_: ApiError) {
                        null
                    }
                    items = items.map {
                        if (it.id != item.id) it
                        else it.copy(adjunto = adjunto?.id, estado = if (adjunto == null) EstadoSubida.Error else EstadoSubida.Lista)
                    }
                    sincronizar()
                }
            } finally {
                subiendo = false
            }
        }
    }

    val una = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> subir(listOfNotNull(uri)) }
    val varias = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris -> subir(uris) }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(
            onClick = {
                val pedido = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                if (multiple) varias.launch(pedido) else una.launch(pedido)
            },
            enabled = habilitado && !subiendo,
        ) {
            Icon(painterResource(R.drawable.ic_galeria), contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.size(6.dp))
            Text(if (subiendo) "Subiendo…" else if (multiple) "Elegir imágenes" else "Elegir imagen")
        }
        if (items.isEmpty()) {
            Pie(
                when {
                    csv.isNotBlank() -> "Ya hay imágenes guardadas en esta sección; las que subas las reemplazan."
                    multiple -> "Sube una o más imágenes."
                    else -> "Sube la imagen."
                },
            )
        }
        items.forEach { item ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    item.miniatura?.let {
                        Image(it.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    }
                }
                Text(item.nombre, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                when (item.estado) {
                    EstadoSubida.Subiendo -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    EstadoSubida.Lista -> Icon(Icons.Filled.CheckCircle, contentDescription = "Subida", tint = verde)
                    EstadoSubida.Error -> Icon(Icons.Filled.Warning, contentDescription = "No se pudo subir", tint = rojo)
                }
                IconButton(
                    onClick = {
                        items = items.filter { it.id != item.id }
                        sincronizar()
                    },
                    enabled = item.estado != EstadoSubida.Subiendo,
                ) { Icon(Icons.Filled.Close, contentDescription = "Quitar ${item.nombre}") }
            }
        }
    }
}

@Composable
internal fun Pie(texto: String) {
    Text(texto, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
