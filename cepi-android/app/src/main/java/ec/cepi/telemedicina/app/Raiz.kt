package ec.cepi.telemedicina.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.launch

/**
 * Qué se ve según la sesión. El login va por encima de todo, como en `App.vue`: no es una
 * pantalla más de la navegación.
 */
@Composable
fun Raiz(entorno: Entorno) {
    val sesion = entorno.sesion
    val alcance = rememberCoroutineScope()

    LaunchedEffect(Unit) { sesion.restaurar(olvidarToken = entorno.config.devEmail != null) }
    // Al entrar (o al volver con la sesión guardada) este teléfono queda registrado para push.
    LaunchedEffect(sesion.estado) {
        if (sesion.estado == Sesion.Estado.Activa) entorno.registroPush.registrar()
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        alcance.launch { sesion.renovarSiHaceFalta() }
    }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        when (val estado = sesion.estado) {
            Sesion.Estado.Cargando -> Box(contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            Sesion.Estado.SinSesion -> Login(entorno)
            Sesion.Estado.Pendiente -> Pendiente(sesion)
            Sesion.Estado.Activa -> Principal(entorno)
            is Sesion.Estado.SinValidar -> SinValidar(sesion, estado.motivo)
        }
    }
}

/** Hay token pero `/me` no respondió: se reintenta, no se manda al login. */
@Composable
private fun SinValidar(sesion: Sesion, motivo: String) {
    val alcance = rememberCoroutineScope()
    Aviso(
        icono = rememberVectorPainter(Icons.Filled.Warning),
        titulo = "No se pudo abrir la sesión",
        descripcion = motivo,
    ) {
        Button(onClick = { alcance.launch { sesion.renovar() } }) { Text("Reintentar") }
        TextButton(onClick = { alcance.launch { sesion.salir() } }) {
            Text("Cerrar sesión", color = MaterialTheme.colorScheme.error)
        }
    }
}
