import Foundation
import Observation

/// Estado de la sección Controles (PAPER §33.3): los próximos controles de los pacientes,
/// el buscador y el paciente que se está abriendo. Espejo de `Controles.vue`.
@MainActor
@Observable
final class ControlsModel {
    private(set) var controls: [PatientControl] = []
    /// «Hoy» según el servidor; `nil` hasta la primera respuesta.
    private(set) var today: String?
    private(set) var loaded = false
    private(set) var loading = false
    private(set) var error: String?
    var query = ""
    /// El control cuyo paciente se está pidiendo para abrirlo.
    private(set) var openingEpisode: String?
    /// El paciente listo para abrir en su Ficha.
    var openedPatient: FilaPaciente?
    var openError: String?

    @ObservationIgnored private var request = 0

    var visible: [PatientControl] { ControlsCalendar.filter(controls, query: query) }
    var groups: [ControlGroup] { ControlsCalendar.groups(visible, today: today) }

    /// Lo que se muestra cuando no hay filas.
    var emptyText: String {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? "No hay controles agendados en los próximos 90 días" : "Ningún control para «\(q)»"
    }

    /// Otra organización es otra lista: se vacía antes de pedirla.
    func reset() {
        request += 1
        controls = []
        today = nil
        loaded = false
        error = nil
        openedPatient = nil
    }

    func load(api: CEPIAPI) async {
        request += 1
        let mine = request
        loading = true
        error = nil
        defer { if mine == request { loading = false } }
        do {
            let list = try await api.controls()
            guard mine == request else { return }
            controls = list.data
            today = list.today
            loaded = true
        } catch {
            guard mine == request, !Task.isCancelled else { return }
            self.error = "No se pudieron cargar los controles: \(error.localizedDescription)"
        }
    }

    /// Pide el paciente al ERP y lo deja listo en `openedPatient`.
    func open(_ control: PatientControl, api: CEPIAPI) async {
        guard let id = control.patientId, openingEpisode == nil else { return }
        openingEpisode = control.episodeId
        openError = nil
        defer { openingEpisode = nil }
        do {
            openedPatient = FilaPaciente(try await api.entidad(id))
        } catch {
            guard !Task.isCancelled else { return }
            openError = "No se pudo abrir a \(control.patientName ?? "este paciente"): \(error.localizedDescription)"
        }
    }
}
