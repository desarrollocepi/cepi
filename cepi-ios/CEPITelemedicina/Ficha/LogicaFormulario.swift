import Foundation

/// Las reglas de `BotForm.vue`, sin UI, para poder probarlas.
enum LogicaFormulario {
    /// Los campos que llevan dato: los títulos decoran y `entity_search` envía al elegir.
    static func camposDeDatos(_ formulario: FormularioBot) -> [CampoFormulario] {
        formulario.campos.filter { $0.clave != nil && $0.tipo != .titulo && $0.tipo != .busquedaEntidad }
    }

    /// Lo ya guardado, o vacío (`false` en las casillas).
    static func valoresIniciales(_ formulario: FormularioBot) -> [String: JSONValor] {
        var valores: [String: JSONValor] = [:]
        for campo in camposDeDatos(formulario) {
            guard let clave = campo.clave else { continue }
            if let guardado = formulario.valores[clave], guardado != .nulo {
                valores[clave] = guardado
            } else {
                valores[clave] = campo.tipo == .casilla ? .booleano(false) : .texto("")
            }
        }
        return valores
    }

    /// Un formulario "cerrado" (una sola pregunta de opción) se envía al elegir, sin Guardar.
    static func seEnviaAlElegir(_ formulario: FormularioBot) -> Bool {
        let campos = camposDeDatos(formulario)
        return formulario.estructurado && campos.count == 1 && campos[0].tipo == .opciones
    }

    static func muestraBotonEnviar(_ formulario: FormularioBot) -> Bool {
        (formulario.plantillaEnvio != nil || formulario.estructurado) && !seEnviaAlElegir(formulario)
    }

    /// Los de la ficha se pueden guardar siempre (todo es opcional); los de mensaje piden sus
    /// obligatorios, o al menos un dato.
    static func puedeEnviar(_ formulario: FormularioBot, valores: [String: JSONValor]) -> Bool {
        if formulario.estructurado { return true }
        let campos = camposDeDatos(formulario)
        let requeridos = campos.filter(\.requerido)
        if !requeridos.isEmpty {
            return requeridos.allSatisfy { !textoDe(valores[$0.clave ?? ""]).isEmpty }
        }
        return campos.contains { !textoDe(valores[$0.clave ?? ""]).isEmpty }
    }

    /// El `data` del envío estructurado: sin textos vacíos; booleanos y números tal cual.
    static func datosEstructurados(_ formulario: FormularioBot, valores: [String: JSONValor]) -> [String: JSONValor] {
        var datos: [String: JSONValor] = [:]
        for campo in camposDeDatos(formulario) {
            guard let clave = campo.clave, let valor = valores[clave] else { continue }
            if valor == .nulo || valor == .texto("") { continue }
            datos[clave] = valor
        }
        return datos
    }

    /// El mensaje de un formulario que no es estructurado: `{clave}` → su valor.
    static func mensaje(_ formulario: FormularioBot, valores: [String: JSONValor]) -> String {
        interpolar(formulario.plantillaEnvio ?? "") { textoDe(valores[$0]) }
            .trimmingCharacters(in: .whitespaces)
    }

    /// El mensaje al elegir un resultado de `entity_search` (`on_select_send`, por defecto `{id}`).
    static func mensajeAlElegir(_ campo: CampoFormulario, registro: Registro) -> String {
        interpolar(campo.plantillaSeleccion ?? "{id}") { clave in
            switch clave {
            case "id": registro.id
            case "title": registro.title ?? ""
            default: registro[clave] ?? ""
            }
        }
    }

    /// Cómo se ve un resultado de `entity_search`: los campos de `result_label` unidos.
    static func etiquetaResultado(_ campo: CampoFormulario, registro: Registro) -> String {
        let partes = campo.etiquetaResultado.compactMap { registro[$0] }
        if !partes.isEmpty { return partes.joined(separator: " ") }
        return registro.title ?? String(registro.id.prefix(8))
    }

    /// Si una opción es la elegida. Un número guardado (`2`) cuenta como su opción de texto (`"2"`).
    static func coincide(_ valor: JSONValor?, con opcion: OpcionCampo) -> Bool {
        guard let valor else { return false }
        if valor == opcion.valor { return true }
        switch (valor, opcion.valor) {
        case (.numero, .texto), (.texto, .numero): return valor.texto == opcion.valor.texto
        default: return false
        }
    }

    /// El valor como lo interpola la web (`String(v || '')`): `true` es "true" y `false`, vacío.
    static func textoDe(_ valor: JSONValor?) -> String {
        switch valor {
        case .texto(let texto): texto.trimmingCharacters(in: .whitespacesAndNewlines)
        case .booleano(true): "true"
        case .numero: valor?.texto ?? ""
        default: ""
        }
    }

    static func interpolar(_ plantilla: String, _ valor: (String) -> String) -> String {
        var salida = ""
        var resto = plantilla[...]
        while let coincidencia = resto.firstMatch(of: #/\{(\w+)\}/#) {
            salida += resto[..<coincidencia.range.lowerBound]
            salida += valor(String(coincidencia.output.1))
            resto = resto[coincidencia.range.upperBound...]
        }
        return salida + resto
    }
}
