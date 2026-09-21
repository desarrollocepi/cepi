package ec.cepi.telemedicina.galeria

import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
 * Las imágenes clínicas de un paciente, de todas sus consultas: la tercera sección del paciente
 * (PAPER §24.2.1). El nombre del paciente no se repite en cada foto.
 */
@Composable
fun ImagenesPaciente(modelo: GaleriaModelo) {
    LaunchedEffect(modelo) { modelo.buscar("", esperaMs = 0) }
    RejillaImagenes(modelo, vacio = "Este paciente todavía no tiene imágenes", mostrarPaciente = false)
}
