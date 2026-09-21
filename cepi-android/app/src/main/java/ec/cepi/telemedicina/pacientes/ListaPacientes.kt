package ec.cepi.telemedicina.pacientes

import androidx.activity.compose.ReportDrawnWhen
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.app.Aviso
import ec.cepi.telemedicina.app.Sesion
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Lista de pacientes con búsqueda local. Equivale a ChatList.vue y a `PacientesView.swift`. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListaPacientes(
    sesion: Sesion,
    modelo: PacientesModelo,
    relleno: PaddingValues,
    alAbrir: (String) -> Unit,
    alFallar: (String) -> Unit,
) {
    val alcance = rememberCoroutineScope()
    var busqueda by rememberSaveable { mutableStateOf("") }
    var refrescando by remember { mutableStateOf(false) }
    var aBorrar by remember { mutableStateOf<FilaPaciente?>(null) }
    val puedeBorrar = sesion.usuario?.puede(CepiApi.PERMISO_BORRAR_PACIENTE) == true

    // Recarga al volver a primer plano, al cambiar de organización y cada 20 s mientras está
    // visible: una derivación nueva sube con "revisar" sin tocar nada (ChatList.vue).
    val ciclo by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val visible = ciclo.isAtLeast(Lifecycle.State.RESUMED)
    val organizacion = sesion.usuario?.orgActiva
    LaunchedEffect(visible, organizacion) {
        modelo.usarOrganizacion(organizacion)
        if (!visible) return@LaunchedEffect
        while (true) {
            modelo.cargar(sesion.api)
            delay(20_000)
        }
    }
    // El arranque en frío termina cuando la lista está a la vista (PAPER §25.5).
    ReportDrawnWhen { modelo.cargado }

    val filas = remember(modelo.filas, busqueda) { modelo.filtradas(busqueda) }

    Column(
        Modifier
            .padding(relleno)
            .fillMaxSize(),
    ) {
        OutlinedTextField(
            value = busqueda,
            onValueChange = { busqueda = it },
            placeholder = { Text("Buscar paciente o cédula") },
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

        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            PullToRefreshBox(
                isRefreshing = refrescando,
                onRefresh = {
                    refrescando = true
                    alcance.launch {
                        modelo.cargar(sesion.api)
                        refrescando = false
                    }
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 8.dp)) {
                    items(filas, key = { it.id }) { fila ->
                        FilaPacienteVista(
                            fila = fila,
                            revision = modelo.revision[fila.id],
                            asignacion = modelo.asignaciones[fila.id],
                            puedeBorrar = puedeBorrar,
                            alAbrir = { alAbrir(fila.id) },
                            alBorrar = { aBorrar = fila },
                        )
                    }
                }
            }

            val error = modelo.error
            when {
                sesion.cambiandoOrganizacion -> Espera("Cambiando de organización…")
                !modelo.cargado && error != null -> Surface(Modifier.fillMaxSize()) {
                    Aviso(
                        icono = rememberVectorPainter(Icons.Filled.Warning),
                        titulo = "No se pudo cargar la lista",
                        descripcion = error,
                    ) {
                        TextButton(onClick = { alcance.launch { modelo.cargar(sesion.api) } }) { Text("Reintentar") }
                    }
                }
                !modelo.cargado -> Espera("Cargando pacientes…")
                filas.isEmpty() && busqueda.isBlank() -> Aviso(
                    icono = painterResource(R.drawable.ic_grupo),
                    titulo = "No hay pacientes",
                    descripcion = "Crea el primero con el botón de alta.",
                )
                filas.isEmpty() -> Aviso(
                    icono = rememberVectorPainter(Icons.Filled.Search),
                    titulo = "Sin resultados",
                    descripcion = "Ningún paciente coincide con «${busqueda.trim()}».",
                )
            }
        }
    }

    aBorrar?.let { fila ->
        AlertDialog(
            onDismissRequest = { aBorrar = null },
            title = { Text("¿Eliminar a ${fila.nombre}?") },
            text = {
                Text(
                    "El paciente deja de aparecer en las listas. Su historia clínica se conserva, y si " +
                        "se lo crea de nuevo con la misma cédula vuelve con lo que tenía.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    aBorrar = null
                    alcance.launch {
                        try {
                            sesion.api.eliminarPaciente(fila.id)
                            modelo.cargar(sesion.api)
                        } catch (e: ApiError) {
                            alFallar("No se pudo eliminar a ${fila.nombre}: ${e.mensaje}")
                        }
                    }
                }) { Text("Eliminar", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { aBorrar = null }) { Text("Cancelar") } },
        )
    }
}

/**
 * Espera a pantalla completa. El `Surface` tapa y además bloquea los toques: mientras cambia de
 * org, la lista de la anterior no se puede tocar.
 */
@Composable
private fun Espera(texto: String) {
    Surface(color = MaterialTheme.colorScheme.background.copy(alpha = 0.9f), modifier = Modifier.fillMaxSize()) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        ) {
            CircularProgressIndicator()
            Text(texto, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
