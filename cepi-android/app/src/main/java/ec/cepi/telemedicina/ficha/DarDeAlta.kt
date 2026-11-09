package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Registro
import kotlinx.coroutines.launch

/**
 * Cuándo se puede dar el alta (PAPER §35), igual que `altaMotivo` de `IntakeChat.vue`. Sin UI,
 * para poder probarlo.
 */
object PatientDischarge {
    /** El aviso tras el alta, el mismo mensaje que agrega la web al hilo. */
    const val CONFIRMATION =
        "🏁 Alta registrada. Desde mañana el paciente no sale en la lista; si vuelve, abre una consulta nueva."

    /**
     * Por qué hoy no se puede dar el alta, o `null` si se puede. `episode` es el registro del
     * episodio activo; `null` mientras se carga.
     */
    fun disabledReason(episodeId: String?, episode: Registro?): String? {
        if (episodeId == null) return "Elige un paciente con una consulta abierta"
        if (episode == null) return "Cargando el estado de la consulta…"
        if (episode["estado"] == "alta") return "Este paciente ya está de alta. Si vuelve, abre una consulta nueva"
        return null
    }

    /** El texto de ayuda del diálogo, como `DarDeAlta.vue`. */
    fun help(patientName: String?): String =
        "Se cierra esta consulta. Desde mañana ${patientName?.takeIf { it.isNotBlank() } ?: "el paciente"} " +
            "no sale en la lista; se lo encuentra buscándolo o en el filtro «Alta». Si vuelve, se abre una " +
            "consulta nueva con su propio motivo."
}

/**
 * «🏁 Dar de alta» (PAPER §35.2, `DarDeAlta.vue`): confirmación con nota opcional. Si falla,
 * el diálogo sigue abierto con el mensaje del servidor.
 */
@Composable
fun DischargeDialog(
    api: CepiApi,
    episodeId: String,
    patientName: String?,
    onDischarged: () -> Unit,
    onClose: () -> Unit,
) {
    val alcance = rememberCoroutineScope()
    var nota by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun confirm() {
        if (saving) return
        saving = true
        error = null
        alcance.launch {
            try {
                api.dischargePatient(episodeId, nota)
                onDischarged()
            } catch (e: ApiError) {
                error = e.mensaje
            } finally {
                saving = false
            }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!saving) onClose() },
        properties = DialogProperties(dismissOnClickOutside = !saving, dismissOnBackPress = !saving),
        title = { Text("🏁 Dar de alta") },
        text = {
            Column {
                Text(
                    PatientDischarge.help(patientName),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = nota,
                    onValueChange = { nota = it },
                    label = { Text("Nota del alta (opcional)") },
                    placeholder = { Text("Ej.: Lesión resuelta, sin controles pendientes") },
                    enabled = !saving,
                    minLines = 3,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                )
                error?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { confirm() }, enabled = !saving) {
                if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Dar de alta")
            }
        },
        dismissButton = {
            TextButton(onClick = onClose, enabled = !saving) { Text("Cancelar") }
        },
    )
}
