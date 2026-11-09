import Testing
@testable import CEPITelemedicina

/// Agrupación de los controles por semana, de lunes a domingo (PAPER §33.3), como
/// `Controles.vue`.
struct ControlesSemanasTests {
    private func control(
        _ id: String, _ fecha: String, _ estado: ControlStatus,
        paciente: String = "Paciente", cedula: String? = nil
    ) -> PatientControl {
        PatientControl(
            episodeId: id, patientId: "p-\(id)", patientName: paciente, cedula: cedula,
            controlDate: fecha, status: estado
        )
    }

    /// Hoy lunes 9 nov 2026.
    private var lista: [PatientControl] {
        [
            control("a1", "2026-10-20", .overdue, paciente: "Ana Pérez", cedula: "0102"),
            control("a2", "2026-11-06", .overdue, paciente: "Luis Mora"),
            control("h", "2026-11-09", .today, paciente: "José Núñez", cedula: "0912345678"),
            control("w", "2026-11-15", .upcoming, paciente: "María"), // domingo: esta semana
            control("n1", "2026-11-16", .upcoming, paciente: "Pedro"),
            control("n2", "2026-11-22", .upcoming, paciente: "Rosa", cedula: "0102999"),
            control("l", "2026-12-02", .upcoming, paciente: "Carla"),
        ]
    }

    @Test func atrasadosArribaYDespuesPorSemana() {
        let grupos = ControlsCalendar.groups(lista, today: "2026-11-09")
        #expect(grupos.map(\.title) == ["Atrasados", "Esta semana", "Próxima semana", "Semana del 30 nov 2026"])
        #expect(grupos.map(\.key) == ["atrasados", "2026-11-09", "2026-11-16", "2026-11-30"])
        #expect(grupos[0].isOverdue)
        #expect(!grupos[1].isOverdue)
        #expect(grupos.map { $0.controls.map(\.id) } == [["a1", "a2"], ["h", "w"], ["n1", "n2"], ["l"]])
    }

    @Test func hoyDomingoEsDeLaSemanaQueTermina() {
        let grupos = ControlsCalendar.groups(lista, today: "2026-11-15")
        #expect(grupos[1].title == "Esta semana")
        #expect(grupos[2].title == "Próxima semana")
    }

    @Test func sinAtrasadosNoHayGrupoRojo() {
        let grupos = ControlsCalendar.groups(lista.filter { $0.status != .overdue }, today: "2026-11-09")
        #expect(grupos.first?.title == "Esta semana")
        #expect(ControlsCalendar.groups([], today: "2026-11-09").isEmpty)
    }

    @Test func sinHoyTodasSonSemanaDel() {
        let grupos = ControlsCalendar.groups([control("x", "2026-11-11", .upcoming)], today: nil)
        #expect(grupos.map(\.title) == ["Semana del 9 nov 2026"])
    }

    @Test func filtraPorPacienteOCedula() {
        #expect(ControlsCalendar.filter(lista, query: "").count == 7)
        #expect(ControlsCalendar.filter(lista, query: "  ").count == 7)
        // Cédula parcial: dos pacientes la contienen.
        #expect(ControlsCalendar.filter(lista, query: "0102").map(\.id) == ["a1", "n2"])
        // Sin tildes ni mayúsculas.
        #expect(ControlsCalendar.filter(lista, query: "jose nuñez").map(\.id) == ["h"])
        #expect(ControlsCalendar.filter(lista, query: "PEREZ").map(\.id) == ["a1"])
        #expect(ControlsCalendar.filter(lista, query: "nadie").isEmpty)

        let grupos = ControlsCalendar.groups(ControlsCalendar.filter(lista, query: "0102"), today: "2026-11-09")
        #expect(grupos.map(\.title) == ["Atrasados", "Próxima semana"])
    }

    @Test func textosDeFecha() {
        #expect(ControlsCalendar.weekday("2026-11-09") == "lunes")
        #expect(ControlsCalendar.weekday("2026-11-15") == "domingo")
        #expect(ControlsCalendar.weekday("2026-11-14") == "sábado")
        #expect(ControlsCalendar.longDate("2026-11-30") == "30 nov 2026")
        #expect(ControlsCalendar.longDate("2027-01-03") == "3 ene 2027")
    }
}
