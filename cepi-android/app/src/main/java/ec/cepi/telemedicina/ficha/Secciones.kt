package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.Marcador

/**
 * Las secciones de la ficha agrupadas por categoría, con lo ya completo marcado. Elegir una abre
 * su formulario (el menú "Secciones" de IntakeChat.vue).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SeccionesHoja(marcadores: List<Marcador>, alElegir: (Marcador) -> Unit, alCerrar: () -> Unit) {
    ModalBottomSheet(onDismissRequest = alCerrar) {
        Text(
            "Secciones de la ficha",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        LazyColumn {
            Marcador.porCategoria(marcadores).forEach { (categoria, lista) ->
                item(key = "c-$categoria") {
                    Text(
                        categoria,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp),
                    )
                }
                items(lista, key = { it.id }) { marcador ->
                    ListItem(
                        headlineContent = {
                            Text(
                                marcador.etiqueta,
                                color = if (marcador.hecho) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                            )
                        },
                        leadingContent = {
                            if (marcador.hecho) {
                                Icon(Icons.Filled.CheckCircle, contentDescription = "Completa", tint = Color(0xFF16A34A))
                            } else {
                                Box(
                                    Modifier
                                        .padding(2.dp)
                                        .size(20.dp)
                                        .border(2.dp, MaterialTheme.colorScheme.outline, CircleShape),
                                )
                            }
                        },
                        modifier = Modifier.clickable {
                            alCerrar()
                            alElegir(marcador)
                        },
                    )
                }
            }
        }
    }
}
