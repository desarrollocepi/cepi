import Foundation

/// Una semana del calendario de turnos, de lunes a domingo (PAPER §32.3).
struct ShiftWeek: Identifiable, Hashable, Sendable {
    /// Lunes, `YYYY-MM-DD`.
    let start: String
    /// Domingo, `YYYY-MM-DD`.
    let end: String
    /// La semana de «hoy»: se marca «Esta semana».
    let isCurrent: Bool
    /// Los turnos que tocan al menos un día de la semana.
    let shifts: [Shift]

    var id: String { start }

    /// «9 nov – 15 nov».
    var rangeText: String { "\(ShiftCalendar.shortDay(start)) – \(ShiftCalendar.shortDay(end))" }

    /// El turno no cubre la semana entera: se muestra con su rango entre paréntesis.
    func isPartial(_ shift: Shift) -> Bool { shift.startsOn > start || shift.endsOn < end }
}

/// Aritmética de días `YYYY-MM-DD`, sin horas ni zona: el «hoy» ya lo decidió el servidor.
/// Espejo de `sumarDias`, `lunesDe` y `diaCorto` en `Turnos.vue`. Las fechas ISO se comparan
/// como texto, igual que en la web.
enum ShiftCalendar {
    static let weekCount = 8

    private static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static let months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

    private static func date(_ iso: String) -> Date? {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private static func iso(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func addDays(_ iso: String, _ days: Int) -> String {
        guard let d = date(iso), let moved = calendar.date(byAdding: .day, value: days, to: d) else { return iso }
        return Self.iso(moved)
    }

    /// El lunes de la semana del día dado; un domingo pertenece a la semana que termina ese día.
    static func monday(of iso: String) -> String {
        guard let d = date(iso) else { return iso }
        let weekday = calendar.component(.weekday, from: d) // 1 = domingo
        return addDays(iso, weekday == 1 ? -6 : 2 - weekday)
    }

    /// «9 nov».
    static func shortDay(_ iso: String) -> String {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]) else { return iso }
        return "\(parts[2]) \(months[parts[1] - 1])"
    }

    /// Fecha local del dispositivo, para la primera petición antes de saber el «hoy» del servidor.
    static func localToday(_ now: Date = .now) -> String {
        Fechas.textoDia(now)
    }

    /// El rango que se pide al servidor: del lunes de `today` al domingo de la última semana.
    static func range(today: String, weeks: Int = weekCount) -> (from: String, to: String) {
        let from = monday(of: today)
        return (from, addDays(from, 7 * weeks - 1))
    }

    /// Las semanas desde la de `today`, cada una con los turnos que la tocan.
    static func weeks(today: String, shifts: [Shift], count: Int = weekCount) -> [ShiftWeek] {
        let first = monday(of: today)
        return (0..<count).map { i in
            let start = addDays(first, 7 * i)
            let end = addDays(start, 6)
            return ShiftWeek(
                start: start, end: end, isCurrent: i == 0,
                shifts: shifts.filter { $0.startsOn <= end && $0.endsOn >= start }
            )
        }
    }

    /// Quién está de turno ese día, sin repetir nombres.
    static func onCall(on day: String, shifts: [Shift]) -> [String] {
        var seen = Set<String>()
        return shifts
            .filter { $0.startsOn <= day && $0.endsOn >= day }
            .map(\.displayName)
            .filter { seen.insert($0).inserted }
    }
}
