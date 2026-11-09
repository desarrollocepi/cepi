import SwiftUI

/// La sección Evolución del paciente (PAPER §28.3): nativa y adaptable, como
/// `EvolucionPaciente.vue` con `plegable=false` en el teléfono. Una tarjeta por ficha, la más
/// nueva primero, con las seis columnas de §28.1; las observaciones se editan en línea (✏️,
/// grupo `g_7`). Tocar una tarjeta abre esa ficha en la sección Ficha. El documento
/// imprimible (`evolucion.html`, `EvolucionView`) queda detrás de «Imprimir».
struct PatientEvolutionView: View {
    let patientId: String
    /// La ficha a la vista en la sección Ficha: se resalta.
    let current: String?
    /// Quien la contiene la sube cada vez que la sección vuelve a la vista: se vuelve a pedir,
    /// porque entre una vez y otra se pudo guardar un diagnóstico.
    var reload = 0
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

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .task(id: "\(reload)|\(patientId)") { await load() }
        .sheet(isPresented: $printing) {
            NavigationStack {
                EvolucionView(pacienteId: patientId, actual: current) { episode in
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
                Text(loaded ? EvolutionLogic.summary(rows) : "Fecha, quién atendió, diagnósticos, tratamiento y observaciones")
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
            Text("Este paciente todavía no tiene fichas registradas.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(rows) { row in
                        card(row)
                    }
                }
                .padding(12)
            }
            .refreshable { await load() }
        }
    }

    private func card(_ row: FilaEvolucion) -> some View {
        let isCurrent = row.episodio == current
        return VStack(alignment: .leading, spacing: 8) {
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
            .accessibilityIdentifier("evolucion.ficha.\(row.episodio)")

            Divider()
            observations(row)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            isCurrent ? Marca.acento.opacity(0.12) : Color(uiColor: .secondarySystemBackground),
            in: RoundedRectangle(cornerRadius: 10)
        )
        .overlay(alignment: .leading) {
            if isCurrent {
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
            if editing == row.episodio {
                VStack(alignment: .leading, spacing: 6) {
                    TextField("Resumen de lo más importante de esta ficha", text: $draft, axis: .vertical)
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
                let blockReason = EvolutionLogic.editBlockReason(row: row.episodio, editing: editing)
                Text(text)
                    .font(.subheadline)
                    .italic(row.observaciones == nil)
                    .foregroundStyle(row.observaciones == nil ? Color.secondary : Color.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button { edit(row) } label: { Text("✏️") }
                    .buttonStyle(.borderless)
                    .disabled(blockReason != nil)
                    .opacity(blockReason != nil ? 0.35 : 1)
                    .accessibilityLabel(blockReason ?? "Editar las observaciones de esta ficha")
                    .accessibilityIdentifier("evolucion.observaciones.editar.\(row.episodio)")
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
            if let editing, !rows.contains(where: { $0.episodio == editing }) { cancel() }
        } catch {
            self.error = "No se pudo cargar la evolución: \(error.localizedDescription)"
        }
    }

    private func edit(_ row: FilaEvolucion) {
        editing = row.episodio
        draft = row.observaciones ?? ""
        saveError = nil
    }

    private func cancel() {
        editing = nil
        saveError = nil
    }

    /// Va por el mismo camino que la sección 7 de la ficha (grupo `g_7`): solo viaja
    /// `observaciones`; el resto de la sección no se toca.
    private func save(_ row: FilaEvolucion) async {
        saving = true
        saveError = nil
        defer { saving = false }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await sesion.api.saveObservations(episodio: row.episodio, paciente: patientId, texto: text)
            rows = EvolutionLogic.applying(observations: text, to: row.episodio, in: rows)
            editing = nil
        } catch {
            saveError = error.localizedDescription.isEmpty ? "No se pudo guardar" : error.localizedDescription
        }
    }
}
