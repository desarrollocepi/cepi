package ec.cepi.telemedicina.galeria

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp

/**
 * Galería de la organización activa: las imágenes de todos los casos, con buscador por
 * paciente, cédula, diagnóstico, CIE-10 o fecha (PAPER §24.2.1).
 */
@Composable
fun Galeria(modelo: GaleriaModelo, organizacion: String?, relleno: PaddingValues) {
    var busqueda by rememberSaveable { mutableStateOf("") }
    // Cada tecla reinicia la espera; otra org es otra galería y vuelve a pedir desde cero.
    LaunchedEffect(busqueda, organizacion) { modelo.buscar(busqueda) }

    Column(
        Modifier
            .padding(relleno)
            .fillMaxSize(),
    ) {
        OutlinedTextField(
            value = busqueda,
            onValueChange = { busqueda = it },
            placeholder = { Text("Paciente, cédula, diagnóstico, CIE-10 o fecha") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                IconButton(onClick = { busqueda = "" }, enabled = busqueda.isNotEmpty()) {
                    Icon(Icons.Filled.Clear, contentDescription = "Borrar búsqueda")
                }
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        )
        RejillaImagenes(modelo, vacio = "Todavía no hay imágenes en esta organización")
    }
}

/**
 * Las imágenes de un paciente (PAPER §24.2.1). Arriba, los dos consentimientos firmados (§31.3),
 * separados de las fotos clínicas; abajo, las clínicas del episodio elegido en el navegador del
 * paciente (§28.4.1), con «Ver todas» para las de todos sus episodios. El nombre del paciente no
 * se repite en cada foto.
 */
@Composable
fun ImagenesPaciente(modelo: GaleriaModelo, consents: ConsentModel, episodeLabel: String?) {
    LaunchedEffect(modelo) { modelo.buscar("", esperaMs = 0) }
    // Para filtrar por episodio hacen falta todas las páginas: las de un paciente son pocas.
    LaunchedEffect(modelo.filtrando, modelo.imagenes.size, modelo.hayMas, modelo.cargando) {
        if (modelo.filtrando && modelo.hayMas && !modelo.cargando) modelo.siguientePagina()
    }
    val hidden = EpisodeImageFilter.hidden(modelo.imagenes, modelo.episodio)
    Column(Modifier.fillMaxSize()) {
        ConsentimientosPaciente(consents, Modifier.padding(top = 6.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
        ) {
            Text(
                when {
                    modelo.episodio == null -> "Todas las fotos del paciente: todavía no hay episodios"
                    modelo.verTodas -> "Todas las fotos del paciente"
                    else -> "Fotos del ${episodeLabel ?: "episodio elegido"}"
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { modelo.verTodas = !modelo.verTodas }, enabled = modelo.episodio != null) {
                Text(
                    when {
                        modelo.verTodas -> "Solo este episodio"
                        hidden > 0 -> "Ver todas (+$hidden)"
                        else -> "Ver todas"
                    },
                )
            }
        }
        RejillaImagenes(
            modelo,
            vacio = if (modelo.filtrando) "Este episodio no tiene imágenes. «Ver todas» muestra las del paciente." else "Este paciente todavía no tiene imágenes",
            mostrarPaciente = false,
            modifier = Modifier.weight(1f),
        )
    }
}
