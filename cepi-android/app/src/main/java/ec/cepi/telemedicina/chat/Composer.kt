package ec.cepi.telemedicina.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.Adjunto

/**
 * Caja de texto y acciones del hilo. Lo que no aplica se ve gris y el pie dice por qué
 * (CLAUDE.md: nunca ocultes un botón). El dictado no aparece hasta que exista (fase 4): un
 * micrófono gris con "llega después" se lee como función a medias.
 */
@Composable
fun Composer(
    texto: String,
    alCambiar: (String) -> Unit,
    ocupado: Boolean,
    subiendo: Boolean,
    adjunto: Adjunto?,
    hayCamara: Boolean,
    alElegirFoto: () -> Unit,
    alTomarFoto: () -> Unit,
    alQuitarAdjunto: () -> Unit,
    alEnviar: () -> Unit,
) {
    val puedeEnviar = !ocupado && !subiendo && (texto.isNotBlank() || adjunto != null)

    Surface(tonalElevation = 3.dp) {
        Column(
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (adjunto != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(painterResource(R.drawable.ic_galeria), contentDescription = null, modifier = Modifier.size(16.dp))
                    Text(
                        adjunto.nombre,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .weight(1f)
                            .padding(start = 6.dp),
                    )
                    TextButton(onClick = alQuitarAdjunto) { Text("Quitar") }
                }
            }

            OutlinedTextField(
                value = texto,
                onValueChange = alCambiar,
                placeholder = { Text("Escribe o pega un texto largo…") },
                maxLines = 8,
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = "Mensaje" },
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = alElegirFoto, enabled = !ocupado && !subiendo) {
                    Icon(painterResource(R.drawable.ic_galeria), contentDescription = "Adjuntar foto de la galería")
                }
                IconButton(onClick = alTomarFoto, enabled = hayCamara && !ocupado && !subiendo) {
                    Icon(painterResource(R.drawable.ic_camara), contentDescription = "Tomar foto")
                }
                Spacer(Modifier.weight(1f))
                Button(onClick = alEnviar, enabled = puedeEnviar) {
                    if (subiendo) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Enviar")
                }
            }

            if (!hayCamara) {
                Text(
                    "Cámara: este dispositivo no tiene",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
