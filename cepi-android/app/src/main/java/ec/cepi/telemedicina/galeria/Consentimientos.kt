package ec.cepi.telemedicina.galeria

import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.ConsentList
import ec.cepi.telemedicina.api.ConsentPhoto
import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.chat.FotoClinica
import ec.cepi.telemedicina.chat.ImagenAutenticada
import ec.cepi.telemedicina.chat.VisorImagen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Los dos consentimientos del paciente (PAPER §31.1): quién firma cada uno. */
enum class ConsentType(val key: String, val title: String, val signer: String) {
    INFORMED("informado", "Consentimiento informado", "Lo firma el paciente"),
    DATA_PRIVACY("privacidad_datos", "Privacidad de los datos", "Lo firma el profesional que atiende"),
}

/**
 * Las fotos firmadas de los consentimientos de un paciente y su subida. Espejo de
 * `ConsentimientosPaciente.vue`: una subida a la vez, y tras guardar se recarga la lista.
 */
class ConsentModel(private val api: CepiApi, val patientId: String) {
    var list: ConsentList by mutableStateOf(ConsentList())
        private set
    var loaded: Boolean by mutableStateOf(false)
        private set
    var error: String? by mutableStateOf(null)
        private set
    /** El tipo que se está subiendo; `null` si ninguno. */
    var uploading: ConsentType? by mutableStateOf(null)
        private set
    /** Resultado de la última subida de cada tipo; `second` = es un error. */
    val notices = mutableStateMapOf<ConsentType, Pair<String, Boolean>>()

    fun photos(type: ConsentType): List<ConsentPhoto> = when (type) {
        ConsentType.INFORMED -> list.informado
        ConsentType.DATA_PRIVACY -> list.privacidadDatos
    }

    /** Por qué no se puede subir ahora a `type`; `null` si se puede. */
    fun uploadDisabledReason(type: ConsentType): String? = uploadDisabledReason(loaded, error, uploading, type)

    suspend fun load() {
        try {
            list = api.consents(patientId)
            error = null
            loaded = true
        } catch (e: ApiError) {
            error = "No se pudieron cargar los consentimientos: ${e.mensaje}"
        }
    }

    suspend fun upload(type: ConsentType, uris: List<Uri>, resolver: ContentResolver) {
        if (uris.isEmpty() || uploading != null) return
        uploading = type
        notices.remove(type)
        try {
            val ids = mutableListOf<String>()
            for (uri in uris) {
                val jpeg = withContext(Dispatchers.IO) { FotoClinica.jpeg(resolver, uri) } ?: continue
                ids += api.subirImagen(jpeg, FotoClinica.nombreNuevo()).id
            }
            if (ids.isEmpty()) {
                notices[type] = "No se pudo leer la imagen" to true
                return
            }
            val result = api.saveConsents(patientId, type.key, ids)
            notices[type] = when {
                result.errors.isNotEmpty() -> "No se pudo guardar: ${result.errors.joinToString("; ")}" to true
                result.ids.size == 1 -> "Foto guardada" to false
                else -> "${result.ids.size} fotos guardadas" to false
            }
            load()
        } catch (e: ApiError) {
            notices[type] = "No se pudo guardar: ${e.mensaje}" to true
        } finally {
            uploading = null
        }
    }

    companion object {
        fun uploadDisabledReason(loaded: Boolean, error: String?, uploading: ConsentType?, type: ConsentType): String? = when {
            !loaded && error != null -> "No se cargaron los consentimientos: reintenta"
            !loaded -> "Espera a que carguen los consentimientos"
            uploading == type -> "Subiendo…"
            uploading != null -> "Termina primero la otra subida"
            else -> null
        }
    }
}

/**
 * Los dos recuadros de consentimientos, arriba de las fotos clínicas del paciente (PAPER §31.3).
 * El botón «Subir foto» está siempre; mientras no aplica queda gris con el motivo debajo.
 */
@Composable
fun ConsentimientosPaciente(model: ConsentModel, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(model) { model.load() }

    Column(modifier.padding(horizontal = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        ConsentType.entries.forEach { type -> ConsentBox(model, type) { open = it } }
    }

    open?.let { VisorImagen(it) { open = null } }
}

@Composable
private fun ConsentBox(model: ConsentModel, type: ConsentType, onOpen: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
        scope.launch { model.upload(type, uris, context.contentResolver) }
    }
    val reason = model.uploadDisabledReason(type)

    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(type.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Text(type.signer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Button(
                    onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    enabled = reason == null,
                    modifier = Modifier.semantics { contentDescription = "Subir foto del ${type.title.lowercase()}" },
                ) {
                    Text(if (model.uploading == type) "Subiendo…" else "📷 Subir foto")
                }
            }
            if (reason != null && model.uploading != type) {
                Text(reason, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            val error = model.error
            val photos = model.photos(type)
            when {
                !model.loaded && error != null -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { scope.launch { model.load() } }) { Text("Reintentar") }
                }
                !model.loaded -> Status("Cargando…")
                photos.isEmpty() -> Status("Todavía no hay foto")
                else -> LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(photos, key = { it.id }) { photo -> ConsentThumbnail(photo, type, onOpen) }
                }
            }

            model.notices[type]?.let { (text, isError) ->
                Text(
                    text,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

@Composable
private fun ConsentThumbnail(photo: ConsentPhoto, type: ConsentType, onOpen: (String) -> Unit) {
    val attachment = photo.attachmentId
    val date = Fechas.dia(photo.fecha)?.let(Fechas::textoCorto) ?: photo.fecha.orEmpty()
    val shape = RoundedCornerShape(6.dp)
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier
            .width(88.dp)
            .then(if (attachment != null) Modifier.clickable { onOpen(attachment) } else Modifier),
    ) {
        if (attachment != null) {
            ImagenAutenticada(
                id = attachment,
                descripcion = listOf(type.title, date).filter { it.isNotEmpty() }.joinToString(" · "),
                escala = ContentScale.Crop,
                lado = 300,
                modifier = Modifier
                    .size(88.dp)
                    .clip(shape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )
        } else {
            // Registro anterior a la corrección de §31.1: la foto no se guardó.
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(88.dp)
                    .clip(shape)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .alpha(0.6f)
                    .semantics { contentDescription = "Registro anterior sin foto guardada" },
            ) {
                Text("Sin foto", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Status(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
