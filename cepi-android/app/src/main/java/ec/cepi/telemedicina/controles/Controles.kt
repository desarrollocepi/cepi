package ec.cepi.telemedicina.controles

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.FollowUp
import kotlinx.coroutines.launch

/** Rojo de lo atrasado, el mismo de la web. */
private val OverdueRed = Color(0xFFDC2626)

/**
 * Próximos controles de los pacientes (PAPER §33): cuándo vuelve cada uno y qué hay que hacer,
 * para que el cambio de internos no pierda nada. Espejo de `Controles.vue`. Tocar una fila abre
 * al paciente en su Ficha.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Controles(model: FollowUpsModel, organization: String?, padding: PaddingValues, onOpenPatient: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var query by rememberSaveable { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }

    // Volver a la sección (o cambiar de org) recarga, como Turnos y la Galería.
    LaunchedEffect(organization) { model.load() }

    Column(
        Modifier
            .padding(padding)
            .fillMaxSize(),
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Paciente o cédula") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                IconButton(onClick = { query = "" }, enabled = query.isNotEmpty()) {
                    Icon(Icons.Filled.Clear, contentDescription = "Borrar búsqueda")
                }
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        )

        val error = model.error
        val groups = model.groups(query)
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch {
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            when {
                error != null -> Column(Modifier.padding(16.dp)) {
                    Text(error, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { scope.launch { model.load() } }, enabled = !model.loading) { Text("Reintentar") }
                }
                groups.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (model.loading && model.rows.isEmpty()) "Cargando controles…" else FollowUpSchedule.emptyText(query),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(24.dp),
                    )
                }
                else -> LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    groups.forEach { group ->
                        item(key = "g-${group.key}") { GroupTitle(group) }
                        items(group.rows, key = { "${group.key}-${it.episodeId}" }) { row ->
                            FollowUpRow(row) { row.patientId?.let(onOpenPatient) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GroupTitle(group: FollowUpGroup) {
    Row(Modifier.padding(top = 10.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            group.title.uppercase(),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            color = if (group.overdue) OverdueRed else MaterialTheme.colorScheme.onSurface,
        )
        Text(
            "  ${group.rows.size}",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun FollowUpRow(row: FollowUp, onClick: () -> Unit) {
    val enabled = row.patientId != null
    val stripe = when {
        row.overdue -> OverdueRed
        row.isToday -> MaterialTheme.colorScheme.primary
        else -> Color.Transparent
    }
    OutlinedCard(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.6f)
            .semantics {
                stateDescription = if (enabled) "Abrir la ficha del paciente" else "El paciente ya no está disponible"
            },
    ) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(
                Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(stripe),
            )
            Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        FollowUpSchedule.weekday(row.fechaControl).replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(FollowUpSchedule.longDate(row.fechaControl), style = MaterialTheme.typography.bodyMedium)
                    when {
                        row.overdue -> Chip("Atrasado", OverdueRed)
                        row.isToday -> Chip("Hoy", MaterialTheme.colorScheme.primary)
                    }
                }
                Text(
                    buildString {
                        append(row.paciente?.takeIf { it.isNotBlank() } ?: "Paciente sin nombre")
                        row.cedula?.takeIf { it.isNotBlank() }?.let { append(" · "); append(it) }
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(row.motivo?.takeIf { it.isNotBlank() } ?: "Sin indicación de qué hacer", style = MaterialTheme.typography.bodyMedium)
                row.plan?.takeIf { it.isNotBlank() }?.let {
                    Text("Plan: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                val meta = FollowUpSchedule.metaLine(row)
                if (meta.isNotEmpty()) {
                    Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (!enabled) {
                    Text("El paciente ya no está disponible", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun Chip(text: String, color: Color) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = Color.White,
        modifier = Modifier
            .background(color, RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 1.dp),
    )
}
