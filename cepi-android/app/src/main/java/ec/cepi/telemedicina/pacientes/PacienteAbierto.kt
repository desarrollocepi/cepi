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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.ficha.ConsultationAnswer
import ec.cepi.telemedicina.ficha.ConsultationAnswerSheet
import ec.cepi.telemedicina.ficha.DerivarPantalla
import ec.cepi.telemedicina.ficha.DischargeDialog
import ec.cepi.telemedicina.ficha.EpisodeRequest
import ec.cepi.telemedicina.ficha.EvolutionPage
import ec.cepi.telemedicina.ficha.FormularioHoja
import ec.cepi.telemedicina.ficha.PatientDischarge
import ec.cepi.telemedicina.ficha.SeccionesHoja
import ec.cepi.telemedicina.ficha.VisorFicha
import ec.cepi.telemedicina.galeria.ConsentModel
import ec.cepi.telemedicina.galeria.GaleriaModelo
import ec.cepi.telemedicina.galeria.ImagenesPaciente
import kotlinx.coroutines.launch

private val secciones = listOf("Chat", "Ficha", "Evolución", "Imágenes")

/** Índices de las páginas del paciente, en el orden de `secciones`. */
const val PAGE_CHAT = 0
const val PAGE_FICHA = 1
const val PAGE_EVOLUTION = 2
const val PAGE_IMAGES = 3

/**
 * Un paciente abierto: cuatro secciones que se pasan deslizando (PAPER §24.2.1, D-Aux-22).
 *
 *   Chat · Ficha · Evolución · Imágenes
 *
 * El modelo del hilo vive acá y no en el chat: la ficha guarda con él (`ficha_save`). Todas
 * quedan compuestas (`beyondViewportPageCount`): volver a una no la recarga, salvo Evolución,
 * que se vuelve a pedir cada vez que queda a la vista (§28.3).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PacienteAbierto(
    entorno: Entorno,
    pacienteId: String,
    fila: FilaPaciente?,
    /** La sección en la que abre (`PAGE_*`): la elige el menú de la lista. */
    seccionInicial: Int = 0,
    /**
     * Se respondió la interconsulta o se dio el alta: la lista de pacientes se recarga (sale de
     * "revisar", o pasa a «Alta»).
     */
    onConsultationAnswered: () -> Unit = {},
    alVolver: () -> Unit,
) {
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
    val consents = remember(pacienteId) { ConsentModel(api, pacienteId) }
    val paginas = rememberPagerState(initialPage = seccionInicial) { secciones.size }
    var fichaMostrada by rememberSaveable { mutableStateOf(false) }
    var imagenAbierta by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var mostrarSecciones by remember { mutableStateOf(false) }
    var derivar by remember { mutableStateOf(false) }
    // La ficha que se eligió en la evolución: la sección Ficha va a esa.
    var fichaPedida by remember { mutableStateOf<EpisodeRequest?>(null) }
    // La ficha que muestra la sección Ficha: Evolución la resalta.
    var shownEpisode by remember { mutableStateOf<String?>(null) }
    val showEvolution = { alcance.launch { paginas.animateScrollToPage(PAGE_EVOLUTION) } }
    // El episodio activo (estado, quién lo envió, lo que ya tiene la ficha): decide si se puede
    // responder la interconsulta y precarga el formulario (PAPER §30).
    var activeEpisode by remember { mutableStateOf<Registro?>(null) }
    var episodeReload by remember { mutableIntStateOf(0) }
    var answering by remember { mutableStateOf(false) }
    var discharging by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    // Abierto sin pasar por la lista (CEPI_DEV_PACIENTE, una notificación): el nombre se pide.
    var cabecera by remember(pacienteId) { mutableStateOf(fila) }

    LaunchedEffect(modelo) { modelo.abrir() }
    LaunchedEffect(modelo.episodioActivo, episodeReload) {
        val id = modelo.episodioActivo
        activeEpisode = null
        if (id == null) return@LaunchedEffect
        // Sin datos el botón queda deshabilitado con su motivo.
        activeEpisode = try {
            api.entidad(id)
        } catch (_: ApiError) {
            null
        }
    }
    val answerReason = ConsultationAnswer.disabledReason(modelo.episodioActivo, activeEpisode, entorno.sesion.usuario?.id)
    val dischargeReason = PatientDischarge.disabledReason(modelo.episodioActivo, activeEpisode)
    LaunchedEffect(pacienteId) {
        if (cabecera == null) {
            cabecera = try {
                FilaPaciente(api.entidad(pacienteId))
            } catch (_: ApiError) {
                null
            }
        }
    }
    LaunchedEffect(paginas.currentPage) { if (paginas.currentPage == PAGE_FICHA) fichaMostrada = true }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
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
                                    paginas.animateScrollToPage(PAGE_CHAT)
                                    modelo.enviar("nuevo episodio")
                                }
                            },
                            alSecciones = {
                                alcance.launch { paginas.animateScrollToPage(PAGE_CHAT) }
                                mostrarSecciones = true
                            },
                            alAutoFormulario = { alcance.launch { modelo.alternarAutoFormulario() } },
                            alDerivar = { derivar = true },
                            alEvolucion = { showEvolution() },
                            answerReason = answerReason,
                            onAnswer = { answering = true },
                            dischargeReason = dischargeReason,
                            onDischarge = { discharging = true },
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
                    PAGE_CHAT -> HiloVista(modelo) { imagenAbierta = it }
                    PAGE_FICHA -> VisorFicha(
                        pacienteId = pacienteId,
                        nombre = cabecera?.nombre ?: "Paciente",
                        episodioActivo = modelo.episodioActivo,
                        api = api,
                        web = entorno.config.webBase,
                        mostrada = fichaMostrada,
                        visible = paginas.settledPage == PAGE_FICHA && !paginas.isScrollInProgress,
                        alGuardar = { datos, episodio -> modelo.enviarFormulario("ficha_save", datos, episodio) },
                        episodioPedido = fichaPedida,
                        onShowEvolution = { showEvolution() },
                        onEpisodeShown = { shownEpisode = it },
                    )
                    PAGE_EVOLUTION -> EvolutionPage(
                        pacienteId = pacienteId,
                        currentEpisode = shownEpisode ?: modelo.episodioActivo,
                        api = api,
                        web = entorno.config.webBase,
                        visible = paginas.settledPage == PAGE_EVOLUTION && !paginas.isScrollInProgress,
                        onOpenEpisode = { episodio ->
                            fichaPedida = EpisodeRequest(episodio)
                            fichaMostrada = true
                            alcance.launch { paginas.animateScrollToPage(PAGE_FICHA) }
                        },
                    )
                    else -> ImagenesPaciente(imagenes, consents)
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
    val episodeToAnswer = activeEpisode
    if (answering && episodeToAnswer != null) {
        ConsultationAnswerSheet(
            api = api,
            episode = episodeToAnswer,
            onAnswered = { notified ->
                answering = false
                episodeReload++
                onConsultationAnswered()
                alcance.launch { snackbar.showSnackbar(ConsultationAnswer.confirmation(notified)) }
            },
            onClose = { answering = false },
        )
    }
    val episodeToDischarge = modelo.episodioActivo
    if (discharging && episodeToDischarge != null) {
        DischargeDialog(
            api = api,
            episodeId = episodeToDischarge,
            patientName = cabecera?.nombre,
            onDischarged = {
                discharging = false
                episodeReload++
                onConsultationAnswered()
                alcance.launch { snackbar.showSnackbar(PatientDischarge.CONFIRMATION) }
            },
            onClose = { discharging = false },
        )
    }
    if (derivar) {
        DerivarPantalla(
            api = api,
            alDerivar = { comando ->
                if (modelo.enviar(comando, accionExplicita = true)) {
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
    alEvolucion: () -> Unit,
    /** Por qué no se puede responder la interconsulta; `null` si se puede. */
    answerReason: String?,
    onAnswer: () -> Unit,
    /** Por qué no se puede dar el alta; `null` si se puede (PAPER §35). */
    dischargeReason: String?,
    onDischarge: () -> Unit,
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
            text = { Text("Evolución del paciente") },
            onClick = {
                alCerrar()
                alEvolucion()
            },
        )
        DropdownMenuItem(
            text = { Explicado("Responder interconsulta", answerReason) },
            enabled = libre && answerReason == null,
            onClick = {
                alCerrar()
                onAnswer()
            },
        )
        DropdownMenuItem(
            text = { Explicado("🏁 Dar de alta", dischargeReason) },
            enabled = libre && dischargeReason == null,
            onClick = {
                alCerrar()
                onDischarge()
            },
        )
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
