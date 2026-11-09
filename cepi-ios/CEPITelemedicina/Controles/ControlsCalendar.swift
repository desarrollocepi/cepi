import Foundation

/// Un grupo de la lista de controles: los atrasados o una semana de lunes a domingo.
struct ControlGroup: Identifiable, Hashable, Sendable {
    /// `atrasados` o el lunes de la semana (`YYYY-MM-DD`).
    let key: String
    let title: String
    let controls: [PatientControl]

    static let overdueKey = "atrasados"

    var id: String { key }
    var isOverdue: Bool { key == Self.overdueKey }
}

/// Agrupación y textos de la sección Controles (PAPER §33.3). Espejo de `grupos`, `diaSemana`
/// y `fechaLarga` en `Controles.vue`. La aritmética de semanas es la de los turnos.
enum ControlsCalendar {
    private static let weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
    private static let months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

    private static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static func parts(_ iso: String) -> [Int]? {
        let p = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, (1...12).contains(p[1]) else { return nil }
        return p
    }

    /// «miércoles».
    static func weekday(_ iso: String) -> String {
        guard let p = parts(iso),
              let d = calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return "" }
        return weekdays[calendar.component(.weekday, from: d) - 1]
    }

    /// «11 nov 2026».
    static func longDate(_ iso: String) -> String {
        guard let p = parts(iso) else { return iso }
        return "\(p[2]) \(months[p[1] - 1]) \(p[0])"
    }

    /// Paciente y cédula; sin mayúsculas ni tildes, como la lista de pacientes.
    static func filter(_ controls: [PatientControl], query: String) -> [PatientControl] {
        let q = FilaPaciente.normalizar(query.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !q.isEmpty else { return controls }
        return controls.filter {
            FilaPaciente.normalizar("\($0.patientName ?? "") \($0.cedula ?? "")").contains(q)
        }
    }

    /// Atrasados arriba; después, una sección por semana (lunes a domingo) en el orden en que
    /// llegan, que es por fecha de control.
    static func groups(_ controls: [PatientControl], today: String?) -> [ControlGroup] {
        var out: [ControlGroup] = []
        let overdue = controls.filter { $0.status == .overdue }
        if !overdue.isEmpty {
            out.append(ControlGroup(key: ControlGroup.overdueKey, title: "Atrasados", controls: overdue))
        }
        let current = today.map(ShiftCalendar.monday(of:))
        let next = current.map { ShiftCalendar.addDays($0, 7) }
        var order: [String] = []
        var byWeek: [String: [PatientControl]] = [:]
        for control in controls where control.status != .overdue {
            let monday = ShiftCalendar.monday(of: control.controlDate)
            if byWeek[monday] == nil { order.append(monday) }
            byWeek[monday, default: []].append(control)
        }
        for monday in order {
            let title = monday == current ? "Esta semana"
                : monday == next ? "Próxima semana"
                : "Semana del \(longDate(monday))"
            out.append(ControlGroup(key: monday, title: title, controls: byWeek[monday] ?? []))
        }
        return out
    }

    /// La línea gris: diagnóstico · «indicó …» · «consulta del …».
    static func metaLine(_ control: PatientControl) -> String {
        [
            control.diagnosis,
            control.doctor.map { "indicó \($0)" },
            control.consultationDate.map { "consulta del \(longDate($0))" },
        ].compactMap { $0 }.joined(separator: " · ")
    }
}
