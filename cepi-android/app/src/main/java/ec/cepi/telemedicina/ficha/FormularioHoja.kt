package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ec.cepi.telemedicina.api.CampoFormulario
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.FormularioBot
import ec.cepi.telemedicina.api.TipoCampo
import ec.cepi.telemedicina.api.texto
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Un formulario del bot (BotForm.vue), en una hoja sobre el hilo: en el hilo, el teclado y el
 * composer tapaban su botón. Los envíos estructurados salen por `alEnviar`; las acciones
 * ("Omitir"), la plantilla de mensaje y la elección de un paciente, por `alMandar`. Con auto-form
 * encendido la hoja pasa al grupo siguiente sin cerrarse.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FormularioHoja(
    formulario: FormularioBot,
    ocupado: Boolean,
    api: CepiApi,
    alEnviar: (JsonObject) -> Unit,
    alMandar: (String) -> Unit,
    alCerrar: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = alCerrar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        // Un formulario nuevo (o el mismo con otros valores) arranca de cero.
        var valores by remember(formulario) { mutableStateOf(LogicaFormulario.valoresIniciales(formulario)) }
        val habilitado = !ocupado

        fun fijar(clave: String?, valor: JsonElement) {
            if (clave != null) valores = valores + (clave to valor)
        }

        fun enviar() {
            if (formulario.estructurado) {
                alEnviar(JsonObject(LogicaFormulario.datosEstructurados(formulario, valores)))
            } else {
                LogicaFormulario.mensaje(formulario, valores).takeIf { it.isNotEmpty() }?.let(alMandar)
            }
        }

        Column(Modifier.imePadding()) {
            // Enviar en la barra y no al pie: el teclado no lo tapa.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
            ) {
                TextButton(onClick = alCerrar) { Text("Cerrar") }
                Text(
                    formulario.titulo,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp),
                )
                if (LogicaFormulario.muestraBotonEnviar(formulario)) {
                    Button(onClick = { enviar() }, enabled = habilitado && LogicaFormulario.puedeEnviar(formulario, valores)) {
                        Text(formulario.textoEnviar ?: "Enviar")
                    }
                }
            }
            if (ocupado) LinearProgressIndicator(Modifier.fillMaxWidth())

            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                formulario.campos.forEach { campo ->
                    Campo(
                        campo = campo,
                        valor = campo.clave?.let { valores[it] },
                        habilitado = habilitado,
                        api = api,
                        alCambiar = { fijar(campo.clave, it) },
                        alElegirOpcion = { valor ->
                            fijar(campo.clave, valor)
                            if (LogicaFormulario.seEnviaAlElegir(formulario)) enviar()
                        },
                        alMandar = alMandar,
                    )
                }
                // "Omitir" abajo y "Guardar" arriba, lejos uno del otro.
                if (formulario.acciones.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        formulario.acciones.forEach { accion ->
                            OutlinedButton(onClick = { alMandar(accion.send) }, enabled = habilitado) { Text(accion.label) }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Campo(
    campo: CampoFormulario,
    valor: JsonElement?,
    habilitado: Boolean,
    api: CepiApi,
    alCambiar: (JsonElement) -> Unit,
    alElegirOpcion: (JsonElement) -> Unit,
    alMandar: (String) -> Unit,
) {
    val texto = valor?.texto().orEmpty()
    val alCambiarTexto: (String) -> Unit = { alCambiar(JsonPrimitive(it)) }

    when (campo.tipo) {
        TipoCampo.Titulo -> Text(
            campo.etiqueta,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = 4.dp),
        )
        TipoCampo.Casilla -> Row(verticalAlignment = Alignment.CenterVertically) {
            Text(campo.etiqueta, modifier = Modifier.weight(1f))
            Switch(checked = valor == JsonPrimitive(true), onCheckedChange = { alCambiar(JsonPrimitive(it)) }, enabled = habilitado)
        }
        TipoCampo.Opciones -> ConEtiqueta(campo) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                campo.opciones.forEach { opcion ->
                    FilterChip(
                        selected = LogicaFormulario.coincide(valor, opcion),
                        onClick = { alElegirOpcion(opcion.valor) },
                        label = { Text(opcion.etiqueta) },
                        enabled = habilitado,
                    )
                }
            }
        }
        TipoCampo.AreaTexto -> ConEtiqueta(campo) {
            OutlinedTextField(
                value = texto,
                onValueChange = alCambiarTexto,
                placeholder = { campo.placeholder?.let { Text(it) } },
                minLines = 2,
                maxLines = 6,
                enabled = habilitado,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        TipoCampo.Fecha -> ConEtiqueta(campo) { CampoFecha(texto, alCambiarTexto, habilitado) }
        TipoCampo.BusquedaEntidad -> ConEtiqueta(campo) { CampoEntidad(campo, api, habilitado, alMandar) }
        TipoCampo.BusquedaCIE -> ConEtiqueta(campo) { CampoCIE10(campo, texto, alCambiarTexto, api, habilitado) }
        TipoCampo.MapaCorporal -> ConEtiqueta(campo) { CampoMapaCorporal(texto, alCambiarTexto, habilitado) }
        TipoCampo.Imagenes -> ConEtiqueta(campo) { CampoImagenes(texto, campo.multiple, alCambiarTexto, api, habilitado) }
        TipoCampo.Texto -> ConEtiqueta(campo) {
            OutlinedTextField(
                value = texto,
                onValueChange = alCambiarTexto,
                placeholder = { campo.placeholder?.let { Text(it) } },
                singleLine = true,
                enabled = habilitado,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ConEtiqueta(campo: CampoFormulario, contenido: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row {
            Text(
                campo.etiqueta,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (campo.requerido) Text(" *", color = MaterialTheme.colorScheme.error)
        }
        contenido()
    }
}
