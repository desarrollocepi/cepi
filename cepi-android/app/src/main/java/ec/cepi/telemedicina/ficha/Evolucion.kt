package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.FilaEvolucion

/**
 * La ficha de evolución del paciente (PAPER §28): fecha, médico, diagnóstico y tratamiento de
 * cada ficha, la más nueva primero. La ficha que se está viendo va resaltada; tocar otra lleva
 * el visor a esa.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EvolucionHoja(
    filas: List<FilaEvolucion>,
    cargando: Boolean,
    error: String?,
    actual: String?,
    alElegir: (FilaEvolucion) -> Unit,
    alReintentar: () -> Unit,
    alCerrar: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = alCerrar) {
        Text(
            "Evolución del paciente",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        when {
            cargando && filas.isEmpty() -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            error != null -> Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                TextButton(onClick = alReintentar) { Text("Reintentar") }
            }
            filas.isEmpty() -> Text(
                "Este paciente todavía no tiene fichas registradas.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp),
            )
            else -> LazyColumn(Modifier.padding(bottom = 16.dp)) {
                items(filas, key = { it.episodio }) { fila ->
                    FilaEvolucionVista(fila, esActual = fila.episodio == actual) { alElegir(fila) }
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun FilaEvolucionVista(fila: FilaEvolucion, esActual: Boolean, alTocar: () -> Unit) {
    Column(
        verticalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(if (esActual) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface)
            .clickable(enabled = !esActual, onClick = alTocar)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(
            (fila.fecha ?: "s/f") + if (esActual) " · la que estás viendo" else "",
            style = MaterialTheme.typography.labelLarge,
        )
        Dato("Médico", fila.medico, "—")
        Dato("Diagnóstico", fila.diagnostico, "Sin diagnóstico")
        Dato("Tratamiento", fila.tratamiento, "Sin tratamiento")
    }
}

/** Etiqueta y valor; sin valor, en gris e itálica: no es un error, es que no se registró. */
@Composable
private fun Dato(etiqueta: String, valor: String?, vacio: String) {
    Row {
        Text(
            etiqueta,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(92.dp),
        )
        Text(
            valor ?: vacio,
            style = MaterialTheme.typography.bodyMedium,
            fontStyle = if (valor == null) FontStyle.Italic else null,
            color = if (valor == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
}
