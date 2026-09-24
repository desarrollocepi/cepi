package ec.cepi.telemedicina.pacientes

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.app.Entorno
import ec.cepi.telemedicina.chat.HiloModelo
import ec.cepi.telemedicina.chat.HiloVista
import ec.cepi.telemedicina.chat.VisorImagen
import ec.cepi.telemedicina.ficha.DerivarPantalla
import ec.cepi.telemedicina.ficha.FormularioHoja
import ec.cepi.telemedicina.ficha.SeccionesHoja
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
    val contexto = LocalContext.current
    // El auto-form es de cada paciente, como en iOS y en la web.
    val preferencias = remember { contexto.getSharedPreferences("cepi", Context.MODE_PRIVATE) }
    val modelo = remember(pacienteId) {
        HiloModelo(pacienteId, api, alcance, preferencias.getBoolean("autoform.$pacienteId", false)) {
            preferencias.edit().putBoolean("autoform.$pacienteId", it).apply()
        }
    }
    val imagenes = remember(pacienteId) { GaleriaModelo(api, paciente = pacienteId) }
    val paginas = rememberPagerState { secciones.size }
    var fichaMostrada by rememberSaveable { mutableStateOf(false) }
    var imagenAbierta by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var mostrarSecciones by remember { mutableStateOf(false) }
    var derivar by remember { mutableStateOf(false) }
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
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "Acciones")
                        }
                        Acciones(
                            abierto = menu,
                            modelo = modelo,
                            alCerrar = { menu = false },
                            alNuevaConsulta = {
                                alcance.launch {
                                    paginas.animateScrollToPage(0)
                                    modelo.enviar("nuevo episodio")
                                }
                            },
                            alSecciones = {
                                alcance.launch { paginas.animateScrollToPage(0) }
                                mostrarSecciones = true
                            },
                            alAutoFormulario = { alcance.launch { modelo.alternarAutoFormulario() } },
                            alDerivar = { derivar = true },
                        )
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
            // A quién está derivada la consulta, mientras haya alguien pendiente. Se toca y
            // abre Derivar para sumar o cambiar destinos.
            if (modelo.derivados.isNotEmpty()) {
                Surface(
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { derivar = true },
                ) {
                    Text(
                        "↪ Derivado a " + modelo.derivados.joinToString(", ") { it.comoSeLlama },
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    )
                }
            }
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

    modelo.formulario?.let { formulario ->
        FormularioHoja(
            formulario = formulario,
            ocupado = modelo.ocupado,
            api = api,
            alEnviar = { datos -> alcance.launch { modelo.enviarFormulario(formulario.id, datos) } },
            alMandar = { mensaje -> alcance.launch { modelo.enviar(mensaje) } },
            alCerrar = { modelo.cerrarFormulario() },
        )
    }
    if (mostrarSecciones) {
        SeccionesHoja(
            marcadores = modelo.marcadores,
            alElegir = { marcador -> alcance.launch { modelo.abrirSeccion(marcador) } },
            alCerrar = { mostrarSecciones = false },
        )
    }
    if (derivar) {
        DerivarPantalla(
            api = api,
            alDerivar = { comando ->
                if (modelo.enviar(comando)) {
                    // Derivado: el médico pasa al siguiente paciente.
                    derivar = false
                    alVolver()
                    null
                } else {
                    modelo.error ?: "No se pudo derivar."
                }
            },
            responsable = { modelo.responsableDelCaso() },
            alCerrar = { derivar = false },
            yaDerivados = modelo.derivados,
        )
    }
}

/**
 * Las acciones del paciente. Lo que todavía no aplica se ve, gris y con la razón (CLAUDE.md:
 * nunca ocultes un botón).
 */
@Composable
private fun Acciones(
    abierto: Boolean,
    modelo: HiloModelo,
    alCerrar: () -> Unit,
    alNuevaConsulta: () -> Unit,
    alSecciones: () -> Unit,
    alAutoFormulario: () -> Unit,
    alDerivar: () -> Unit,
) {
    val episodios = modelo.episodios
    val enLaActual = episodios.esActiva(episodios.indice(modelo.pagina), modelo.episodioActivo)
    val libre = !modelo.ocupado

    DropdownMenu(expanded = abierto, onDismissRequest = alCerrar) {
        DropdownMenuItem(
            text = { Text("Nueva consulta") },
            enabled = libre,
            onClick = {
                alCerrar()
                alNuevaConsulta()
            },
        )
        HorizontalDivider()
        Text(
            "Ficha",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        DropdownMenuItem(
            text = {
                Explicado(
                    "Secciones de la ficha",
                    when {
                        modelo.marcadores.isEmpty() -> "Disponibles al abrir la consulta"
                        !enLaActual -> "Solo en la consulta actual"
                        else -> null
                    },
                )
            },
            enabled = libre && modelo.marcadores.isNotEmpty() && enLaActual,
            onClick = {
                alCerrar()
                alSecciones()
            },
        )
        DropdownMenuItem(
            text = {
                Explicado(
                    if (modelo.autoFormulario) "Auto-form encendido" else "Auto-form apagado",
                    when {
                        !enLaActual -> "Solo en la consulta actual"
                        modelo.autoFormulario -> "Pide la siguiente sección faltante"
                        else -> "Solo muestra la sección que abras"
                    },
                )
            },
            enabled = libre && enLaActual,
            onClick = {
                alCerrar()
                alAutoFormulario()
            },
        )
        HorizontalDivider()
        DropdownMenuItem(
            text = { Text("Derivar") },
            enabled = libre,
            onClick = {
                alCerrar()
                alDerivar()
            },
        )
    }
}

@Composable
private fun Explicado(titulo: String, detalle: String?) {
    Column {
        Text(titulo)
        detalle?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
