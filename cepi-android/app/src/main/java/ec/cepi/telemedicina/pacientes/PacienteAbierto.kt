package ec.cepi.telemedicina.pacientes

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.app.Entorno
import ec.cepi.telemedicina.chat.HiloModelo
import ec.cepi.telemedicina.chat.HiloVista
import ec.cepi.telemedicina.chat.VisorImagen
import ec.cepi.telemedicina.ficha.VisorFicha
import ec.cepi.telemedicina.galeria.GaleriaModelo
import ec.cepi.telemedicina.galeria.ImagenesPaciente
import kotlinx.coroutines.launch

private val secciones = listOf("Chat", "Ficha", "Imágenes")

/**
 * Un paciente abierto: tres secciones que se pasan deslizando (PAPER §24.2.1, D-Aux-22).
 *
 *   Chat · Ficha · Imágenes
 *
 * El modelo del hilo vive acá y no en el chat: la ficha guarda con él (`ficha_save`). Las tres
 * quedan compuestas (`beyondViewportPageCount`): volver a una no la recarga.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PacienteAbierto(entorno: Entorno, pacienteId: String, fila: FilaPaciente?, alVolver: () -> Unit) {
    val api = entorno.sesion.api
    val alcance = rememberCoroutineScope()
    val modelo = remember(pacienteId) { HiloModelo(pacienteId, api, alcance) }
    val imagenes = remember(pacienteId) { GaleriaModelo(api, paciente = pacienteId) }
    val paginas = rememberPagerState { secciones.size }
    var fichaMostrada by rememberSaveable { mutableStateOf(false) }
    var imagenAbierta by remember { mutableStateOf<String?>(null) }
    // Abierto sin pasar por la lista (CEPI_DEV_PACIENTE, una notificación): el nombre se pide.
    var cabecera by remember(pacienteId) { mutableStateOf(fila) }

    LaunchedEffect(modelo) { modelo.abrir() }
    LaunchedEffect(pacienteId) {
        if (cabecera == null) {
            cabecera = try {
                FilaPaciente(api.entidad(pacienteId))
            } catch (_: ApiError) {
                null
            }
        }
    }
    LaunchedEffect(paginas.currentPage) { if (paginas.currentPage == 1) fichaMostrada = true }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(cabecera?.nombre ?: "Paciente", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        cabecera?.cedula?.let { Text("CC: $it", style = MaterialTheme.typography.bodySmall) }
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
        Column(
            Modifier
                .padding(relleno)
                .consumeWindowInsets(relleno)
                .imePadding()
                .fillMaxSize(),
        ) {
            PrimaryTabRow(selectedTabIndex = paginas.currentPage) {
                secciones.forEachIndexed { indice, titulo ->
                    Tab(
                        selected = paginas.currentPage == indice,
                        onClick = { alcance.launch { paginas.animateScrollToPage(indice) } },
                        text = { Text(titulo) },
                    )
                }
            }
            HorizontalPager(
                state = paginas,
                beyondViewportPageCount = secciones.size - 1,
                modifier = Modifier.weight(1f),
            ) { pagina ->
                when (pagina) {
                    0 -> HiloVista(modelo) { imagenAbierta = it }
                    1 -> VisorFicha(
                        pacienteId = pacienteId,
                        nombre = cabecera?.nombre ?: "Paciente",
                        episodioActivo = modelo.episodioActivo,
                        api = api,
                        web = entorno.config.webBase,
                        mostrada = fichaMostrada,
                        visible = paginas.settledPage == 1 && !paginas.isScrollInProgress,
                        alGuardar = { datos, episodio -> modelo.enviarFormulario("ficha_save", datos, episodio) },
                    )
                    else -> ImagenesPaciente(imagenes)
                }
            }
        }
    }

    imagenAbierta?.let { VisorImagen(it) { imagenAbierta = null } }
}
