package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.GrupoDerivacion
import ec.cepi.telemedicina.api.MiembroGrupo
import kotlinx.coroutines.launch

/**
 * Derivar el episodio a un círculo, a una persona o al responsable del caso. Elegir un destino
 * ejecuta la derivación al instante, igual que en la web: `derivar a <slug>` o
 * `escalar a <uuid>`. `alDerivar` devuelve el error, o `null` si el bot lo procesó.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DerivarPantalla(
    api: CepiApi,
    alDerivar: suspend (String) -> String?,
    responsable: suspend () -> String?,
    alCerrar: () -> Unit,
) {
    val alcance = rememberCoroutineScope()
    var grupos by remember { mutableStateOf(emptyList<GrupoDerivacion>()) }
    val miembros = remember { mutableStateMapOf<String, List<MiembroGrupo>>() }
    var expandido by remember { mutableStateOf<String?>(null) }
    var motivo by remember { mutableStateOf("") }
    var cargando by remember { mutableStateOf(true) }
    var enviando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            // Sin el turno de guardia: eso es "enviar caso", no derivar. "Toda la red" primero.
            // Un círculo sin nadie de esta organización no se ofrece: derivar ahí no llega a
            // nadie y el backend lo rechaza. Es la excepción a "nunca ocultes un botón".
            grupos = api.grupos()
                .filter { it.tipo != "roster" && it.miembros > 0 }
                .sortedBy { if (it.tipo == "all") 0 else 1 }
        } catch (e: ApiError) {
            error = "No se pudieron cargar los destinos: ${e.mensaje}"
        } finally {
            cargando = false
        }
    }
    LaunchedEffect(expandido) {
        val slug = expandido ?: return@LaunchedEffect
        if (slug !in miembros) {
            miembros[slug] = try {
                api.miembros(slug)
            } catch (_: ApiError) {
                emptyList()
            }
        }
    }

    fun derivar(comando: String) {
        alcance.launch {
            enviando = true
            try {
                val detalle = motivo.trim()
                error = alDerivar(if (detalle.isEmpty()) comando else "$comando $detalle")
            } finally {
                enviando = false
            }
        }
    }

    Dialog(onDismissRequest = alCerrar, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Derivar episodio") },
                    navigationIcon = {
                        IconButton(onClick = alCerrar) { Icon(Icons.Filled.Close, contentDescription = "Cerrar") }
                    },
                )
            },
        ) { relleno ->
            Box(
                Modifier
                    .padding(relleno)
                    .fillMaxSize(),
            ) {
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        OutlinedTextField(
                            value = motivo,
                            onValueChange = { motivo = it },
                            label = { Text("Motivo de la derivación (opcional)") },
                            maxLines = 4,
                            enabled = !enviando,
                            supportingText = { Text("Elegir un destino deriva al instante.") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                        )
                    }
                    item {
                        ListItem(
                            headlineContent = { Text("Al responsable del caso") },
                            leadingContent = { Icon(Icons.Filled.Star, contentDescription = null) },
                            modifier = Modifier.clickable(enabled = !enviando) {
                                alcance.launch {
                                    val usuario = responsable()
                                    if (usuario == null) {
                                        error = "El episodio no tiene responsable ni creador definido."
                                    } else {
                                        derivar("escalar a $usuario")
                                    }
                                }
                            },
                        )
                        HorizontalDivider()
                        Text(
                            "Círculos y especialidades",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
                        )
                    }
                    if (cargando) {
                        item { CircularProgressIndicator(Modifier.padding(16.dp)) }
                    } else if (grupos.isEmpty()) {
                        item {
                            ListItem(headlineContent = {
                                Text("Ningún círculo tiene miembros en esta organización.")
                            })
                        }
                    }
                    items(grupos, key = { it.id }) { grupo ->
                        FilaGrupo(
                            grupo = grupo,
                            abierto = expandido == grupo.slug,
                            personas = miembros[grupo.slug],
                            habilitado = !enviando,
                            alDerivarGrupo = { derivar("derivar a ${grupo.slug}") },
                            alAlternar = { expandido = if (expandido == grupo.slug) null else grupo.slug },
                            alDerivarPersona = { derivar("escalar a ${it.usuario}") },
                        )
                    }
                    error?.let {
                        item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
                    }
                }
                if (enviando) {
                    Surface(color = MaterialTheme.colorScheme.background.copy(alpha = 0.6f), modifier = Modifier.fillMaxSize()) {
                        Box(contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilaGrupo(
    grupo: GrupoDerivacion,
    abierto: Boolean,
    personas: List<MiembroGrupo>?,
    habilitado: Boolean,
    alDerivarGrupo: () -> Unit,
    alAlternar: () -> Unit,
    alDerivarPersona: (MiembroGrupo) -> Unit,
) {
    val todaLaRed = grupo.tipo == "all"
    ListItem(
        headlineContent = { Text(grupo.nombre) },
        supportingContent = { Text(tipoDeGrupo(grupo.tipo)) },
        leadingContent = { Icon(painterResource(R.drawable.ic_grupo), contentDescription = null) },
        trailingContent = { Text("${grupo.miembros}", style = MaterialTheme.typography.labelMedium) },
        modifier = Modifier.clickable(enabled = habilitado, onClick = alDerivarGrupo),
    )
    // Todos los destinos se abren para elegir a alguien, "toda la red" incluida: ahí está
    // quien no pertenece a ningún círculo.
    ListItem(
        headlineContent = {
            Text(
                if (todaLaRed) "Personas de la organización" else "Personas de ${grupo.nombre}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        trailingContent = {
            Icon(
                if (abierto) Icons.Filled.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = if (abierto) "Cerrar" else "Abrir",
            )
        },
        modifier = Modifier
            .padding(start = 40.dp)
            .clickable(enabled = habilitado, onClick = alAlternar),
    )
    if (!abierto) return
    when {
        personas == null -> CircularProgressIndicator(Modifier.padding(start = 56.dp, bottom = 8.dp))
        personas.isEmpty() -> Text(
            "(sin miembros)",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 56.dp, bottom = 8.dp),
        )
        else -> personas.forEach { persona ->
            ListItem(
                headlineContent = { Text(persona.nombre ?: persona.email ?: "Profesional") },
                supportingContent = persona.rol?.let { { Text(it) } },
                leadingContent = { Icon(Icons.Filled.Person, contentDescription = null) },
                modifier = Modifier
                    .padding(start = 40.dp)
                    .clickable(enabled = habilitado) { alDerivarPersona(persona) },
            )
        }
    }
}

/** Qué es el grupo, en castellano: la web y el backend usan las claves en inglés. */
private fun tipoDeGrupo(tipo: String?): String = when (tipo) {
    "all" -> "Toda la red"
    "specialty" -> "Especialidad"
    "circle" -> "Círculo"
    "roster" -> "Turno"
    else -> tipo.orEmpty()
}
