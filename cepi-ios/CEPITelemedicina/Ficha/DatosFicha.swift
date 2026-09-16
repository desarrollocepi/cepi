import Foundation

/// Los datos que el visor le pasa a `ficha.html`, armados como en `onFichaLoad` de
/// IntakeChat.vue. Sin UI, para poder probarlos.
enum DatosFicha {
    /// Campos que no cuentan como "cambió respecto de la consulta anterior".
    static let sinComparar: Set<String> = [
        "id", "fecha", "medico_id", "patient_id", "estado", "tipo", "created_at", "updated_at",
        "ficha_num", "examinador_nombre", "gravedad_total", "location",
    ]

    /// Paciente + episodio (el episodio pisa), con el nombre completo y la edad si falta.
    static func combinar(paciente: [String: JSONValor], episodio: [String: JSONValor], hoy: Date = .now) -> [String: JSONValor] {
        var datos = paciente.merging(episodio) { _, delEpisodio in delEpisodio }
        let nombre = [paciente["nombre"]?.texto, paciente["apellidos"]?.texto]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: " ")
        if !nombre.isEmpty { datos["nombre"] = .texto(nombre) }
        if datos["edad"] == nil || datos["edad"] == .nulo || datos["edad"] == .texto(""),
           let nacimiento = paciente["fecha_nac"]?.texto.flatMap(Fechas.dia),
           let anios = Calendar.current.dateComponents([.year], from: nacimiento, to: hoy).year,
           (0..<150).contains(anios) {
            datos["edad"] = .numero(Double(anios))
        }
        return datos
    }

    /// Lo que cambió respecto de la consulta anterior, con el valor que tenía (el visor pinta la
    /// etiqueta en rojo y muestra "Valor anterior: …").
    static func cambios(actual: [String: JSONValor], anterior: [String: JSONValor]?) -> [String: JSONValor] {
        guard let anterior else { return [:] }
        var cambios: [String: JSONValor] = [:]
        for clave in Set(actual.keys).union(anterior.keys) {
            if sinComparar.contains(clave) || clave.contains(":") { continue }
            if normalizado(actual[clave]) != normalizado(anterior[clave]) {
                cambios[clave] = anterior[clave] ?? .nulo
            }
        }
        return cambios
    }

    /// Como `norm` en la web: nulo, `false` y vacío valen lo mismo.
    static func normalizado(_ valor: JSONValor?) -> String {
        switch valor {
        case .none, .nulo, .booleano(false): ""
        case .texto(let texto): texto
        case .booleano(true): "true"
        case .numero: valor?.texto ?? ""
        case .lista, .objeto: (try? String(data: JSONEncoder().encode(valor), encoding: .utf8)) ?? ""
        }
    }

    /// Un objeto JSON listo para pegar en JavaScript. U+2028/U+2029 son válidos en JSON pero
    /// cortan una cadena de JavaScript.
    static func javascript(_ datos: [String: JSONValor]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let json = (try? String(data: encoder.encode(datos), encoding: .utf8)) ?? "{}"
        return json
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}
