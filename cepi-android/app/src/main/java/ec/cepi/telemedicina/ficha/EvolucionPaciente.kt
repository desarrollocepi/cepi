package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
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
import ec.cepi.telemedicina.api.CampoFormulario
import ec.cepi.telemedicina.api.FilaEvolucion
import kotlinx.coroutines.launch
import okhttp3.HttpUrl

/**
 * La edición en línea de las observaciones de UNA fila de la evolución (PAPER §28.1, §28.4), como
 * en `EvolucionPaciente.vue`. Sin UI, para poder probarla. Solo una a la vez: mientras se edita
 * una, el ✏️ de las demás queda deshabilitado con el motivo. Una evolución registrada guarda por
 * `/api/bot/evolucion/editar`; la fila armada de una ficha sin evoluciones, por `g_7`.
 */
data class ObservationEdit(
    val episodeId: String,
    /** La evolución registrada; `null` en la fila armada (guarda `g_7` del episodio). */
    val evolutionId: String?,
    /** `FilaEvolucion.rowKey` de la fila que se edita. */
    val rowKey: String,
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
        fun start(row: FilaEvolucion) =
            ObservationEdit(row.episodio, row.evolutionId, row.rowKey, row.observaciones.orEmpty(), row.observaciones.orEmpty())

        /** Por qué el ✏️ de esta fila está deshabilitado; `null` si se puede editar. */
        fun editDisabledReason(current: ObservationEdit?, row: FilaEvolucion, addingEvolution: Boolean = false): String? = when {
            addingEvolution -> "Termina primero la evolución que estás agregando"
            current == null -> null
            current.rowKey == row.rowKey -> "Ya la estás editando"
            else -> "Termina primero la otra observación"
        }

        /** Las filas con las observaciones recién guardadas, sin volver a pedirlas. */
        fun applySaved(rows: List<FilaEvolucion>, rowKey: String, text: String): List<FilaEvolucion> =
            rows.map { if (it.rowKey == rowKey) it.copy(observaciones = text.ifEmpty { null }) else it }
    }
}

/**
 * La ficha de evolución del paciente (PAPER §28) como sección propia: Chat · Ficha ·
 * **Evolución** · Imágenes (§24.2.1, §28.3). Nativa y adaptable, como `EvolucionPaciente.vue`
 * con `plegable=false` en el teléfono. Muestra las evoluciones de la **ficha abierta** (la de la
 * barra de episodios) con su cabecera —motivo, fecha de apertura, estado— y «＋ Agregar
 * evolución» (§28.4); debajo, plegadas, las otras fichas del paciente. Cada evolución es una
 * tarjeta con las columnas de §28.1 y el ✏️ de observaciones en línea (sin sí/no: es una acción
 * explícita). «Imprimir» abre el documento A4 (`evolucion.html`). Se pide cada vez que la página
 * queda a la vista: entre una vez y otra se pudo guardar un diagnóstico.
 */
@Composable
fun EvolutionPage(
    pacienteId: String,
    /** La ficha que muestra la sección Ficha: es la que se abre acá. */
    currentEpisode: String?,
    api: CepiApi,
    web: HttpUrl,
    /** La página está asentada en pantalla: se recarga cada vez que pasa a `true`. */
    visible: Boolean,
    /** Abrir la ficha en la sección Ficha (se va a esa sección). */
    onOpenEpisode: (String) -> Unit,
    /** Cambiar a otra ficha del paciente sin dejar Evolución (la sección Ficha la sigue). */
    onSelectEpisode: (String) -> Unit = onOpenEpisode,
) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf(emptyList<FilaEvolucion>()) }
    var loaded by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var edit by remember { mutableStateOf<ObservationEdit?>(null) }
    var draft by remember { mutableStateOf<EvolutionDraft?>(null) }
    var othersExpanded by remember { mutableStateOf(false) }
    var reloadCount by remember { mutableIntStateOf(0) }
    var printing by remember { mutableStateOf(false) }

    LaunchedEffect(pacienteId, visible, reloadCount) {
        // Con una edición o un formulario abierto no se relee: se perdería el borrador.
        if (!visible || edit != null || draft != null) return@LaunchedEffect
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

    val groups = remember(rows) { EvolutionGrouping.group(rows) }
    val open = EvolutionGrouping.openEpisode(groups, currentEpisode)
    val others = EvolutionGrouping.others(groups, open)
    val busy = edit != null || draft != null
    val addReason = EvolutionGrouping.addDisabledReason(open, loaded, busy)

    fun saveObservations(current: ObservationEdit) {
        edit = current.copy(saving = true, error = null)
        scope.launch {
            val text = current.textToSave
            edit = try {
                if (current.evolutionId != null) {
                    api.editEvolution(current.evolutionId, text)
                } else {
                    api.saveObservations(pacienteId, current.episodeId, text)
                }
                rows = ObservationEdit.applySaved(rows, current.rowKey, text)
                null
            } catch (e: ApiError) {
                current.copy(saving = false, error = "No se pudo guardar: ${e.mensaje}")
            }
        }
    }

    fun saveEvolution(current: EvolutionDraft) {
        draft = current.copy(saving = true, error = null)
        scope.launch {
            draft = try {
                api.addEvolution(
                    episodeId = current.episodeId,
                    fecha = current.fecha,
                    hallazgos = current.hallazgos,
                    diagnostico = current.diagnostico,
                    tratamiento = current.tratamiento,
                    observaciones = current.observaciones,
                    proximoControlFecha = current.proximoControlFecha,
                    proximoControlMotivo = current.proximoControlMotivo,
                )
                // La primera evolución también guarda la cita inicial: se vuelve a pedir todo.
                reloadCount++
                null
            } catch (e: ApiError) {
                current.copy(saving = false, error = "No se pudo guardar la evolución: ${e.mensaje}")
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
                            !loaded -> "las citas de cada ficha: hallazgos, diagnóstico, tratamiento y observaciones"
                            groups.size == 1 -> "1 ficha"
                            else -> "${groups.size} fichas"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = { reloadCount++ }, enabled = !loading && !busy) { Text("Actualizar") }
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
            else -> LazyColumn(
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f),
            ) {
                error?.let { item(key = "error") { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) } }
                item(key = "header") {
                    EpisodeHeader(
                        open = open,
                        onOpenInFicha = { open?.let { onOpenEpisode(it.episodeId) } },
                        enabled = !busy,
                    )
                }
                item(key = "add") {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Button(
                            onClick = { open?.let { draft = EvolutionDraft.start(it.episodeId) } },
                            enabled = addReason == null,
                            modifier = Modifier.semantics { contentDescription = addReason ?: "Agregar una evolución a esta ficha" },
                        ) { Text("＋ Agregar evolución") }
                        Text(
                            addReason?.takeIf { draft == null && edit == null }
                                ?: "Para un control de este motivo. Para otro motivo de consulta, «＋ Nueva consulta» en el menú del paciente.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                draft?.let { current ->
                    item(key = "draft") {
                        EvolutionForm(
                            draft = current,
                            motivo = groups.firstOrNull { it.episodeId == current.episodeId }?.motivo,
                            api = api,
                            onChange = { draft = it },
                            onSave = { saveEvolution(current) },
                            onCancel = { draft = null },
                        )
                    }
                }
                if (open == null) {
                    item(key = "empty") {
                        Text(
                            "Este paciente todavía no tiene fichas registradas. «Imprimir» se habilita con la primera.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(open.rows, key = { it.rowKey }) { row ->
                        EvolutionCard(
                            row = row,
                            edit = edit?.takeIf { it.rowKey == row.rowKey },
                            editDisabledReason = ObservationEdit.editDisabledReason(edit, row, addingEvolution = draft != null),
                            onStartEdit = { edit = ObservationEdit.start(row) },
                            onDraft = { text -> edit = edit?.copy(draft = text) },
                            onSave = { edit?.let(::saveObservations) },
                            onCancel = { edit = null },
                        )
                    }
                }
                item(key = "others") {
                    OtherEpisodes(
                        others = others,
                        expanded = othersExpanded,
                        busy = busy,
                        onToggle = { othersExpanded = !othersExpanded },
                        onSelect = { id ->
                            othersExpanded = false
                            onSelectEpisode(id)
                        },
                    )
                }
            }
        }
    }

    if (printing) {
        PrintDialog(titulo = "Ficha de evolución", onClose = { printing = false }) {
            EvolutionDocument(
                pacienteId = pacienteId,
                currentEpisode = open?.episodeId ?: currentEpisode,
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

/** La cabecera de la ficha abierta: motivo, fecha de apertura y estado (PAPER §28.4). */
@Composable
private fun EpisodeHeader(open: EpisodeEvolutions?, onOpenInFicha: () -> Unit, enabled: Boolean) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        border = BorderStroke(2.dp, MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Ficha abierta", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            if (open == null) {
                Text("Sin fichas", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Abre una consulta para empezar la primera ficha.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(open.motivo ?: "Sin motivo registrado", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "Abierta el ${open.openedOn ?: "—"} · ${EpisodeEvolutions.estadoLabel(open.estado)} · " +
                        if (open.count == 1) "1 evolución" else "${open.count} evoluciones",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onOpenInFicha, enabled = enabled && open != null) {
                Text("Ver en la sección Ficha")
            }
            if (open == null) {
                Text("No hay ficha que abrir", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** El formulario de «＋ Agregar evolución» (PAPER §28.4). */
@Composable
private fun EvolutionForm(
    draft: EvolutionDraft,
    motivo: String?,
    api: CepiApi,
    onChange: (EvolutionDraft) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    val enabled = !draft.saving
    Card(
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Nueva evolución", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            motivo?.let { Text("Ficha: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

            Etiqueta("Fecha de la cita")
            CampoFecha(draft.fecha, { onChange(draft.copy(fecha = it)) }, enabled)
            TextoLargo("Hallazgos", draft.hallazgos, "Lo que se encontró en la cita", enabled) { onChange(draft.copy(hallazgos = it)) }
            Etiqueta("Diagnóstico")
            CampoCIE10(
                CampoFormulario(etiqueta = "Diagnóstico"),
                draft.diagnostico,
                { onChange(draft.copy(diagnostico = it)) },
                api,
                enabled,
            )
            TextoLargo("Tratamiento", draft.tratamiento, "Lo indicado en esta cita", enabled) { onChange(draft.copy(tratamiento = it)) }
            TextoLargo("Observaciones", draft.observaciones, "Resumen de lo más importante", enabled) { onChange(draft.copy(observaciones = it)) }
            Etiqueta("Próximo control")
            CampoFecha(draft.proximoControlFecha, { onChange(draft.copy(proximoControlFecha = it)) }, enabled)
            OutlinedTextField(
                value = draft.proximoControlMotivo,
                onValueChange = { onChange(draft.copy(proximoControlMotivo = it)) },
                enabled = enabled,
                singleLine = true,
                placeholder = { Text("Motivo del próximo control") },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = "Motivo del próximo control" },
            )
            draft.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onSave, enabled = draft.saveDisabledReason == null) {
                    Text(if (draft.saving) "Guardando…" else "Guardar")
                }
                OutlinedButton(onClick = onCancel, enabled = enabled) { Text("Cancelar") }
            }
            draft.saveDisabledReason?.takeIf { !draft.saving }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun Etiqueta(texto: String) {
    Text(texto, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun TextoLargo(etiqueta: String, valor: String, placeholder: String, enabled: Boolean, onChange: (String) -> Unit) {
    Etiqueta(etiqueta)
    OutlinedTextField(
        value = valor,
        onValueChange = onChange,
        enabled = enabled,
        placeholder = { Text(placeholder) },
        minLines = 2,
        maxLines = 8,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = etiqueta },
    )
}

/**
 * «Otras fichas del paciente», plegadas: una línea por ficha (motivo, fecha, estado, cuántas
 * evoluciones). Tocar una cambia a esa ficha. Sin otras fichas el encabezado queda gris con el
 * motivo, no se esconde.
 */
@Composable
private fun OtherEpisodes(
    others: List<EpisodeEvolutions>,
    expanded: Boolean,
    busy: Boolean,
    onToggle: () -> Unit,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        TextButton(onClick = onToggle, enabled = others.isNotEmpty()) {
            Text((if (expanded && others.isNotEmpty()) "▾ " else "▸ ") + "Otras fichas del paciente (${others.size})")
        }
        when {
            others.isEmpty() -> Text(
                "Única ficha de este paciente",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            expanded -> {
                if (busy) {
                    Text(
                        "Termina primero lo que estás editando para cambiar de ficha",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                others.forEach { group ->
                    Surface(
                        shape = MaterialTheme.shapes.small,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable(enabled = !busy, onClickLabel = "Cambiar a esta ficha") { onSelect(group.episodeId) },
                    ) {
                        Text(
                            group.summary,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 2,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EvolutionCard(
    row: FilaEvolucion,
    edit: ObservationEdit?,
    editDisabledReason: String?,
    onStartEdit: () -> Unit,
    onDraft: (String) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.fecha ?: "—", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (row.esInicial == true || row.evolutionId == null) {
                    Text("Primera cita", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                }
            }
            Dato("Atendió", row.medico ?: if (row.especialista == null) "—" else null, vacio = row.medico == null && row.especialista == null)
            row.especialista?.let { Text("Especialista: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            row.hallazgos?.takeIf { it.isNotBlank() }?.let { Dato("Hallazgos", it, vacio = false) }
            Dato("Diagnóstico clínico", row.diagnostico ?: "Sin diagnóstico", vacio = row.diagnostico == null)
            Dato("Diagnóstico histopatológico", row.histopathology ?: "Sin biopsia", vacio = row.histopathology == null)
            Dato("Tratamiento", row.tratamiento ?: "Sin tratamiento", vacio = row.tratamiento == null)
            if (row.proximoControlFecha != null || row.proximoControlMotivo != null) {
                Dato(
                    "Próximo control",
                    listOfNotNull(row.proximoControlFecha, row.proximoControlMotivo?.takeIf { it.isNotBlank() }).joinToString(" · "),
                    vacio = false,
                )
            }

            Text("Observaciones", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (edit != null) {
                OutlinedTextField(
                    value = edit.draft,
                    onValueChange = onDraft,
                    enabled = !edit.saving,
                    placeholder = { Text("Resumen de lo más importante de esta cita") },
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
                            contentDescription = editDisabledReason ?: "Editar las observaciones de esta cita"
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
