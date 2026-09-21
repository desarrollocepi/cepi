package ec.cepi.telemedicina.pacientes

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.app.Aviso

/**
 * El paciente abierto. Chat · Ficha · Imágenes (PAPER §24.2.1) llegan en la fase 2; hasta
 * entonces la pantalla existe y dice dónde está eso hoy.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PacienteAbierto(fila: FilaPaciente?, alVolver: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(fila?.nombre ?: "Paciente", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        fila?.cedula?.let { Text("CC: $it", style = MaterialTheme.typography.bodySmall) }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = alVolver) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Volver")
                    }
                },
            )
        },
    ) { relleno ->
        Aviso(
            icono = painterResource(R.drawable.ic_maletin_medico),
            titulo = "Chat, ficha e imágenes",
            descripcion = "El hilo, la ficha y las imágenes del paciente llegan en la próxima versión de " +
                "la app Android. Mientras tanto están en la web.",
            modifier = Modifier.padding(relleno),
        )
    }
}
