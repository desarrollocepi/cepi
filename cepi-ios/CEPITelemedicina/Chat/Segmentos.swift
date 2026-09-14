import Foundation

/// Un trozo de un mensaje del hilo: texto o una imagen (id de adjunto).
enum Segmento: Hashable, Sendable {
    case texto(String)
    case imagen(id: String, nombre: String?)

    /// Espejo de `MessageContent.vue`. Dos marcadores se pintan como imagen: `[img:<uuid>]`, que
    /// emite el bot, y `[adjunto: <nombre> · <uuid>]`, que emite quien sube una foto.
    static func dividir(_ contenido: String) -> [Segmento] {
        let marcador = #/\[img:(?<img>[0-9a-fA-F-]{36})\]|\[adjunto:\s*(?<nombre>[^·\]]+?)\s*·\s*(?<adjunto>[0-9a-fA-F-]{36})\s*\]/#
        var segmentos: [Segmento] = []
        var cursor = contenido.startIndex
        for coincidencia in contenido.matches(of: marcador) {
            let antes = recortado(contenido[cursor..<coincidencia.range.lowerBound])
            if !antes.isEmpty { segmentos.append(.texto(antes)) }
            if let id = coincidencia.output.img {
                segmentos.append(.imagen(id: id.lowercased(), nombre: nil))
            } else if let id = coincidencia.output.adjunto {
                let nombre = coincidencia.output.nombre.map { $0.trimmingCharacters(in: .whitespaces) }
                segmentos.append(.imagen(id: id.lowercased(), nombre: nombre))
            }
            cursor = coincidencia.range.upperBound
        }
        let resto = recortado(contenido[cursor...])
        if !resto.isEmpty { segmentos.append(.texto(resto)) }
        return segmentos.isEmpty ? [.texto(contenido)] : segmentos
    }

    /// Sin saltos de línea al principio ni espacios al final: alrededor de una imagen dejarían
    /// renglones vacíos.
    private static func recortado(_ texto: Substring) -> String {
        let sinSaltos = texto.drop(while: \.isNewline)
        var fin = sinSaltos.endIndex
        while fin > sinSaltos.startIndex, sinSaltos[sinSaltos.index(before: fin)].isWhitespace {
            fin = sinSaltos.index(before: fin)
        }
        return String(sinSaltos[sinSaltos.startIndex..<fin])
    }
}
