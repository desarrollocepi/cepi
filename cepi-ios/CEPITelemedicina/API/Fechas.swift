import Foundation

enum Fechas {
    /// ISO 8601 como la manda el backend: con milisegundos (node-pg) o sin ellos.
    static func iso(_ texto: String?) -> Date? {
        guard let texto else { return nil }
        return (try? Date(texto, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
            ?? (try? Date(texto, strategy: Date.ISO8601FormatStyle()))
    }

    /// Un día `YYYY-MM-DD` (lo que manda `<input type="date">`), en el calendario local.
    static func dia(_ texto: String) -> Date? {
        let partes = texto.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard partes.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: partes[0], month: partes[1], day: partes[2]))
    }

    static func textoDia(_ fecha: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: fecha)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
