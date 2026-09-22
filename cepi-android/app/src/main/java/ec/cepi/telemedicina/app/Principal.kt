package ec.cepi.telemedicina.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.res.painterResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.notificaciones.BandejaHoja
import ec.cepi.telemedicina.notificaciones.BandejaModelo
import ec.cepi.telemedicina.notificaciones.Notificador
import ec.cepi.telemedicina.galeria.Galeria
import ec.cepi.telemedicina.galeria.GaleriaModelo
import ec.cepi.telemedicina.pacientes.ListaPacientes
import ec.cepi.telemedicina.pacientes.NuevoPaciente
import ec.cepi.telemedicina.pacientes.PacienteAbierto
import ec.cepi.telemedicina.pacientes.PacientesModelo
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

private enum class Seccion(val titulo: String) { Pacientes("Pacientes"), Galeria("Galería") }

/**
 * Lo que se ve con la sesión abierta: Pacientes y Galería (PAPER §24.2.1, D-Aux-22). Dentro de
 * un paciente hay otras tres secciones (`PacienteAbierto`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Principal(entorno: Entorno) {
    val sesion = entorno.sesion
    val alcance = rememberCoroutineScope()
    // Aquí y no en la lista: pasar a Galería y volver no recarga ni vuelve a "Cargando…".
    val modelo = remember { PacientesModelo() }
    val galeria = remember { GaleriaModelo(sesion.api) }
    val bandeja = remember { BandejaModelo(sesion.api) }
    var bandejaAbierta by rememberSaveable { mutableStateOf(false) }
    val contexto = LocalContext.current
    val avisos = remember { SnackbarHostState() }
    var seccion by rememberSaveable { mutableIntStateOf(Seccion.Pacientes.ordinal) }
    // Solo debug: CEPI_DEV_PACIENTE abre ese paciente al entrar.
    var abierto by rememberSaveable { mutableStateOf(entorno.config.devPaciente) }
    var creando by rememberSaveable { mutableStateOf(false) }
    var borrarCuenta by rememberSaveable { mutableStateOf(false) }
    var errorOrganizacion by remember { mutableStateOf<String?>(null) }

    // El paciente abierto es de la org anterior: se cierra al cambiar.
    val organizacion = sesion.usuario?.orgActiva
    var organizacionVista by rememberSaveable { mutableStateOf(organizacion) }
    LaunchedEffect(organizacion) {
        if (organizacion != organizacionVista) {
            organizacionVista = organizacion
            abierto = null
        }
    }

    // La bandeja se refresca al volver a primer plano, cada minuto y cuando llega un push.
    val ciclo by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val visible = ciclo.isAtLeast(Lifecycle.State.RESUMED)
    val usuarioId = sesion.usuario?.id
    LaunchedEffect(visible, usuarioId, organizacion, entorno.avisosNuevos) {
        val usuario = usuarioId ?: return@LaunchedEffect
        while (visible) {
            bandeja.cargar(usuario)
            delay(60_000)
        }
    }

    // Tocar una notificación: su `entity_id` (episodio o paciente) → el paciente, abierto. Un
    // flujo y no un LaunchedEffect(destino): limpiar el destino reiniciaba el efecto y cancelaba
    // la consulta a medio camino.
    LaunchedEffect(Unit) {
        snapshotFlow { entorno.destinoPush }.filterNotNull().collect { entidad ->
            entorno.destinoPush = null
            val paciente = try {
                sesion.api.pacienteDeAviso(entidad).paciente
            } catch (_: ApiError) {
                null
            }
            if (paciente != null) abierto = paciente else avisos.showSnackbar("No se encontró el paciente de la notificación.")
        }
    }

    PedirPermisoDeNotificaciones()

    val id = abierto
    if (id != null) {
        BackHandler { abierto = null }
        PacienteAbierto(entorno, id, modelo.fila(id)) { abierto = null }
    } else {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(Seccion.entries[seccion].titulo) },
                    navigationIcon = {
                        MenuCuenta(
                            sesion = sesion,
                            notificaciones = when {
                                !entorno.fcm.configurado -> "Notificaciones: esta compilación no tiene Firebase"
                                Notificador.permitido(contexto) -> "Notificaciones activas"
                                else -> null
                            },
                            alAbrirAjustesDeNotificaciones = { abrirAjustesDeNotificaciones(contexto) },
                            alEliminarCuenta = { borrarCuenta = true },
                            alFallarCambio = { errorOrganizacion = it },
                        )
                    },
                    actions = {
                        IconButton(onClick = { bandejaAbierta = true }) {
                            BadgedBox(badge = {
                                if (bandeja.pendientes > 0) Badge { Text(if (bandeja.pendientes > 99) "99+" else "${bandeja.pendientes}") }
                            }) {
                                Icon(Icons.Filled.Notifications, contentDescription = "Notificaciones: ${bandeja.pendientes} pendiente(s)")
                            }
                        }
                        if (seccion == Seccion.Pacientes.ordinal) {
                            IconButton(onClick = { creando = true }) {
                                Icon(painterResource(R.drawable.ic_persona_agregar), contentDescription = "Nuevo paciente")
                            }
                        }
                    },
                )
            },
            bottomBar = {
                NavigationBar {
                    NavigationBarItem(
                        selected = seccion == Seccion.Pacientes.ordinal,
                        onClick = { seccion = Seccion.Pacientes.ordinal },
                        icon = { Icon(Icons.Filled.Person, contentDescription = null) },
                        label = { Text(Seccion.Pacientes.titulo) },
                    )
                    NavigationBarItem(
                        selected = seccion == Seccion.Galeria.ordinal,
                        onClick = { seccion = Seccion.Galeria.ordinal },
                        icon = { Icon(painterResource(R.drawable.ic_galeria), contentDescription = null) },
                        label = { Text(Seccion.Galeria.titulo) },
                    )
                }
            },
            snackbarHost = { SnackbarHost(avisos) },
        ) { relleno ->
            when (Seccion.entries[seccion]) {
                Seccion.Pacientes -> ListaPacientes(
                    sesion = sesion,
                    modelo = modelo,
                    relleno = relleno,
                    alAbrir = { abierto = it },
                    alFallar = { alcance.launch { avisos.showSnackbar(it) } },
                )
                Seccion.Galeria -> Galeria(galeria, organizacion, relleno)
            }
        }
    }

    if (creando) {
        NuevoPaciente(
            api = sesion.api,
            alCerrar = { creando = false },
            alCrear = { registro ->
                modelo.insertar(registro)
                abierto = registro.id
                alcance.launch { modelo.cargar(sesion.api) }
            },
        )
    }
    if (borrarCuenta) DialogoEliminarCuenta(sesion) { borrarCuenta = false }
    if (bandejaAbierta) {
        BandejaHoja(
            modelo = bandeja,
            alAbrirPaciente = { abierto = it },
            alCerrar = { bandejaAbierta = false },
        )
    }
    errorOrganizacion?.let { motivo ->
        AlertDialog(
            onDismissRequest = { errorOrganizacion = null },
            title = { Text("No se pudo cambiar de organización") },
            text = { Text(motivo) },
            confirmButton = { TextButton(onClick = { errorOrganizacion = null }) { Text("Aceptar") } },
        )
    }
}

/**
 * Android 13+ pide permiso para notificar. Se pregunta una vez, al entrar; si se niega, el menú
 * de la cuenta lo dice y lleva a los ajustes (nunca ocultes un botón).
 */
@Composable
private fun PedirPermisoDeNotificaciones() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val contexto = LocalContext.current
    val preferencias = remember { contexto.getSharedPreferences("cepi", Context.MODE_PRIVATE) }
    val permiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (!Notificador.permitido(contexto) && !preferencias.getBoolean("notificaciones.pedidas", false)) {
            preferencias.edit().putBoolean("notificaciones.pedidas", true).apply()
            permiso.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

private fun abrirAjustesDeNotificaciones(contexto: Context) {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, contexto.packageName)
    } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", contexto.packageName, null))
    }
    contexto.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
