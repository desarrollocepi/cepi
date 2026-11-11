import Foundation
import Observation
import SwiftUI

/// Las reglas del navegador de episodios del paciente (PAPER §28.4.1), sin UI, para poder
/// probarlas. La barra «Episodio N de M» sale debajo del selector de secciones, en Chat, Ficha,
/// Evolución e Imágenes, y el episodio elegido vale para las cuatro.
enum EpisodeNavigation {
    /// El episodio a la vista: el que se eligió en la barra; si no, el activo del chat; si
    /// tampoco hay, el más nuevo del paciente.
    static func current(selected: String?, active: String?, visits: [Registro]) -> String? {
        selected ?? active ?? visits.first?.id
    }

    /// La línea bajo «Episodio N de M». Nunca vacía: dice por qué una flecha está gris.
    static func note(_ nav: FichaLogic.Navigation, loading: Bool, failed: Bool, motivo: String? = nil) -> String {
        if loading && nav.count == 0 { return "buscando los episodios…" }
        if failed && nav.count == 0 { return "no se pudieron listar los episodios" }
        if nav.count == 0 { return "sin consultas registradas de este paciente" }
        if nav.count == 1 { return "único episodio registrado de este paciente" }
        if nav.index == nil { return "episodio recién abierto: todavía no está en la lista" }
        if !nav.hasNext { return "es el episodio más reciente" }
        if !nav.hasPrevious { return "es el primer episodio del paciente" }
        return motivo ?? "usa las flechas para ir a otro episodio"
    }

    /// El episodio al que hay que llevar el chat (`episode_switch`), o `nil`: solo con el chat
    /// a la vista y cuando lo elegido no es lo que el chat ya muestra. Que el chat esté ocupado
    /// no importa: el modelo deja el cambio pedido y lo aplica al terminar.
    static func chatSwitch(selected: String?, shown: String?, inChat: Bool) -> String? {
        guard inChat, let selected, selected != shown else { return nil }
        return selected
    }
}

/// Las fotos de la sección Imágenes según el episodio elegido (PAPER §28.4.1): las de ese
/// episodio o, con «Ver todas», las del paciente.
enum EpisodeImages {
    static func filter(_ images: [ImagenGaleria], episode: String?, showAll: Bool) -> [ImagenGaleria] {
        guard !showAll, let episode else { return images }
        return images.filter { $0.episodioId == episode }
    }

    /// Qué decir cuando no queda ninguna.
    static func emptyText(showAll: Bool, episode: String?) -> String {
        if showAll || episode == nil { return "Este paciente todavía no tiene imágenes" }
        return "Este episodio no tiene imágenes. «Ver todas» muestra las del paciente."
    }

    /// Por qué «Solo este episodio» está gris, o `nil` si se puede.
    static func onlyEpisodeBlockReason(episode: String?) -> String? {
        episode == nil ? "Este paciente todavía no tiene episodios" : nil
    }
}

/// El estado del navegador: las consultas del paciente (de la más nueva a la más vieja) y cuál
/// se eligió. Lo tiene `PacienteView`, que se lo pasa a las cuatro secciones.
@MainActor
@Observable
final class EpisodeNavigatorModel {
    let patientId: String
    private(set) var visits: [Registro] = []
    private(set) var loading = false
    private(set) var failed = false
    /// Lo elegido en la barra; `nil` = seguir al episodio activo del chat.
    private(set) var selected: String?
    private(set) var activeEpisode: String?

    init(patientId: String) {
        self.patientId = patientId
    }

    var current: String? {
        EpisodeNavigation.current(selected: selected, active: activeEpisode, visits: visits)
    }

    var navigation: FichaLogic.Navigation { FichaLogic.Navigation(visits: visits, episode: current) }

    var currentVisit: Registro? { visits.first { $0.id == current } }

    var note: String {
        EpisodeNavigation.note(navigation, loading: loading, failed: failed, motivo: currentVisit?["motivo_consulta"])
    }

    func load(api: CEPIAPI) async {
        loading = true
        defer { loading = false }
        do {
            visits = try await api.episodios(paciente: patientId)
            failed = false
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }

    func select(_ episode: String?) {
        selected = episode
    }

    func goPrevious() {
        guard let index = navigation.previousIndex else { return }
        selected = visits[index].id
    }

    func goNext() {
        guard let index = navigation.nextIndex else { return }
        selected = visits[index].id
    }

    /// El chat cambió de episodio (lo activó el bot: abrir, nueva consulta, `episode_switch`):
    /// el navegador lo sigue. Con `keepSelection` (en el chat ya se pidió otro, que espera su
    /// turno) lo elegido se mantiene. Una consulta recién abierta todavía no está en la lista:
    /// se relee.
    func follow(active: String?, keepSelection: Bool = false, api: CEPIAPI) async {
        activeEpisode = active
        if !keepSelection || selected == active { selected = nil }
        if let active, !visits.contains(where: { $0.id == active }) { await load(api: api) }
    }
}

/// La barra «Episodio N de M» con Anterior / Siguiente. Sale siempre, aunque haya un solo
/// episodio: las flechas grises y la nota dicen por qué (CLAUDE.md: nunca ocultes un botón).
struct EpisodeNavigatorBar: View {
    let model: EpisodeNavigatorModel
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        let nav = model.navigation
        HStack {
            Button("Anterior", systemImage: "chevron.left", action: onPrevious)
                .labelStyle(.iconOnly)
                .disabled(!nav.hasPrevious)
                .accessibilityHint(nav.previousHint)
                .accessibilityIdentifier("episodios.anterior")
            Spacer(minLength: 4)
            VStack(spacing: 1) {
                HStack(spacing: 6) {
                    Text(nav.title).font(.footnote.weight(.semibold))
                    if let date = FichaLogic.date(of: model.currentVisit) {
                        Text(date).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text(model.note)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("episodios.titulo")
            Spacer(minLength: 4)
            Button("Siguiente", systemImage: "chevron.right", action: onNext)
                .labelStyle(.iconOnly)
                .disabled(!nav.hasNext)
                .accessibilityHint(nav.nextHint)
                .accessibilityIdentifier("episodios.siguiente")
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(.bar)
    }
}
