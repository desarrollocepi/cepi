package ec.cepi.telemedicina.ficha

import ec.cepi.telemedicina.api.CampoFormulario
import ec.cepi.telemedicina.api.FormularioBot
import ec.cepi.telemedicina.api.OpcionCampo
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.TipoCampo
import ec.cepi.telemedicina.api.texto
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** Las reglas de `BotForm.vue` y de `LogicaFormulario.swift`, sin UI, para poder probarlas. */
object LogicaFormulario {
    /** Los campos que llevan dato: los títulos decoran y `entity_search` envía al elegir. */
    fun camposDeDatos(formulario: FormularioBot): List<CampoFormulario> =
        formulario.campos.filter { it.clave != null && it.tipo != TipoCampo.Titulo && it.tipo != TipoCampo.BusquedaEntidad }

    /** Lo ya guardado, o vacío (`false` en las casillas). */
    fun valoresIniciales(formulario: FormularioBot): Map<String, JsonElement> =
        camposDeDatos(formulario).associate { campo ->
            val clave = campo.clave!!
            val guardado = formulario.valores[clave]
            clave to when {
                guardado != null && guardado !is JsonNull -> guardado
                campo.tipo == TipoCampo.Casilla -> JsonPrimitive(false)
                else -> JsonPrimitive("")
            }
        }

    /** Un formulario "cerrado" (una sola pregunta de opción) se envía al elegir, sin Guardar. */
    fun seEnviaAlElegir(formulario: FormularioBot): Boolean {
        val campos = camposDeDatos(formulario)
        return formulario.estructurado && campos.size == 1 && campos[0].tipo == TipoCampo.Opciones
    }

    fun muestraBotonEnviar(formulario: FormularioBot): Boolean =
        (formulario.plantillaEnvio != null || formulario.estructurado) && !seEnviaAlElegir(formulario)

    /**
     * Los de la ficha se pueden guardar siempre (todo es opcional); los de mensaje piden sus
     * obligatorios, o al menos un dato.
     */
    fun puedeEnviar(formulario: FormularioBot, valores: Map<String, JsonElement>): Boolean {
        if (formulario.estructurado) return true
        val campos = camposDeDatos(formulario)
        val requeridos = campos.filter { it.requerido }
        if (requeridos.isNotEmpty()) return requeridos.all { textoDe(valores[it.clave]).isNotEmpty() }
        return campos.any { textoDe(valores[it.clave]).isNotEmpty() }
    }

    /** El `data` del envío estructurado: sin textos vacíos; booleanos y números tal cual. */
    fun datosEstructurados(formulario: FormularioBot, valores: Map<String, JsonElement>): Map<String, JsonElement> =
        camposDeDatos(formulario).mapNotNull { campo ->
            val valor = valores[campo.clave] ?: return@mapNotNull null
            if (valor is JsonNull || (valor is JsonPrimitive && valor.isString && valor.content.isEmpty())) null
            else campo.clave!! to valor
        }.toMap()

    /** El mensaje de un formulario que no es estructurado: `{clave}` → su valor. */
    fun mensaje(formulario: FormularioBot, valores: Map<String, JsonElement>): String =
        interpolar(formulario.plantillaEnvio.orEmpty()) { textoDe(valores[it]) }.trim()

    /** El mensaje al elegir un resultado de `entity_search` (`on_select_send`, por defecto `{id}`). */
    fun mensajeAlElegir(campo: CampoFormulario, registro: Registro): String =
        interpolar(campo.plantillaSeleccion ?: "{id}") { clave ->
            when (clave) {
                "id" -> registro.id
                "title" -> registro.title.orEmpty()
                else -> registro[clave].orEmpty()
            }
        }

    /** Cómo se ve un resultado de `entity_search`: los campos de `result_label` unidos. */
    fun etiquetaResultado(campo: CampoFormulario, registro: Registro): String {
        val partes = campo.etiquetaResultado.mapNotNull { registro[it] }
        if (partes.isNotEmpty()) return partes.joinToString(" ")
        return registro.title ?: registro.id.take(8)
    }

    /** Si una opción es la elegida. Un número guardado (`2`) cuenta como su opción de texto (`"2"`). */
    fun coincide(valor: JsonElement?, opcion: OpcionCampo): Boolean {
        if (valor == null) return false
        if (valor == opcion.valor) return true
        val a = valor as? JsonPrimitive ?: return false
        val b = opcion.valor as? JsonPrimitive ?: return false
        val numeroYTexto = (esNumero(a) && b.isString) || (a.isString && esNumero(b))
        return numeroYTexto && a.texto() == b.texto()
    }

    /** El valor como lo interpola la web (`String(v || '')`): `true` es "true" y `false`, vacío. */
    fun textoDe(valor: JsonElement?): String {
        val primitivo = valor as? JsonPrimitive ?: return ""
        if (primitivo is JsonNull) return ""
        if (primitivo.isString) return primitivo.content.trim()
        primitivo.booleanOrNull?.let { return if (it) "true" else "" }
        return primitivo.texto().orEmpty()
    }

    private val marcador = Regex("""\{(\w+)\}""")

    fun interpolar(plantilla: String, valor: (String) -> String): String =
        marcador.replace(plantilla) { valor(it.groupValues[1]) }

    private fun esNumero(valor: JsonPrimitive) =
        valor !is JsonNull && !valor.isString && valor.booleanOrNull == null
}
