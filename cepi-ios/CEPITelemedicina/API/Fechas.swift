import Foundation

enum Fechas {
    /// ISO 8601 como la manda el backend: con milisegundos (node-pg) o sin ellos.
    static func iso(_ texto: String?) -> Date? {
        guard let texto else { return nil }
        return (try? Date(texto, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
            ?? (try? Date(texto, strategy: Date.ISO8601FormatStyle()))
    }
}
