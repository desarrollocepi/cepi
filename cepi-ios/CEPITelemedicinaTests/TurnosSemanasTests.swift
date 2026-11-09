import Testing
@testable import CEPITelemedicina

/// Semanas de lunes a domingo del calendario de turnos (PAPER §32.3), como `Turnos.vue`.
struct TurnosSemanasTests {
    private func turno(_ id: String, _ user: String, _ desde: String, _ hasta: String) -> Shift {
        Shift(id: id, userId: user, userName: "Persona \(user)", startsOn: desde, endsOn: hasta)
    }

    @Test func lunesDeLaSemana() {
        #expect(ShiftCalendar.monday(of: "2026-11-09") == "2026-11-09") // lunes
        #expect(ShiftCalendar.monday(of: "2026-11-11") == "2026-11-09") // miércoles
        #expect(ShiftCalendar.monday(of: "2026-11-14") == "2026-11-09") // sábado
        // Domingo: es el último día de la semana que empezó el lunes anterior.
        #expect(ShiftCalendar.monday(of: "2026-11-15") == "2026-11-09")
        #expect(ShiftCalendar.monday(of: "2026-11-16") == "2026-11-16")
        // Cruza mes y año.
        #expect(ShiftCalendar.monday(of: "2027-01-01") == "2026-12-28")
    }

    @Test func ochoSemanasDesdeLaDeHoy() {
        let semanas = ShiftCalendar.weeks(today: "2026-11-11", shifts: [])
        #expect(semanas.count == 8)
        #expect(semanas.map(\.start) == [
            "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30",
            "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28",
        ])
        #expect(semanas.last?.end == "2027-01-03")
        #expect(semanas.map(\.isCurrent) == [true] + Array(repeating: false, count: 7))
        #expect(semanas[0].rangeText == "9 nov – 15 nov")
        #expect(semanas[7].rangeText == "28 dic – 3 ene")
        let rango = ShiftCalendar.range(today: "2026-11-11")
        #expect(rango.from == "2026-11-09")
        #expect(rango.to == "2027-01-03")
    }

    @Test func hoyDomingoEmpiezaEnElLunesAnterior() {
        let semanas = ShiftCalendar.weeks(today: "2026-11-15", shifts: [])
        #expect(semanas[0].start == "2026-11-09")
        #expect(semanas[0].end == "2026-11-15")
    }

    @Test func turnosQueTocanUnaSemana() {
        let entera = turno("a", "u1", "2026-11-09", "2026-11-15")
        let parcial = turno("b", "u2", "2026-11-18", "2026-11-20")
        let cruza = turno("c", "u3", "2026-11-14", "2026-11-17") // sábado a martes
        let lejos = turno("d", "u4", "2027-02-01", "2027-02-07")
        let semanas = ShiftCalendar.weeks(today: "2026-11-11", shifts: [entera, parcial, cruza, lejos])
        #expect(semanas[0].shifts.map(\.id) == ["a", "c"])
        #expect(semanas[1].shifts.map(\.id) == ["b", "c"])
        #expect(semanas[2].shifts.isEmpty)
        #expect(!semanas.contains { $0.shifts.contains(lejos) })
        #expect(!semanas[0].isPartial(entera))
        #expect(semanas[1].isPartial(parcial))
        #expect(semanas[0].isPartial(cruza))
        #expect(ShiftCalendar.shortDay(parcial.startsOn) == "18 nov")
    }

    @Test func deTurnoHoySinRepetir() {
        let turnos = [
            turno("a", "u1", "2026-11-09", "2026-11-15"),
            turno("b", "u1", "2026-11-11", "2026-11-11"),
            turno("c", "u2", "2026-11-12", "2026-11-15"),
        ]
        #expect(ShiftCalendar.onCall(on: "2026-11-11", shifts: turnos) == ["Persona u1"])
        #expect(ShiftCalendar.onCall(on: "2026-11-12", shifts: turnos) == ["Persona u1", "Persona u2"])
        #expect(ShiftCalendar.onCall(on: "2026-11-16", shifts: turnos).isEmpty)
    }
}
