package ec.cepi.telemedicina.notificaciones

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.Recordatorio
import kotlinx.coroutines.launch

/** Los avisos propios: derivaciones recibidas y próximos controles (Notifications.vue). */
class BandejaModelo(private val api: CepiApi) {
    var avisos: List<Recordatorio> by mutableStateOf(emptyList())
        private set
    var cargado: Boolean by mutableStateOf(false)
        private set
    var error: String? by mutableStateOf(null)
        private set
    /** Los que se están marcando como vistos o abriendo. */
    var ocupados: Set<String> by mutableStateOf(emptySet())
        private set

    val pendientes: Int get() = avisos.count { it.activo }

    suspend fun cargar(usuario: String) {
        try {
            avisos = api.recordatorios(usuario).sortedByDescending { it.creado.orEmpty() }
            cargado = true
            error = null
        } catch (e: ApiError) {
            // Un refresco que falla no borra lo que se está viendo.
            if (!cargado) error = e.mensaje
        }
    }

    suspend fun marcarVisto(aviso: Recordatorio) {
        ocupados = ocupados + aviso.id
        try {
            api.completarRecordatorio(aviso.id)
            avisos = avisos.map { if (it.id == aviso.id) it.copy(estado = "done") else it }
            error = null
        } catch (e: ApiError) {
            error = "No se pudo marcar como visto: ${e.mensaje}"
        } finally {
            ocupados = ocupados - aviso.id
        }
    }

    /** De qué paciente es el aviso: su `entity_id` es el episodio o el paciente. */
    suspend fun paciente(aviso: Recordatorio): String? {
        val entidad = aviso.entidad ?: return null
        ocupados = ocupados + aviso.id
        return try {
            api.pacienteDeAviso(entidad).paciente
        } catch (e: ApiError) {
            error = "No se pudo abrir el paciente: ${e.mensaje}"
            null
        } finally {
            ocupados = ocupados - aviso.id
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BandejaHoja(modelo: BandejaModelo, alAbrirPaciente: (String) -> Unit, alCerrar: () -> Unit) {
    val alcance = rememberCoroutineScope()
    ModalBottomSheet(onDismissRequest = alCerrar) {
        Text(
            "Notificaciones",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        modelo.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp))
        }
        when {
            !modelo.cargado && modelo.error == null -> CircularProgressIndicator(Modifier.padding(16.dp))
            modelo.avisos.isEmpty() -> Text(
                "No tienes notificaciones.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp),
            )
        }
        LazyColumn {
            items(modelo.avisos, key = { it.id }) { aviso ->
                val ocupado = aviso.id in modelo.ocupados
                Column(
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = aviso.entidad != null && !ocupado) {
                            alcance.launch {
                                modelo.paciente(aviso)?.let {
                                    alCerrar()
                                    alAbrirPaciente(it)
                                }
                            }
                        }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            aviso.titulo,
                            fontWeight = if (aviso.activo) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (aviso.activo) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        Text(aviso.etiquetaEstado, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    aviso.quienDerivo?.let { Text("Derivó: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                    aviso.mensaje?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            Fechas.iso(aviso.vence)?.let { "Vence ${Fechas.textoCorto(it)}" }.orEmpty(),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        // Siempre a la vista: gris cuando ya está vista.
                        if (ocupado) {
                            CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp)
                        } else {
                            OutlinedButton(onClick = { alcance.launch { modelo.marcarVisto(aviso) } }, enabled = aviso.activo) {
                                Text(if (aviso.activo) "Visto" else "Vista")
                            }
                        }
                    }
                }
                HorizontalDivider()
            }
        }
        TextButton(onClick = alCerrar, modifier = Modifier.padding(8.dp)) { Text("Cerrar") }
    }
}
