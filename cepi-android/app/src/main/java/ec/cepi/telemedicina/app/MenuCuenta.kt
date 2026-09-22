package ec.cepi.telemedicina.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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

/**
 * Cuenta y organización activa, en la barra superior. El selector de organización se muestra
 * siempre: con una sola, gris y diciendo por qué no hay a cuál cambiar (CLAUDE.md: nunca
 * ocultes un botón). Los diálogos (borrar la cuenta, error al cambiar de org) los presenta
 * quien contiene la barra.
 */
@Composable
fun MenuCuenta(
    sesion: Sesion,
    /** El estado del push para mostrarlo; `null` = apagado por permiso, con el botón a los ajustes. */
    notificaciones: String?,
    alAbrirAjustesDeNotificaciones: () -> Unit,
    alEliminarCuenta: () -> Unit,
    alFallarCambio: (String) -> Unit,
) {
    val alcance = rememberCoroutineScope()
    var abierto by remember { mutableStateOf(false) }
    val usuario = sesion.usuario

    Box {
        IconButton(onClick = { abierto = true }) {
            Icon(Icons.Filled.AccountCircle, contentDescription = "Cuenta")
        }
        DropdownMenu(expanded = abierto, onDismissRequest = { abierto = false }) {
            if (usuario != null) {
                Text(
                    usuario.email,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
                Text(
                    "Organización",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
                if (usuario.orgs.size > 1) {
                    usuario.orgs.forEach { org ->
                        val activa = org.id == usuario.orgActiva
                        DropdownMenuItem(
                            text = { Text(org.name) },
                            leadingIcon = {
                                if (activa) Icon(Icons.Filled.Check, contentDescription = "Activa") else Spacer(Modifier.size(24.dp))
                            },
                            onClick = {
                                abierto = false
                                if (!activa) {
                                    alcance.launch {
                                        try {
                                            sesion.cambiarOrganizacion(org.id)
                                        } catch (e: ApiError) {
                                            alFallarCambio(e.mensaje)
                                        }
                                    }
                                }
                            },
                        )
                    }
                } else {
                    DropdownMenuItem(
                        enabled = false,
                        onClick = {},
                        leadingIcon = { Icon(Icons.Filled.Check, contentDescription = null) },
                        text = {
                            Column {
                                Text(usuario.orgs.firstOrNull()?.name ?: "Sin organización")
                                Text("Única organización de tu cuenta", style = MaterialTheme.typography.bodySmall)
                            }
                        },
                    )
                }
                HorizontalDivider()
            }
            DropdownMenuItem(
                text = {
                    Column {
                        Text(notificaciones ?: "Notificaciones desactivadas")
                        if (notificaciones == null) Text("Tocar para activarlas en Ajustes", style = MaterialTheme.typography.bodySmall)
                    }
                },
                leadingIcon = { Icon(Icons.Filled.Notifications, contentDescription = null) },
                enabled = notificaciones == null,
                onClick = {
                    abierto = false
                    alAbrirAjustesDeNotificaciones()
                },
            )
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text("Cerrar sesión") },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = null) },
                onClick = {
                    abierto = false
                    alcance.launch { sesion.salir() }
                },
            )
            DropdownMenuItem(
                text = { Text("Eliminar cuenta", color = MaterialTheme.colorScheme.error) },
                leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                onClick = {
                    abierto = false
                    alEliminarCuenta()
                },
            )
        }
    }
}
