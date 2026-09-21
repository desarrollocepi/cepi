package ec.cepi.telemedicina.app

import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.painterResource
import ec.cepi.telemedicina.R
import kotlinx.coroutines.launch

/**
 * La cuenta existe pero nadie le asignó un rol clínico todavía. Equivale a
 * `PendingApproval.vue`. Es donde cae una cuenta recién creada con Google, así que también
 * ofrece borrarla.
 */
@Composable
fun Pendiente(sesion: Sesion) {
    val alcance = rememberCoroutineScope()
    var confirmarBorrado by remember { mutableStateOf(false) }

    Aviso(
        icono = painterResource(R.drawable.ic_reloj_arena),
        titulo = "Cuenta pendiente de aprobación",
        descripcion = "Un administrador de CEPI tiene que asignarte un rol antes de que puedas ver pacientes.",
    ) {
        Button(onClick = { alcance.launch { sesion.renovar() } }) { Text("Volver a comprobar") }
        TextButton(onClick = { alcance.launch { sesion.salir() } }) {
            Text("Cerrar sesión", color = MaterialTheme.colorScheme.error)
        }
        TextButton(onClick = { confirmarBorrado = true }) {
            Text("Eliminar cuenta", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }

    if (confirmarBorrado) DialogoEliminarCuenta(sesion) { confirmarBorrado = false }
}
