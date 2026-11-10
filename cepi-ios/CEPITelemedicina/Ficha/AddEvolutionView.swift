import SwiftUI

/// «＋ Agregar evolución» (PAPER §28.4): una cita más en la misma ficha, cuando el paciente
/// vuelve a control por el mismo motivo. Fecha de hoy, hallazgos, diagnóstico (buscador CIE-10
/// como en la ficha), tratamiento, observaciones y próximo control. Es una acción explícita: se
/// guarda sin pedir sí/no. Si falla, la hoja sigue abierta con el motivo del bot.
struct AddEvolutionView: View {
    let episodeId: String
    /// Motivo de la ficha, para que se vea a qué ficha se agrega.
    let motivo: String?
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

    private var evolution: EvolutionCreate {
        EvolutionCreate(
            episodeId: episodeId,
            fecha: Fechas.textoDia(date),
            hallazgos: findings,
            diagnostico: diagnosis,
            tratamiento: treatment,
            observaciones: observations,
            proximoControlFecha: hasNextControl ? Fechas.textoDia(nextControlDate) : nil,
            proximoControlMotivo: hasNextControl ? nextControlReason : ""
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Fecha", selection: $date, displayedComponents: .date)
                } footer: {
                    Text("Ficha: \(motivo ?? "sin motivo registrado"). Para otro motivo de consulta, abre una consulta nueva.")
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
                    DatePicker("Fecha del control", selection: $nextControlDate, displayedComponents: .date)
                        .disabled(!hasNextControl)
                    TextField("Motivo del control", text: $nextControlReason)
                        .disabled(!hasNextControl)
                } header: {
                    Text("Próximo control")
                } footer: {
                    if !hasNextControl { Text("Enciende «Con próximo control» para fijar fecha y motivo.") }
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .disabled(saving)
            .navigationTitle("＋ Agregar evolución")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    let reason = EvolutionLogic.submitBlockReason(evolution, saving: saving)
                    Button(saving ? "Guardando…" : "Guardar") { Task { await save() } }
                        .disabled(reason != nil)
                        .accessibilityHint(reason ?? "Agregar la evolución a esta ficha")
                        .accessibilityIdentifier("evolucion.nueva.guardar")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let reason = EvolutionLogic.submitBlockReason(evolution, saving: saving), !saving {
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

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            _ = try await sesion.api.addEvolution(evolution)
            await onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription.isEmpty ? "No se pudo guardar la evolución" : error.localizedDescription
        }
    }
}
