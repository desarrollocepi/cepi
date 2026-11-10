package ec.cepi.telemedicina.pacientes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Registro
import kotlinx.coroutines.launch

/**
 * Alta mínima: nombre, apellidos, cédula y celular (email opcional), igual que ChatList.vue
 * (PAPER §36.1). El celular es para avisarle de sus citas. El resto de la ficha lo pide el
 * asistente después.
 */
@Composable
fun NuevoPaciente(api: CepiApi, alCerrar: () -> Unit, alCrear: (Registro) -> Unit) {
    val alcance = rememberCoroutineScope()
    var nombre by rememberSaveable { mutableStateOf("") }
    var apellidos by rememberSaveable { mutableStateOf("") }
    var cedula by rememberSaveable { mutableStateOf("") }
    var celular by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var creando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val motivo = Contacto.blocker(nombre, apellidos, cedula, celular, email)

    fun crear() {
        if (motivo != null || creando) return
        creando = true
        error = null
        alcance.launch {
            try {
                val registro = api.crearPaciente(
                    nombre.trim(), apellidos.trim(), cedula.trim(),
                    celular = Contacto.normalizeMobile(celular) ?: celular.trim(),
                    email = email.trim(),
                )
                alCrear(registro)
                alCerrar()
            } catch (e: ApiError) {
                error = e.mensaje
            } finally {
                creando = false
            }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!creando) alCerrar() },
        title = { Text("Nuevo paciente") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = nombre,
                    onValueChange = { nombre = it },
                    label = { Text("Nombre") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                )
                OutlinedTextField(
                    value = apellidos,
                    onValueChange = { apellidos = it },
                    label = { Text("Apellidos") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                )
                OutlinedTextField(
                    value = cedula,
                    onValueChange = { cedula = it },
                    label = { Text("Cédula") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                        autoCorrectEnabled = false,
                        imeAction = ImeAction.Next,
                    ),
                )
                OutlinedTextField(
                    value = celular,
                    onValueChange = { celular = it },
                    label = { Text("Celular (09…)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email (opcional)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        autoCorrectEnabled = false,
                        imeAction = ImeAction.Done,
                    ),
                )
                Text(
                    motivo ?: "El celular es para avisarle de sus citas. El resto de la ficha lo completa el asistente.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = { crear() }, enabled = motivo == null && !creando) {
                if (creando) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Crear")
            }
        },
        dismissButton = { TextButton(onClick = alCerrar, enabled = !creando) { Text("Cancelar") } },
    )
}
