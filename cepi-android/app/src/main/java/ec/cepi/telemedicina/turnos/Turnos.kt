package ec.cepi.telemedicina.turnos

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.Shift
import ec.cepi.telemedicina.api.Usuario
import kotlinx.coroutines.launch
import java.time.LocalDate

/**
 * Calendario de turnos (PAPER §32): quién está de llamada cada semana en un grupo. Una
 * derivación al grupo avisa solo a quien está de turno ese día. Sin `groups:manage_shifts`
 * los controles de edición no aparecen (la excepción de permisos de «nunca ocultes un botón»).
 */
@Composable
fun Turnos(model: ShiftsModel, user: Usuario?, organization: String?, padding: PaddingValues) {
    val scope = rememberCoroutineScope()
    val canEdit = user?.puede(ShiftCalendar.EDIT_PERMISSION) == true
    // A quién se eligió en cada semana, por su lunes.
    val selection = remember { mutableStateMapOf<LocalDate, String>() }

    // Volver a la sección (o cambiar de org) recarga, como la Galería.
    LaunchedEffect(organization) { model.start() }

    Column(
        Modifier
            .padding(padding)
            .fillMaxSize(),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            GroupPicker(model) { slug ->
                selection.clear()
                scope.launch { model.selectGroup(slug) }
            }
            Text(
                buildString { append("De turno hoy: "); append(model.onCallText) },
                style = MaterialTheme.typography.bodyMedium,
            )
            model.notice?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (model.noticeIsError) MaterialTheme.colorScheme.error else SuccessGreen,
                )
            }
        }

        val error = model.error
        val weeks = model.weeks
        when {
            error != null -> Column(Modifier.padding(16.dp)) {
                Text(error, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { scope.launch { model.retry() } }, enabled = !model.loading) { Text("Reintentar") }
            }
            weeks.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    when {
                        model.loadingGroups -> "Cargando grupos…"
                        model.groups.isEmpty() -> "No hay grupos con turnos"
                        else -> "Cargando turnos…"
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(weeks, key = { it.start.toString() }) { week ->
                    WeekCard(
                        week = week,
                        model = model,
                        canEdit = canEdit,
                        selected = selection[week.start],
                        onSelect = { selection[week.start] = it },
                        onAssign = { memberId ->
                            scope.launch { if (model.assign(week, memberId)) selection.remove(week.start) }
                        },
                        onRemove = { shift -> scope.launch { model.remove(shift) } },
                    )
                }
            }
        }
    }
}

/** Verde de los mensajes de resultado, el mismo de la web. */
private val SuccessGreen = Color(0xFF15803D)

@Composable
private fun GroupPicker(model: ShiftsModel, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val current = model.groups.firstOrNull { it.slug == model.group }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = model.groups.isNotEmpty()) {
            Text(
                current?.nombre ?: if (model.loadingGroups) "Cargando grupos…" else "Sin grupos",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Icon(Icons.Filled.ArrowDropDown, contentDescription = "Elegir grupo")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            model.groups.forEach { g ->
                DropdownMenuItem(text = { Text(g.nombre) }, onClick = {
                    open = false
                    onSelect(g.slug)
                })
            }
        }
    }
}

@Composable
private fun WeekCard(
    week: ShiftWeek,
    model: ShiftsModel,
    canEdit: Boolean,
    selected: String?,
    onSelect: (String) -> Unit,
    onAssign: (String) -> Unit,
    onRemove: (Shift) -> Unit,
) {
    val accent = MaterialTheme.colorScheme.primary
    OutlinedCard(
        modifier = Modifier.fillMaxWidth(),
        border = if (week.current) BorderStroke(2.dp, accent) else CardDefaults.outlinedCardBorder(),
        colors = if (week.current) {
            CardDefaults.outlinedCardColors(containerColor = accent.copy(alpha = 0.08f))
        } else {
            CardDefaults.outlinedCardColors()
        },
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(ShiftCalendar.weekLabel(week), fontWeight = FontWeight.SemiBold)
                if (week.current) {
                    Spacer(Modifier.width(8.dp))
                    Surface(color = accent, shape = MaterialTheme.shapes.extraLarge) {
                        Text(
                            "Esta semana",
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                }
            }

            if (week.shifts.isEmpty()) {
                Text("Sin asignar", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            }
            week.shifts.forEach { shift ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(shift.displayName, style = MaterialTheme.typography.bodyMedium)
                    if (ShiftCalendar.isPartial(shift, week)) {
                        Text(
                            " " + ShiftCalendar.partialLabel(shift),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (canEdit) {
                        val reason = ShiftCalendar.removeDisabledReason(model.busy)
                        IconButton(onClick = { onRemove(shift) }, enabled = reason == null, modifier = Modifier.size(36.dp)) {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = reason ?: "Quitar a ${shift.displayName} de este turno",
                                tint = if (reason == null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }

            if (canEdit) AssignRow(week, model, selected, onSelect, onAssign)
        }
    }
}

@Composable
private fun AssignRow(
    week: ShiftWeek,
    model: ShiftsModel,
    selected: String?,
    onSelect: (String) -> Unit,
    onAssign: (String) -> Unit,
) {
    val free = ShiftCalendar.freeMembers(week, model.members)
    // Si quien estaba elegido ya quedó en la semana, la elección no vale.
    val chosen = selected?.takeIf { id -> free.any { it.id == id } }
    val pickerReason = ShiftCalendar.pickerDisabledReason(model.busy, free.size)
    val assignReason = ShiftCalendar.assignDisabledReason(model.busy, free.size, chosen)
    var open by remember { mutableStateOf(false) }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f)) {
            OutlinedButton(onClick = { open = true }, enabled = pickerReason == null, modifier = Modifier.fillMaxWidth()) {
                Text(
                    free.firstOrNull { it.id == chosen }?.name ?: if (free.isEmpty()) "Sin miembros libres" else "Elegir…",
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(Icons.Filled.ArrowDropDown, contentDescription = "Asignar semana del ${ShiftCalendar.weekLabel(week)}")
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                free.forEach { member ->
                    DropdownMenuItem(text = { Text(member.name) }, onClick = {
                        open = false
                        onSelect(member.id)
                    })
                }
            }
        }
        Button(onClick = { chosen?.let(onAssign) }, enabled = assignReason == null) { Text("Asignar") }
    }
    assignReason?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
