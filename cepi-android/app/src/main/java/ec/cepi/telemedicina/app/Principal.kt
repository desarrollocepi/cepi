package ec.cepi.telemedicina.app

import androidx.activity.compose.BackHandler
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
import androidx.compose.ui.res.painterResource
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.pacientes.ListaPacientes
import ec.cepi.telemedicina.pacientes.NuevoPaciente
import ec.cepi.telemedicina.pacientes.PacienteAbierto
import ec.cepi.telemedicina.pacientes.PacientesModelo
import kotlinx.coroutines.launch

private enum class Seccion(val titulo: String) { Pacientes("Pacientes"), Galeria("Galería") }

/**
 * Lo que se ve con la sesión abierta: Pacientes y Galería (PAPER §24.2.1, D-Aux-22). Dentro de
 * un paciente hay otras tres secciones (fase 2).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Principal(entorno: Entorno) {
    val sesion = entorno.sesion
    val alcance = rememberCoroutineScope()
    // Aquí y no en la lista: pasar a Galería y volver no recarga ni vuelve a "Cargando…".
    val modelo = remember { PacientesModelo() }
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

    val id = abierto
    if (id != null) {
        BackHandler { abierto = null }
        PacienteAbierto(modelo.fila(id)) { abierto = null }
    } else {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(Seccion.entries[seccion].titulo) },
                    navigationIcon = {
                        MenuCuenta(
                            sesion = sesion,
                            alEliminarCuenta = { borrarCuenta = true },
                            alFallarCambio = { errorOrganizacion = it },
                        )
                    },
                    actions = {
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
                Seccion.Galeria -> Aviso(
                    icono = painterResource(R.drawable.ic_galeria),
                    titulo = "Galería",
                    descripcion = "Las imágenes de todos los casos de la organización, con buscador, llegan en " +
                        "la próxima versión de la app Android. Mientras tanto están en la web.",
                    modifier = Modifier.padding(relleno),
                )
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
    errorOrganizacion?.let { motivo ->
        AlertDialog(
            onDismissRequest = { errorOrganizacion = null },
            title = { Text("No se pudo cambiar de organización") },
            text = { Text(motivo) },
            confirmButton = { TextButton(onClick = { errorOrganizacion = null }) { Text("Aceptar") } },
        )
    }
}
