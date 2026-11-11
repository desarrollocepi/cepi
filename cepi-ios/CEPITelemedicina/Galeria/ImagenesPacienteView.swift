import SwiftUI

/// Las imágenes de un paciente: la cuarta sección de `PacienteView` (PAPER §24.2.1). Arriba,
/// sus dos consentimientos (§31.3); debajo, las fotos clínicas del episodio elegido en el
/// navegador del paciente, con «Ver todas» para las de todas sus consultas (§28.4.1). El nombre
/// del paciente no se repite en cada foto.
struct ImagenesPacienteView: View {
    let paciente: FilaPaciente
    /// El episodio elegido en el navegador del paciente.
    let episode: String?
    /// «Episodio N de M», para que el filtro diga de cuál son las fotos.
    let episodeTitle: String

    @Environment(Sesion.self) private var sesion
    @State private var modelo: GaleriaModelo
    @State private var consents: ConsentsModel
    @State private var showAll = false

    init(paciente: FilaPaciente, episode: String? = nil, episodeTitle: String = "Episodio") {
        self.paciente = paciente
        self.episode = episode
        self.episodeTitle = episodeTitle
        _modelo = State(initialValue: GaleriaModelo(paciente: paciente.id))
        _consents = State(initialValue: ConsentsModel(patient: paciente.id))
    }

    private var filter: String? { showAll ? nil : episode }

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            RejillaImagenes(
                modelo: modelo,
                vacio: EpisodeImages.emptyText(showAll: showAll, episode: episode),
                mostrarPaciente: false
            ) {
                PatientConsentsView(model: consents)
            }
            .refreshable {
                await Task {
                    await consents.load(api: sesion.api)
                    await modelo.recargar(api: sesion.api)
                }.value
            }
        }
        .task { await modelo.buscar("", api: sesion.api, esperar: .zero) }
        .task { await consents.load(api: sesion.api) }
        // Otro episodio en el navegador: se vuelve a sus fotos.
        .onChange(of: episode) { _, _ in showAll = false }
        .task(id: filter) { modelo.episodeFilter = filter }
        // Con filtro, las fotos del episodio pueden estar en páginas que no se pidieron: se piden
        // todas (un paciente tiene pocas). En una tarea aparte: cada página cambia la clave y la
        // cancelación cortaría el pedido.
        .task(id: "\(filter ?? "-")|\(modelo.imagenes.count)|\(modelo.hayMas)") {
            if filter != nil, modelo.hayMas, !modelo.cargando {
                let api = sesion.api
                Task { await modelo.siguientePagina(api: api) }
            }
        }
    }

    /// De qué episodio son las fotos y el botón para ver todas (o volver a las del episodio).
    /// El botón nunca se esconde: sin episodios sale gris con el motivo.
    private var filterBar: some View {
        let blockReason = EpisodeImages.onlyEpisodeBlockReason(episode: episode)
        let count = modelo.visibles.count
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(filter == nil ? "Todas las del paciente" : "Solo del \(episodeTitle.lowercased())")
                    .font(.footnote.weight(.semibold))
                Text(blockReason ?? (modelo.cargado ? (count == 1 ? "1 imagen" : "\(count) imágenes") : "Cargando…"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            if showAll {
                Button("Solo este episodio") { showAll = false }
                    .disabled(blockReason != nil)
                    .accessibilityHint(blockReason ?? "Muestra solo las fotos del episodio elegido")
                    .accessibilityIdentifier("imagenes.soloEpisodio")
            } else {
                Button("Ver todas") { showAll = true }
                    .disabled(blockReason != nil)
                    .accessibilityHint(blockReason ?? "Muestra las fotos de todos los episodios del paciente")
                    .accessibilityIdentifier("imagenes.verTodas")
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }
}
