package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.FilaEvolucion
import kotlinx.coroutines.launch
import okhttp3.HttpUrl

/**
 * La edición en línea de las observaciones de UNA ficha de la evolución (PAPER §28.1), como en
 * `EvolucionPaciente.vue`. Sin UI, para poder probarla. Solo una a la vez: mientras se edita
 * una, el ✏️ de las demás queda deshabilitado con el motivo.
 */
data class ObservationEdit(
    val episodeId: String,
    /** Lo guardado al empezar (sin recortar, como la web). */
    val original: String,
    val draft: String,
    val saving: Boolean = false,
    val error: String? = null,
) {
    /** Lo que se guarda: recortado. Vacío borra las observaciones. */
    val textToSave: String get() = draft.trim()

    val unchanged: Boolean get() = textToSave == original

    /** Por qué «Guardar» está deshabilitado; `null` si se puede. */
    val saveDisabledReason: String?
        get() = when {
            saving -> "Guardando…"
            unchanged -> "No hay cambios que guardar"
            else -> null
        }

    companion object {
        fun start(row: FilaEvolucion) = ObservationEdit(row.episodio, row.observaciones.orEmpty(), row.observaciones.orEmpty())

        /** Por qué el ✏️ de esta fila está deshabilitado; `null` si se puede editar. */
        fun editDisabledReason(current: ObservationEdit?, row: FilaEvolucion): String? = when {
            current == null -> null
            current.episodeId == row.episodio -> "Ya la estás editando"
            else -> "Termina primero la otra observación"
        }

        /** Las filas con las observaciones recién guardadas, sin volver a pedirlas. */
        fun applySaved(rows: List<FilaEvolucion>, episodeId: String, text: String): List<FilaEvolucion> =
            rows.map { if (it.episodio == episodeId) it.copy(observaciones = text.ifEmpty { null }) else it }
    }
}

/**
 * La ficha de evolución del paciente (PAPER §28) como sección propia: Chat · Ficha ·
 * **Evolución** · Imágenes (§24.2.1, §28.3). Nativa y adaptable, como `EvolucionPaciente.vue`
 * con `plegable=false` en el teléfono: una tarjeta por ficha con las seis columnas de §28.1, la
 * más nueva primero, y el ✏️ de observaciones en línea (grupo `g_7`, sin sí/no: es una acción
 * explícita). Tocar una tarjeta abre esa ficha en la sección Ficha. «Imprimir» abre el
 * documento A4 (`evolucion.html`). Se pide cada vez que la página queda a la vista: entre una
 * vez y otra se pudo guardar un diagnóstico.
 */
@Composable
fun EvolutionPage(
    pacienteId: String,
    /** La ficha que muestra la sección Ficha: se resalta. */
    currentEpisode: String?,
    api: CepiApi,
    web: HttpUrl,
    /** La página está asentada en pantalla: se recarga cada vez que pasa a `true`. */
    visible: Boolean,
    onOpenEpisode: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf(emptyList<FilaEvolucion>()) }
    var loaded by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var edit by remember { mutableStateOf<ObservationEdit?>(null) }
    var reloadCount by remember { mutableIntStateOf(0) }
    var printing by remember { mutableStateOf(false) }

    LaunchedEffect(pacienteId, visible, reloadCount) {
        // Con una edición abierta no se relee: se perdería el borrador.
        if (!visible || edit != null) return@LaunchedEffect
        loading = true
        try {
            rows = api.evolucion(pacienteId)
            loaded = true
            error = null
        } catch (e: ApiError) {
            error = "No se pudo cargar la evolución: ${e.mensaje}"
        } finally {
            loading = false
        }
    }

    fun save(current: ObservationEdit) {
        edit = current.copy(saving = true, error = null)
        scope.launch {
            val text = current.textToSave
            edit = try {
                api.saveObservations(pacienteId, current.episodeId, text)
                rows = ObservationEdit.applySaved(rows, current.episodeId, text)
                null
            } catch (e: ApiError) {
                current.copy(saving = false, error = "No se pudo guardar: ${e.mensaje}")
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Surface(tonalElevation = 2.dp) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Evolución del paciente", style = MaterialTheme.typography.titleSmall)
                    Text(
                        when {
                            !loaded -> "fecha, quién atendió, diagnósticos, tratamiento y observaciones"
                            rows.size == 1 -> "1 ficha"
                            else -> "${rows.size} fichas"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = { reloadCount++ }, enabled = !loading && edit == null) { Text("Actualizar") }
                TextButton(onClick = { printing = true }, enabled = rows.isNotEmpty()) {
                    Icon(painterResource(R.drawable.ic_imprimir), contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(6.dp))
                    Text("Imprimir")
                }
            }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        when {
            error != null && rows.isEmpty() -> Column(Modifier.padding(24.dp)) {
                Text(error!!, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { reloadCount++ }, enabled = !loading) { Text("Reintentar") }
            }
            !loaded -> Text("Cargando la evolución…", modifier = Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            rows.isEmpty() -> Text(
                "Este paciente todavía no tiene fichas registradas. «Imprimir» se habilita con la primera.",
                modifier = Modifier.padding(24.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            else -> LazyColumn(
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f),
            ) {
                error?.let { item(key = "error") { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) } }
                items(rows, key = { it.episodio }) { row ->
                    EvolutionCard(
                        row = row,
                        current = row.episodio == currentEpisode,
                        edit = edit?.takeIf { it.episodeId == row.episodio },
                        editDisabledReason = ObservationEdit.editDisabledReason(edit, row),
                        onOpen = { onOpenEpisode(row.episodio) },
                        onStartEdit = { edit = ObservationEdit.start(row) },
                        onDraft = { text -> edit = edit?.copy(draft = text) },
                        onSave = { edit?.let(::save) },
                        onCancel = { edit = null },
                    )
                }
            }
        }
    }

    if (printing) {
        PrintDialog(titulo = "Ficha de evolución", onClose = { printing = false }) {
            EvolutionDocument(
                pacienteId = pacienteId,
                currentEpisode = currentEpisode,
                api = api,
                web = web,
                visible = true,
                onOpenEpisode = { id ->
                    printing = false
                    onOpenEpisode(id)
                },
            )
        }
    }
}

@Composable
private fun EvolutionCard(
    row: FilaEvolucion,
    current: Boolean,
    edit: ObservationEdit?,
    editDisabledReason: String?,
    onOpen: () -> Unit,
    onStartEdit: () -> Unit,
    onDraft: (String) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (current) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        ),
        border = BorderStroke(if (current) 2.dp else 1.dp, if (current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = edit == null, onClickLabel = if (current) "Es la ficha que estás viendo" else "Abrir esta ficha", onClick = onOpen),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.fecha ?: "—", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (current) Text("Ficha abierta", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            Dato("Atendió", row.medico ?: if (row.especialista == null) "—" else null, vacio = row.medico == null && row.especialista == null)
            row.especialista?.let { Text("Especialista: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Dato("Diagnóstico clínico", row.diagnostico ?: "Sin diagnóstico", vacio = row.diagnostico == null)
            Dato("Diagnóstico histopatológico", row.diagnosticoHistopatologico ?: "Sin biopsia", vacio = row.diagnosticoHistopatologico == null)
            Dato("Tratamiento", row.tratamiento ?: "Sin tratamiento", vacio = row.tratamiento == null)

            Text("Observaciones", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (edit != null) {
                OutlinedTextField(
                    value = edit.draft,
                    onValueChange = onDraft,
                    enabled = !edit.saving,
                    placeholder = { Text("Resumen de lo más importante de esta ficha") },
                    minLines = 3,
                    maxLines = 8,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = "Observaciones" },
                )
                edit.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onSave, enabled = edit.saveDisabledReason == null) {
                        Text(if (edit.saving) "Guardando…" else "Guardar")
                    }
                    OutlinedButton(onClick = onCancel, enabled = !edit.saving) { Text("Cancelar") }
                    if (edit.unchanged && !edit.saving) {
                        Text("No hay cambios que guardar", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        row.observaciones ?: "Sin observaciones",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (row.observaciones == null) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(
                        onClick = onStartEdit,
                        enabled = editDisabledReason == null,
                        modifier = Modifier.semantics {
                            contentDescription = editDisabledReason ?: "Editar las observaciones de esta ficha"
                        },
                    ) { Text("✏️") }
                }
                editDisabledReason?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

@Composable
private fun Dato(etiqueta: String, valor: String?, vacio: Boolean) {
    Column {
        Text(etiqueta, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        valor?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = if (vacio) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface)
        }
    }
}
