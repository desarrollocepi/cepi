package ec.cepi.telemedicina.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import kotlinx.coroutines.launch

@Composable
fun Login(entorno: Entorno) {
    val sesion = entorno.sesion
    val alcance = rememberCoroutineScope()
    val foco = LocalFocusManager.current
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var enviando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val completo = email.isNotBlank() && password.isNotEmpty()

    // Lee el estado al llamarse, no el `completo` de la última composición: el ingreso de
    // desarrollo llena los campos y entra en el mismo paso.
    fun entrar() {
        if (email.isBlank() || password.isEmpty() || enviando) return
        enviando = true
        error = null
        alcance.launch {
            try {
                sesion.entrar(email, password)
            } catch (e: ApiError) {
                error = e.mensaje
            } finally {
                enviando = false
            }
        }
    }

    // Solo debug: con CEPI_DEV_EMAIL y CEPI_DEV_PASSWORD entra solo, por el mismo camino que
    // el botón. Para probar el cierre de sesión, lanzar sin esos extras.
    LaunchedEffect(Unit) {
        val config = entorno.config
        if (config.devEmail != null && config.devPassword != null) {
            email = config.devEmail
            password = config.devPassword
            entrar()
        }
    }

    Box(
        contentAlignment = Alignment.TopCenter,
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState()),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .widthIn(max = 420.dp)
                .padding(24.dp),
        ) {
            // El logo es blanco (en la web va sobre la banda marrón): sin su placa desaparece
            // sobre el fondo claro.
            Image(
                painter = painterResource(R.drawable.logo_cepi),
                contentDescription = "CEPI Centro de la Piel",
                modifier = Modifier
                    .padding(top = 32.dp)
                    .background(Marca.placaLogo, RoundedCornerShape(20.dp))
                    .padding(12.dp)
                    .height(88.dp),
            )
            Text("Telemedicina", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                    autoCorrectEnabled = false,
                ),
                keyboardActions = KeyboardActions(onNext = { foco.moveFocus(FocusDirection.Down) }),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentType = ContentType.Username },
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Contraseña") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { entrar() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentType = ContentType.Password },
            )

            error?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
            }

            Button(
                onClick = { entrar() },
                enabled = completo && !enviando,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) {
                if (enviando) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    Text("Ingresar")
                }
            }

            // Nunca ocultes un botón: el ingreso con Google existe, llega en la fase 4.
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(
                    onClick = {},
                    enabled = false,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                ) {
                    Text("Continuar con Google")
                }
                Text(
                    "El ingreso con Google todavía no está en esta versión. Entra con email y contraseña.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
