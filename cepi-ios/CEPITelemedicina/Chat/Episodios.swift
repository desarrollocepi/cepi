import Foundation

/// Qué página del hilo se mira: la consulta más nueva o una en particular. `String?` porque
/// los turnos viejos sin episodio también forman una página.
enum PaginaHilo: Equatable, Sendable {
    case masNueva
    case consulta(String?)
}

/// El hilo partido por consultas, como en IntakeChat.vue: un episodio por página.
struct Episodios: Sendable {
    /// Episodios distintos en orden de aparición. El activo va al final aunque todavía no tenga
    /// mensajes: una consulta recién abierta también es una página.
    let orden: [String?]

    init(mensajes: [MensajeHilo], activo: String?) {
        var vistos = Set<String?>()
        var orden: [String?] = []
        for mensaje in mensajes where vistos.insert(mensaje.episodio).inserted {
            orden.append(mensaje.episodio)
        }
        if let activo, !vistos.contains(activo) { orden.append(activo) }
        self.orden = orden
    }

    func indice(de pagina: PaginaHilo) -> Int {
        if case .consulta(let id) = pagina, let indice = orden.firstIndex(of: id) { return indice }
        return max(orden.count - 1, 0)
    }

    /// Los mensajes de una página. El aviso "Paciente activo: …" lo repite el bot en cada
    /// activación; se deja solo el último para que no se acumule.
    func visibles(_ mensajes: [MensajeHilo], indice: Int) -> [MensajeHilo] {
        var lista = orden.count <= 1 ? mensajes : mensajes.filter { $0.episodio == orden[indice] }
        if let ultimo = lista.lastIndex(where: Self.esAvisoDeActivacion) {
            lista = lista.enumerated()
                .filter { $0.offset == ultimo || !Self.esAvisoDeActivacion($0.element) }
                .map(\.element)
        }
        return lista
    }

    /// Solo en la consulta activa se escribe; las anteriores son de lectura.
    func esActiva(indice: Int, activo: String?) -> Bool {
        guard orden.count > 1 else { return true }
        let actual = activo ?? orden[orden.count - 1]
        return orden[indice] == actual
    }

    func etiqueta(indice: Int, mensajes: [MensajeHilo]) -> String {
        // Con una sola consulta, decirlo explica por qué las flechas no llevan a ningún lado.
        guard orden.count != 1 else { return "Única consulta" }
        guard !orden.isEmpty else { return "Sin consultas todavía" }
        let fecha = mensajes.first { $0.episodio == orden[indice] }?.fecha
        let cuando = fecha.map {
            " · " + $0.formatted(.dateTime.day(.twoDigits).month(.abbreviated).locale(Locale(identifier: "es")))
        } ?? ""
        return "Consulta \(indice + 1)/\(orden.count)\(cuando)"
    }

    /// El autor sobre un mensaje ajeno, una vez por racha del mismo autor (como un grupo de
    /// WhatsApp). `nil` = no se muestra.
    static func autor(en lista: [MensajeHilo], indice: Int) -> String? {
        let mensaje = lista[indice]
        guard !mensaje.propio else { return nil }
        if indice > 0 {
            let previo = lista[indice - 1]
            if !previo.propio && previo.autorId == mensaje.autorId { return nil }
        }
        return mensaje.esBot ? "Asistente" : (mensaje.autorNombre ?? "Profesional")
    }

    static func esAvisoDeActivacion(_ mensaje: MensajeHilo) -> Bool {
        mensaje.esBot && mensaje.contenido.drop(while: \.isWhitespace).hasPrefix("Paciente activo:")
    }
}
