import SwiftUI

/// La sección Evolución del paciente (PAPER §28.3 y §28.4): nativa y adaptable, como
/// `EvolucionPaciente.vue` con `plegable=false` en el teléfono. Muestra las evoluciones (citas)
/// de la **ficha abierta**, con su cabecera (motivo, fecha de apertura y estado), una tarjeta
/// por evolución, la más nueva primero. Arriba, «＋ Agregar evolución»; debajo, plegadas, las
/// otras fichas del paciente. Las observaciones se editan en línea (✏️): en una evolución
/// registrada, `POST /api/bot/evolucion/editar`; en la fila armada, la sección 7 de la ficha
/// (`g_7`). Tocar una tarjeta abre esa ficha en la sección Ficha. El documento imprimible
/// (`evolucion.html`, `EvolucionView`) queda detrás de «Imprimir».
struct PatientEvolutionView: View {
    let patientId: String
    /// La ficha a la vista en la sección Ficha: se resalta.
    let current: String?
    /// Quien la contiene la sube cada vez que la sección vuelve a la vista: se vuelve a pedir,
    /// porque entre una vez y otra se pudo guardar un diagnóstico.
    var reload = 0
    /// Otra ficha elegida en «Otras fichas del paciente»: la barra de episodios la sigue.
    var onSelectEpisode: (String) -> Void = { _ in }
    let onOpen: (String) -> Void

    @Environment(Sesion.self) private var sesion
    @State private var rows: [FilaEvolucion] = []
    @State private var loaded = false
    @State private var loading = false
    @State private var error: String?
    /// La fila cuyas observaciones se editan: solo una a la vez.
    @State private var editing: String?
    @State private var draft = ""
    @State private var saving = false
    @State private var saveError: String?
    @State private var printing = false
    /// La ficha elegida aquí, mientras la barra de episodios no la confirma.
    @State private var selected: String?
    @State private var showOthers = false
    @State private var adding = false

    private var effectiveCurrent: String? { selected ?? current }
    private var groups: [EvolutionLogic.EpisodeGroup] { EvolutionLogic.groups(rows) }
    private var openGroup: EvolutionLogic.EpisodeGroup? { EvolutionLogic.openGroup(groups, current: effectiveCurrent) }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .task(id: "\(reload)|\(patientId)") { await load() }
        .onChange(of: current) { _, _ in selected = nil }
        .sheet(isPresented: $adding) {
            if let group = openGroup {
                AddEvolutionView(episodeId: group.episodeId, motivo: group.motivo) { await load() }
                    .environment(sesion)
            }
        }
        .sheet(isPresented: $printing) {
            NavigationStack {
                EvolucionView(pacienteId: patientId, actual: effectiveCurrent) { episode in
                    printing = false
                    onOpen(episode)
                }
                .navigationTitle("Evolución para imprimir")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cerrar") { printing = false }
                    }
                }
            }
            .environment(sesion)
        }
    }

    // MARK: Cabecera

    private var header: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Evolución del paciente").font(.subheadline.weight(.semibold))
                Text(loaded ? EvolutionLogic.summary(groups) : "Las citas de cada ficha: hallazgos, diagnósticos y tratamiento")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button("Actualizar", systemImage: "arrow.clockwise") { Task { await load() } }
                .labelStyle(.iconOnly)
                .disabled(loading)
                .accessibilityHint(loading ? "Ya se está cargando" : "Volver a leer las fichas")
            Button("Imprimir", systemImage: "printer") { printing = true }
                .disabled(rows.isEmpty)
                .accessibilityHint(rows.isEmpty ? "Sin fichas no hay nada que imprimir" : "Abrir la ficha de evolución para imprimir")
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: Contenido

    @ViewBuilder
    private var content: some View {
        if loading && rows.isEmpty {
            ProgressView("Cargando la evolución…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            VStack(spacing: 10) {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                Button("Reintentar") { Task { await load() } }
                    .buttonStyle(.bordered)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if rows.isEmpty {
            // «＋ Agregar evolución» existe aunque no haya ficha: gris, con el motivo.
            VStack(spacing: 10) {
                Text("Este paciente todavía no tiene fichas registradas.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                let reason = EvolutionLogic.addBlockReason(group: nil, loading: loading)
                Button("＋ Agregar evolución") {}
                    .buttonStyle(.borderedProminent)
                    .disabled(true)
                    .accessibilityHint(reason ?? "")
                    .accessibilityIdentifier("evolucion.agregar")
                Text(reason ?? "")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    if let group = openGroup {
                        groupHeader(group)
                        ForEach(group.rows) { row in
                            card(row)
                        }
                        nextControlFooter(group)
                    }
                    othersSection
                }
                .padding(12)
            }
            .refreshable { await load() }
        }
    }

    /// Cabecera de la ficha abierta (motivo, fecha de apertura, estado) y «＋ Agregar evolución»,
    /// que nunca se esconde: con la ficha de alta sale gris con el motivo.
    private func groupHeader(_ group: EvolutionLogic.EpisodeGroup) -> some View {
        let reason = EvolutionLogic.addBlockReason(group: group, loading: loading)
        return VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(EvolutionLogic.headerTitle(group))
                    .font(.headline)
                    .italic(group.motivo == nil)
                Text(EvolutionLogic.headerDetail(group))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Button { adding = true } label: {
                Label("＋ Agregar evolución", systemImage: "plus.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(reason != nil)
            .accessibilityHint(reason ?? "Una cita más en esta ficha: control del mismo motivo")
            .accessibilityIdentifier("evolucion.agregar")
            Text(reason ?? "Para un control del mismo motivo. Otro motivo de consulta es una consulta nueva.")
                .font(.caption)
                .foregroundStyle(reason == nil ? Color.secondary : Color.orange)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// «Próximo control» al pie de la ficha abierta (PAPER §28.4): fecha, qué hacer y estado.
    private func nextControlFooter(_ group: EvolutionLogic.EpisodeGroup) -> some View {
        let control = EvolutionLogic.nextControl(group, today: EvolutionLogic.localToday())
        let color: Color = switch control {
        case .scheduled(_, _, .overdue): .red
        case .scheduled(_, _, .today): .orange
        case .scheduled: .blue
        default: .secondary
        }
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Próximo control").font(.subheadline.weight(.semibold))
                Spacer()
                if let label = control.statusLabel {
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .foregroundStyle(color)
                        .background(color.opacity(0.15), in: Capsule())
                }
            }
            Text(control.text)
                .font(.footnote)
                .foregroundStyle({ if case .scheduled = control { return Color.primary } else { return Color.secondary } }())
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("evolucion.proximoControl")
    }

    /// «Otras fichas del paciente», plegadas: una línea por ficha; tocarla cambia a esa ficha.
    private var othersSection: some View {
        let others = EvolutionLogic.otherGroups(groups, current: effectiveCurrent)
        return DisclosureGroup(isExpanded: $showOthers) {
            if others.isEmpty {
                Text("Es la única ficha de este paciente.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
            }
            ForEach(others) { group in
                Button {
                    selected = group.episodeId
                    onSelectEpisode(group.episodeId)
                } label: {
                    HStack {
                        Text(EvolutionLogic.otherLine(group))
                            .font(.subheadline)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Ver las evoluciones de esta ficha")
                .accessibilityIdentifier("evolucion.otra.\(group.episodeId)")
            }
        } label: {
            Text("Otras fichas del paciente (\(others.count))")
                .font(.subheadline.weight(.semibold))
        }
        .padding(12)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }

    private func card(_ row: FilaEvolucion) -> some View {
        let isCurrent = row.episodio == effectiveCurrent
        let isLatest = openGroup?.rows.first?.id == row.id
        return VStack(alignment: .leading, spacing: 8) {
            if let badge = EvolutionLogic.rowBadge(row) {
                Text(badge)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Marca.acento)
            }
            // La parte de arriba abre la ficha; las observaciones, abajo, no (se editan acá).
            Button { onOpen(row.episodio) } label: {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(Array(EvolutionLogic.cells(row).enumerated()), id: \.offset) { index, cell in
                        cellView(cell, specialist: index == 1 ? row.especialista : nil)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(isCurrent ? "Es la ficha que estás viendo; abre la sección Ficha" : "Abrir esta ficha")
            .accessibilityIdentifier("evolucion.ficha.\(row.id)")

            Divider()
            observations(row)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        // La más nueva es la vigente: la que muestra la cabecera de la ficha (PAPER §28.4).
        .background(
            isLatest ? Marca.acento.opacity(0.12) : Color(uiColor: .secondarySystemBackground),
            in: RoundedRectangle(cornerRadius: 10)
        )
        .overlay(alignment: .leading) {
            if isLatest {
                Rectangle().fill(Marca.acento).frame(width: 3)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func cellView(_ cell: EvolutionLogic.Cell, specialist: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(cell.label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 110, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(cell.text)
                    .font(.subheadline)
                    .italic(cell.empty)
                    .foregroundStyle(cell.empty ? Color.secondary : Color.primary)
                    .multilineTextAlignment(.leading)
                if let specialist, !specialist.isEmpty {
                    Text("Especialista: \(specialist)")
                        .font(.caption)
                        .foregroundStyle(Marca.acento)
                }
            }
        }
    }

    /// Observaciones se escribe aquí mismo (pedido de las dermatólogas): guarda en la sección 7
    /// de esa ficha, sin confirmación, porque es una acción explícita.
    @ViewBuilder
    private func observations(_ row: FilaEvolucion) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("Observaciones")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 110, alignment: .leading)
            if editing == row.id {
                VStack(alignment: .leading, spacing: 6) {
                    TextField(row.isAssembled ? "Resumen de lo más importante de esta ficha" : "Resumen de esta cita", text: $draft, axis: .vertical)
                        .lineLimit(3...8)
                        .textFieldStyle(.roundedBorder)
                        .disabled(saving)
                        .accessibilityLabel("Observaciones")
                        .accessibilityIdentifier("evolucion.observaciones.texto")
                    if let saveError {
                        Text(saveError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                    HStack {
                        Button(saving ? "Guardando…" : "Guardar") { Task { await save(row) } }
                            .buttonStyle(.borderedProminent)
                            .disabled(!EvolutionLogic.canSave(draft: draft, original: row.observaciones, saving: saving))
                            .accessibilityHint(EvolutionLogic.saveHint(draft: draft, original: row.observaciones, saving: saving))
                            .accessibilityIdentifier("evolucion.observaciones.guardar")
                        Button("Cancelar") { cancel() }
                            .buttonStyle(.bordered)
                            .disabled(saving)
                    }
                    .controlSize(.small)
                }
            } else {
                let text = EvolutionLogic.observationsText(row)
                let blockReason = EvolutionLogic.editBlockReason(row: row.id, editing: editing)
                Text(text)
                    .font(.subheadline)
                    .italic(row.observaciones == nil)
                    .foregroundStyle(row.observaciones == nil ? Color.secondary : Color.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button { edit(row) } label: { Text("✏️") }
                    .buttonStyle(.borderless)
                    .disabled(blockReason != nil)
                    .opacity(blockReason != nil ? 0.35 : 1)
                    .accessibilityLabel(blockReason ?? (row.isAssembled ? "Editar las observaciones de esta ficha" : "Editar las observaciones de esta evolución"))
                    .accessibilityIdentifier("evolucion.observaciones.editar.\(row.id)")
            }
        }
    }

    // MARK: Acciones

    private func load() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            rows = try await sesion.api.evolucion(paciente: patientId)
            loaded = true
            // Si la fila que se editaba ya no está, se suelta la edición.
            if let editing, !rows.contains(where: { $0.id == editing }) { cancel() }
        } catch {
            self.error = "No se pudo cargar la evolución: \(error.localizedDescription)"
        }
    }

    private func edit(_ row: FilaEvolucion) {
        editing = row.id
        draft = row.observaciones ?? ""
        saveError = nil
    }

    private func cancel() {
        editing = nil
        saveError = nil
    }

    /// Una evolución registrada guarda en ella (`/api/bot/evolucion/editar`). La fila armada va
    /// por el mismo camino que la sección 7 de la ficha (grupo `g_7`): solo viaja
    /// `observaciones`; el resto de la sección no se toca.
    private func save(_ row: FilaEvolucion) async {
        saving = true
        saveError = nil
        defer { saving = false }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            switch EvolutionLogic.observationsTarget(row) {
            case .evolution(let id):
                try await sesion.api.editEvolution(id: id, observaciones: text)
            case .fichaGroup7(let episode):
                try await sesion.api.saveObservations(episodio: episode, paciente: patientId, texto: text)
            }
            rows = EvolutionLogic.applying(observations: text, to: row.id, in: rows)
            editing = nil
        } catch {
            saveError = error.localizedDescription.isEmpty ? "No se pudo guardar" : error.localizedDescription
        }
    }
}
