package ec.cepi.telemedicina.app

import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.ApiError
import kotlinx.coroutines.launch

private const val EXPLICACION =
    "Se borran tu email, teléfono y cédula, tu acceso con contraseña o con Google, tus " +
        "organizaciones y las notificaciones en tus dispositivos. No se puede deshacer.\n\n" +
        "Las historias clínicas que registraste no se borran: pertenecen al paciente y a la " +
        "institución, y la ley obliga a conservarlas. Por eso en ellas sigue tu nombre como " +
        "profesional que atendió."

/**
 * Borrar la cuenta desde la app (Play y App Store lo exigen): el login con Google crea
 * cuentas, así que también tienen que poder borrarse acá. Lo usan el menú de la cuenta y la
 * pantalla de cuenta pendiente. Si el servidor no borra, la sesión sigue y el motivo se muestra
 * tal cual.
 */
@Composable
fun DialogoEliminarCuenta(sesion: Sesion, alCerrar: () -> Unit) {
    val alcance = rememberCoroutineScope()
    var eliminando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val fallo = error
    if (fallo != null) {
        AlertDialog(
            onDismissRequest = alCerrar,
            title = { Text("No se pudo eliminar la cuenta") },
            text = { Text(fallo) },
            confirmButton = { TextButton(onClick = alCerrar) { Text("Aceptar") } },
        )
        return
    }

    AlertDialog(
        onDismissRequest = { if (!eliminando) alCerrar() },
        title = { Text("¿Eliminar tu cuenta?") },
        text = { Text(EXPLICACION) },
        confirmButton = {
            TextButton(
                enabled = !eliminando,
                onClick = {
                    eliminando = true
                    alcance.launch {
                        try {
                            sesion.eliminarCuenta()
                        } catch (e: ApiError) {
                            error = e.mensaje
                        } finally {
                            eliminando = false
                        }
                    }
                },
            ) {
                if (eliminando) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("Eliminar cuenta", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = alCerrar, enabled = !eliminando) { Text("Cancelar") }
        },
    )
}
