package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.ClinicalPriority
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.app.color
import kotlinx.coroutines.launch

/**
 * Cuándo se puede responder la interconsulta (PAPER §30), igual que `responderMotivo` de
 * `IntakeChat.vue`. Sin UI, para poder probarlo.
 */
object ConsultationAnswer {
    /** Estados en los que el caso espera a un especialista (como cepi-bot `interconsulta.ts`). */
    val PENDING_STATES = setOf("enviada", "en_triage", "derivada", "en_revisión_solicitada")

    /**
     * Por qué hoy no se puede responder, o `null` si se puede. `episode` es el registro del
     * episodio activo; `null` mientras se carga.
     */
    fun disabledReason(episodeId: String?, episode: Registro?, userId: String?): String? {
        if (episodeId == null) return "Elige un paciente con una consulta abierta"
        if (episode == null) return "Cargando el estado de la consulta…"
        val estado = episode["estado"]
        if (estado == "respondida") return "Esta interconsulta ya fue respondida"
        // El responsable de turno del caso nuevo responde aunque no se haya enviado (PAPER §32.2.1).
        val isResponsible = userId != null && episode["responsable_actual_id"] == userId && estado != "cerrado"
        if (estado !in PENDING_STATES && !isResponsible) return "Esta consulta no tiene una interconsulta pendiente"
        if (userId != null && (episode["medico_primario_id"] ?: episode["medico_id"]) == userId) {
            return "Tú ingresaste este caso: lo responde el especialista responsable"
        }
        return null
    }

    /** El aviso tras responder, como `onRespondida` de la web. */
    fun confirmation(notified: Boolean): String =
        if (notified) {
            "Interconsulta respondida: quedó en la ficha y en la evolución, y se avisó al médico que envió el caso."
        } else {
            "Interconsulta respondida: quedó en la ficha y en la evolución."
        }
}

/**
 * «Responder interconsulta» (PAPER §30.2, `ResponderInterconsulta.vue`): la respuesta queda en la
 * ficha y en la evolución, no solo en el chat, y se apaga la campana de "revisar". Viene
 * precargado con lo que la ficha ya tiene; un campo vacío no borra. Si falla, la hoja sigue
 * abierta con el mensaje del servidor.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsultationAnswerSheet(
    api: CepiApi,
    episode: Registro,
    /** Respondida: `notified` dice si se avisó al médico que envió el caso. */
    onAnswered: (notified: Boolean) -> Unit,
    onClose: () -> Unit,
) {
    val alcance = rememberCoroutineScope()
    var diagnostico by remember { mutableStateOf(episode["diagnostico"].orEmpty()) }
    var tratamiento by remember { mutableStateOf(episode["tratamiento_resumen"].orEmpty()) }
    var recomendacion by remember { mutableStateOf("") }
    var observaciones by remember { mutableStateOf(episode["observaciones"].orEmpty()) }
    // PAPER §34: opcional; precargada con la del episodio si ya tiene.
    var prioridad by remember { mutableStateOf(ClinicalPriority.of(episode["prioridad"])) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val estadoHoja = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !saving })

    fun send() {
        if (recomendacion.isBlank() || saving) return
        saving = true
        error = null
        alcance.launch {
            try {
                val resultado = api.answerConsultation(
                    episode.id, recomendacion, diagnostico, tratamiento, observaciones, prioridad?.value.orEmpty(),
                )
                onAnswered(resultado.notified)
            } catch (e: ApiError) {
                error = e.mensaje
            } finally {
                saving = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!saving) onClose() }, sheetState = estadoHoja) {
        Column(Modifier.imePadding()) {
            // Responder en la barra y no al pie: el teclado no lo tapa.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
            ) {
                TextButton(onClick = onClose, enabled = !saving) { Text("Cancelar") }
                Text(
                    "Responder interconsulta",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                Button(onClick = { send() }, enabled = !saving && recomendacion.isNotBlank()) {
                    if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Responder")
                }
            }
            Column(
                Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text(
                    "Se guarda en la ficha de esta consulta y le llega al médico que envió el caso.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val frases = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences)
                OutlinedTextField(
                    value = diagnostico,
                    onValueChange = { diagnostico = it },
                    label = { Text("Diagnóstico clínico") },
                    placeholder = { Text("Ej.: D22.5 — Nevus atípico") },
                    enabled = !saving,
                    keyboardOptions = frases,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                PrioritySelector(
                    selected = prioridad,
                    enabled = !saving,
                    onSelect = { prioridad = it },
                    modifier = Modifier.padding(top = 12.dp),
                )
                OutlinedTextField(
                    value = tratamiento,
                    onValueChange = { tratamiento = it },
                    label = { Text("Tratamiento") },
                    enabled = !saving,
                    minLines = 2,
                    keyboardOptions = frases,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                OutlinedTextField(
                    value = recomendacion,
                    onValueChange = { recomendacion = it },
                    label = { Text("Respuesta e indicaciones (obligatoria)") },
                    placeholder = { Text("Qué debe hacer el médico que envió el caso") },
                    supportingText = if (recomendacion.isBlank()) {
                        { Text("Escribe la respuesta para el médico que envió el caso") }
                    } else {
                        null
                    },
                    enabled = !saving,
                    minLines = 4,
                    keyboardOptions = frases,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                OutlinedTextField(
                    value = observaciones,
                    onValueChange = { observaciones = it },
                    label = { Text("Observaciones") },
                    placeholder = { Text("Resumen de lo más importante (sale en la evolución)") },
                    enabled = !saving,
                    minLines = 2,
                    keyboardOptions = frases,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                error?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
                    )
                }
            }
        }
    }
}

/** «Prioridad clínica» (PAPER §34): las tres opciones, cada una con su guía corta. */
@Composable
private fun PrioritySelector(
    selected: ClinicalPriority?,
    enabled: Boolean,
    onSelect: (ClinicalPriority) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
            .padding(8.dp)
            .selectableGroup(),
    ) {
        Text("Prioridad clínica", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(start = 4.dp))
        ClinicalPriority.entries.forEach { opcion ->
            Row(
                verticalAlignment = Alignment.Top,
                modifier = Modifier
                    .fillMaxWidth()
                    .selectable(
                        selected = selected == opcion,
                        enabled = enabled,
                        role = Role.RadioButton,
                        onClick = { onSelect(opcion) },
                    )
                    .padding(vertical = 4.dp),
            ) {
                RadioButton(selected = selected == opcion, onClick = null, enabled = enabled, modifier = Modifier.padding(4.dp))
                Column(Modifier.padding(start = 4.dp, top = 2.dp)) {
                    Text(
                        opcion.value,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = opcion.color,
                    )
                    Text(
                        opcion.guide,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
