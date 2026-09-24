package ec.cepi.telemedicina.pacientes

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.Asignacion
import ec.cepi.telemedicina.api.PendienteRevision
import ec.cepi.telemedicina.app.Marca

/**
 * Una fila de la lista. El LED de la derecha es el estado de la ficha actual: va al costado y no
 * en una línea más, para que la fila no crezca. Borrar un paciente es de supermédico (D-Aux-23)
 * y va en el menú de pulsación larga; quien no puede, no lo ve: es la excepción por permisos de
 * la regla de no ocultar botones.
 */
@Composable
fun FilaPacienteVista(
    fila: FilaPaciente,
    revision: PendienteRevision?,
    asignacion: Asignacion?,
    estado: EstadoFicha,
    puedeBorrar: Boolean,
    alAbrir: () -> Unit,
    alBorrar: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }

    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = alAbrir,
                    onLongClick = if (puedeBorrar) ({ menu = true }) else null,
                    onLongClickLabel = if (puedeBorrar) "Eliminar paciente" else null,
                )
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(40.dp)
                    .background(MaterialTheme.colorScheme.primary, CircleShape)
                    .clearAndSetSemantics {},
            ) {
                Text(
                    fila.iniciales.ifEmpty { "?" },
                    color = MaterialTheme.colorScheme.onPrimary,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(Modifier.weight(1f)) {
                Text(
                    fila.nombre,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "CC: ${fila.cedula ?: "—"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                asignacion?.aCargo?.let { nombre ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(
                            iconoACargo(asignacion.origen),
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(14.dp),
                        )
                        Text(
                            nombre,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            if (revision != null) {
                Text(
                    "revisar",
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier
                        .background(Marca.revisar, RoundedCornerShape(50))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                        .semantics {
                            contentDescription = "${revision.pendientes} pendiente(s) de revisión derivadas a ti"
                        },
                )
            }

            LedEstado(
                estado,
                Modifier.semantics { contentDescription = "Ficha: ${estado.etiqueta}" },
            )
        }

        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text("Eliminar paciente", color = MaterialTheme.colorScheme.error) },
                leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                onClick = {
                    menu = false
                    alBorrar()
                },
            )
        }
    }
}

/** Cómo quedó a cargo, como `acargoMeta` en ChatList.vue. */
@Composable
private fun iconoACargo(origen: String?): Painter = when (origen) {
    "derivado_grupo" -> painterResource(R.drawable.ic_grupo)
    "derivado" -> rememberVectorPainter(Icons.AutoMirrored.Filled.ArrowForward)
    "creador" -> rememberVectorPainter(Icons.Filled.Person)
    else -> painterResource(R.drawable.ic_maletin_medico)
}
