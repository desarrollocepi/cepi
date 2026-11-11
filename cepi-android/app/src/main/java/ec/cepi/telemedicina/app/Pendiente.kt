package ec.cepi.telemedicina.app

import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
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
    var error by remember { mutableStateOf<String?>(null) }
    val otrasOrgs = sesion.usuario?.otrasOrgsAprobadas.orEmpty()

    Aviso(
        icono = painterResource(R.drawable.ic_reloj_arena),
        titulo = "Cuenta pendiente de aprobación",
        descripcion = "Un administrador de CEPI tiene que asignarte un rol antes de que puedas ver pacientes.",
    ) {
        // Si ya tiene rol en otra organización real, entra a ella a propósito: la sesión
        // nunca lo lleva sola a otra org (PAPER §13.8).
        otrasOrgs.forEach { org ->
            Button(
                enabled = !sesion.cambiandoOrganizacion,
                onClick = {
                    error = null
                    alcance.launch {
                        runCatching { sesion.cambiarOrganizacion(org.id) }
                            .onFailure { error = "No se pudo cambiar de organización." }
                    }
                },
            ) { Text("Entrar a ${org.name}") }
        }
        if (sesion.cambiandoOrganizacion) {
            Text("Cambiando de organización…", style = MaterialTheme.typography.bodySmall)
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        if (otrasOrgs.isEmpty()) {
            Button(onClick = { alcance.launch { sesion.renovar() } }) { Text("Volver a comprobar") }
        } else {
            OutlinedButton(onClick = { alcance.launch { sesion.renovar() } }) { Text("Volver a comprobar") }
        }
        TextButton(onClick = { alcance.launch { sesion.salir() } }) {
            Text("Cerrar sesión", color = MaterialTheme.colorScheme.error)
        }
        TextButton(onClick = { confirmarBorrado = true }) {
            Text("Eliminar cuenta", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }

    if (confirmarBorrado) DialogoEliminarCuenta(sesion) { confirmarBorrado = false }
}
