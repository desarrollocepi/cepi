import Foundation
import Observation

/// El estado de la sección Ficha: la consulta a la vista, sus grupos, las consultas del
/// paciente para navegar y el guardado de un grupo. Sin UI, para poder probarlo.
@MainActor
@Observable
final class FichaModel {
    let patientId: String
    /// La consulta a la vista; `nil` si el paciente no tiene ninguna (solo sus datos).
    private(set) var episodeId: String?
    private(set) var ficha: FullFicha?
    /// Las consultas del paciente, de la más nueva a la más vieja.
    private(set) var visits: [Registro] = []
    private(set) var loading = false
    private(set) var loadingVisits = false
    private(set) var visitsFailed = false
    private(set) var error: String?
    private(set) var saving = false
    /// «Guardado · 80% de la ficha» o el error del último guardado.
    private(set) var notice: String?
    private(set) var noticeIsError = false
    var onlyMissing = false
    /// El grupo cuyo formulario está abierto.
    var editing: FichaGroup?

    init(patientId: String) {
        self.patientId = patientId
    }

    // MARK: Derivados

    var groups: [FichaGroup] { ficha?.groups ?? [] }
    var complete: Int { ficha?.complete ?? 0 }
    var total: Int { ficha?.total ?? groups.count }
    var percent: Int { FichaLogic.percent(complete: complete, total: total) }
    var categories: [FichaLogic.Category] { FichaLogic.categories(groups, onlyMissing: onlyMissing) }
    var navigation: FichaLogic.Navigation { FichaLogic.Navigation(visits: visits, episode: episodeId) }

    var currentVisit: Registro? { visits.first { $0.id == episodeId } }
    var previousVisit: Registro? { navigation.previousIndex.map { visits[$0] } }
    var specialistAnswer: FichaLogic.SpecialistAnswer? { FichaLogic.specialistAnswer(currentVisit) }
    var changeCount: Int { FichaLogic.changeCount(groups, previous: previousVisit?.data) }

    var navigationNote: String {
        FichaLogic.navigationNote(
            navigation, loading: loadingVisits, failed: visitsFailed,
            changes: changeCount, previousDate: FichaLogic.date(of: previousVisit)
        )
    }

    func values(of group: FichaGroup) -> [FichaLogic.Value] {
        FichaLogic.values(group, previous: previousVisit?.data)
    }

    // MARK: Carga

    /// Trae las consultas y la ficha de `preferred` (o de la consulta activa, o de la más
    /// nueva). Recargar no vacía la ficha: se sigue viendo mientras llega la otra.
    func open(preferred: String?, api: CEPIAPI) async {
        loadingVisits = true
        do {
            visits = try await api.episodios(paciente: patientId)
            visitsFailed = false
        } catch {
            visitsFailed = true
        }
        loadingVisits = false
        // Una consulta recién abierta puede no estar todavía en la lista: se respeta igual.
        await show(preferred ?? visits.first?.id, api: api)
    }

    /// Pasa a otra consulta del paciente (Anterior, Siguiente, la evolución).
    func show(_ episode: String?, api: CEPIAPI) async {
        if episode != episodeId { editing = nil; notice = nil }
        episodeId = episode
        await reload(api: api)
    }

    func goPrevious(api: CEPIAPI) async {
        guard let index = navigation.previousIndex else { return }
        await show(visits[index].id, api: api)
    }

    func goNext(api: CEPIAPI) async {
        guard let index = navigation.nextIndex else { return }
        await show(visits[index].id, api: api)
    }

    func reload(api: CEPIAPI) async {
        let episode = episodeId
        loading = true
        error = nil
        defer { if episodeId == episode { loading = false } }
        do {
            let loaded = try await api.fullFicha(episode: episode, patient: patientId)
            // Si mientras tanto se pasó a otra consulta, esta respuesta ya no vale.
            guard episodeId == episode else { return }
            ficha = loaded
        } catch {
            guard episodeId == episode else { return }
            self.error = "No se pudo cargar la ficha: \(error.localizedDescription)"
            ficha = nil
        }
    }

    // MARK: Edición

    func edit(_ group: FichaGroup) {
        guard FichaLogic.isEditable(group) else { return }
        notice = nil
        editing = group
    }

    func cancelEditing() {
        editing = nil
    }

    /// Guarda el grupo y recarga la ficha entera: guardar puede mover campos derivados de
    /// otros grupos (gravedad_total) y el % de llenado. Devuelve el error, si lo hubo; el
    /// formulario queda abierto para reintentar.
    @discardableResult
    func save(_ group: FichaGroup, data: [String: JSONValor], api: CEPIAPI) async -> String? {
        saving = true
        defer { saving = false }
        do {
            let result = try await api.saveFichaGroup(FichaGroupSave(
                groupId: group.id, data: data, episodeId: episodeId, patientId: patientId
            ))
            editing = nil
            await reload(api: api)
            notice = FichaLogic.savedNotice(result)
            noticeIsError = false
            return nil
        } catch {
            let message = error.localizedDescription.isEmpty ? "No se pudo guardar" : error.localizedDescription
            notice = message
            noticeIsError = true
            return message
        }
    }
}
