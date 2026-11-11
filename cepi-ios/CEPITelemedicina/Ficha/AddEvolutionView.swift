import SwiftUI

/// El formulario de una evolución (PAPER §28.4 y §28.4.1). Dos modos con los mismos campos:
///
/// - **Agregar** («＋ Agregar evolución»): una cita más en la misma ficha, cuando el paciente
///   vuelve a control por el mismo motivo. Fecha de hoy y el resto vacío.
/// - **Editar** (tocar una tarjeta o el bloque «Próximo control»): prellenado con la fila.
///   Guarda en `POST /api/bot/evolucion/editar` solo lo que cambió.
///
/// Fecha, hallazgos, diagnóstico (buscador CIE-10 como en la ficha), tratamiento, observaciones y
/// próximo control. Es una acción explícita: se guarda sin pedir sí/no. Si falla, la hoja sigue
/// abierta con el motivo del bot.
struct AddEvolutionView: View {
    enum Mode: Equatable {
        case add(episodeId: String)
        case edit(FilaEvolucion)
    }

    let mode: Mode
    /// Motivo de la ficha, para que se vea a qué ficha pertenece.
    let motivo: String?
    /// Ficha de alta: no se puede fijar un próximo control (el bot respondería 400).
    let discharged: Bool
    /// Se abrió desde el bloque «Próximo control»: el formulario va directo ahí.
    let focusNextControl: Bool
    let onSaved: () async -> Void

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var findings = ""
    @State private var diagnosis = ""
    @State private var treatment = ""
    @State private var observations = ""
    @State private var hasNextControl = false
    @State private var nextControlDate = Calendar.current.date(byAdding: .month, value: 1, to: .now) ?? .now
    @State private var nextControlReason = ""
    @State private var saving = false
    @State private var error: String?
    @FocusState private var reasonFocused: Bool

    private static let nextControlSection = "evolucion.form.proximoControl"

    init(episodeId: String, motivo: String?, onSaved: @escaping () async -> Void) {
        mode = .add(episodeId: episodeId)
        self.motivo = motivo
        discharged = false
        focusNextControl = false
        self.onSaved = onSaved
    }

    init(
        editing row: FilaEvolucion, motivo: String?, discharged: Bool, focusNextControl: Bool = false,
        onSaved: @escaping () async -> Void
    ) {
        mode = .edit(row)
        self.motivo = motivo
        self.discharged = discharged
        self.focusNextControl = focusNextControl
        self.onSaved = onSaved
        let draft = EvolutionLogic.EvolutionDraft(
            row: row,
            today: Fechas.textoDia(.now),
            suggestedNextControl: Fechas.textoDia(Calendar.current.date(byAdding: .month, value: 1, to: .now) ?? .now)
        )
        _date = State(initialValue: Fechas.dia(draft.date) ?? .now)
        _findings = State(initialValue: draft.findings)
        _diagnosis = State(initialValue: draft.diagnosis)
        _treatment = State(initialValue: draft.treatment)
        _observations = State(initialValue: draft.observations)
        // Tocar «Próximo control» es para fijarlo: se enciende si la ficha lo permite.
        _hasNextControl = State(initialValue: draft.hasNextControl || (focusNextControl && !discharged))
        _nextControlDate = State(initialValue: Fechas.dia(draft.nextControlDate) ?? .now)
        _nextControlReason = State(initialValue: draft.nextControlReason)
    }

    private var draft: EvolutionLogic.EvolutionDraft? {
        guard case .edit(let row) = mode else { return nil }
        var draft = EvolutionLogic.EvolutionDraft(row: row, today: Fechas.textoDia(.now), suggestedNextControl: "")
        draft.date = Fechas.textoDia(date)
        draft.findings = findings
        draft.diagnosis = diagnosis
        draft.treatment = treatment
        draft.observations = observations
        draft.hasNextControl = hasNextControl
        draft.nextControlDate = Fechas.textoDia(nextControlDate)
        draft.nextControlReason = nextControlReason
        return draft
    }

    private var evolution: EvolutionCreate {
        EvolutionCreate(
            episodeId: {
                switch mode {
                case .add(let id): id
                case .edit(let row): row.episodio
                }
            }(),
            fecha: Fechas.textoDia(date),
            hallazgos: findings,
            diagnostico: diagnosis,
            tratamiento: treatment,
            observaciones: observations,
            proximoControlFecha: hasNextControl ? Fechas.textoDia(nextControlDate) : nil,
            proximoControlMotivo: hasNextControl ? nextControlReason : ""
        )
    }

    private var edit: EvolutionEdit? {
        guard case .edit(let row) = mode, let draft else { return nil }
        return EvolutionLogic.edit(row, draft: draft)
    }

    private var blockReason: String? {
        if let edit { return EvolutionLogic.editSubmitBlockReason(edit, saving: saving) }
        return EvolutionLogic.submitBlockReason(evolution, saving: saving)
    }

    private var isEditing: Bool { edit != nil }

    /// Con la ficha de alta el próximo control no se puede encender; apagar uno que ya estaba sí.
    private var nextControlBlockReason: String? {
        discharged && !hasNextControl ? EvolutionLogic.dischargedNextControlReason : nil
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                form
                    .task {
                        guard focusNextControl else { return }
                        // La hoja termina de presentarse antes de desplazar y dar el foco.
                        try? await Task.sleep(for: .milliseconds(350))
                        withAnimation { proxy.scrollTo(Self.nextControlSection, anchor: .top) }
                        if hasNextControl { reasonFocused = true }
                    }
            }
            .disabled(saving)
            .navigationTitle(isEditing ? "Editar evolución" : "＋ Agregar evolución")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Guardando…" : "Guardar") { Task { await save() } }
                        .disabled(blockReason != nil)
                        .accessibilityHint(blockReason ?? (isEditing ? "Guardar los cambios de esta evolución" : "Agregar la evolución a esta ficha"))
                        .accessibilityIdentifier("evolucion.nueva.guardar")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let reason = blockReason, !saving {
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(8)
                        .frame(maxWidth: .infinity)
                        .background(.bar)
                }
            }
        }
    }

    private var form: some View {
        Form {
            Section {
                DatePicker("Fecha", selection: $date, displayedComponents: .date)
            } footer: {
                Text(isEditing
                     ? "Ficha: \(motivo ?? "sin motivo registrado"). Solo se guarda lo que cambies."
                     : "Ficha: \(motivo ?? "sin motivo registrado"). Para otro motivo de consulta, abre una consulta nueva.")
            }
            Section("Hallazgos") {
                TextField("Lo que se encontró en esta cita", text: $findings, axis: .vertical)
                    .lineLimit(3...8)
                    .accessibilityIdentifier("evolucion.nueva.hallazgos")
            }
            Section("Diagnóstico") {
                CampoCIE10(placeholder: "Buscar diagnóstico en CIE-10…", texto: $diagnosis)
            }
            Section("Tratamiento") {
                TextField("Indicado en esta cita", text: $treatment, axis: .vertical)
                    .lineLimit(2...6)
            }
            Section("Observaciones") {
                TextField("Resumen libre", text: $observations, axis: .vertical)
                    .lineLimit(2...6)
            }
            Section {
                Toggle("Con próximo control", isOn: $hasNextControl)
                    .disabled(nextControlBlockReason != nil)
                    .accessibilityHint(nextControlBlockReason ?? "Fijar la fecha y qué hacer en el próximo control")
                DatePicker("Fecha del control", selection: $nextControlDate, displayedComponents: .date)
                    .disabled(!hasNextControl || discharged)
                TextField("Qué hacer en el control", text: $nextControlReason)
                    .focused($reasonFocused)
                    .disabled(!hasNextControl)
                    .accessibilityIdentifier("evolucion.nueva.proximoControlMotivo")
            } header: {
                Text("Próximo control")
            } footer: {
                if let reason = nextControlBlockReason {
                    Text(reason).foregroundStyle(.orange)
                } else if discharged {
                    Text("Ficha de alta: puedes quitar este control, no fijar otro.")
                } else if !hasNextControl {
                    Text("Enciende «Con próximo control» para fijar fecha y qué hacer.")
                }
            }
            .id(Self.nextControlSection)
            if let error {
                Section {
                    Text(error).foregroundStyle(.red)
                }
            }
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            if let edit {
                try await sesion.api.editEvolution(edit)
            } else {
                _ = try await sesion.api.addEvolution(evolution)
            }
            await onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription.isEmpty ? "No se pudo guardar la evolución" : error.localizedDescription
        }
    }
}
