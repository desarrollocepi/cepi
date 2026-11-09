import SwiftUI

/// Reglas de «Dar de alta» (PAPER §35), las mismas que `altaMotivo` en `IntakeChat.vue`. Sin
/// UI, para probarlas.
enum PatientDischarge {
    /// El aviso tras el alta, el mismo mensaje que agrega la web al hilo.
    static let confirmation =
        "🏁 Alta registrada. Desde mañana el paciente no sale en la lista; si vuelve, abre una consulta nueva."

    /// Por qué hoy no se puede dar el alta, o `nil` si se puede. El botón nunca se esconde: se
    /// deshabilita con este texto a la vista.
    static func blockReason(episode: String?, episodeData: Registro?) -> String? {
        guard episode != nil else { return "Elige un paciente con una consulta abierta" }
        guard let datos = episodeData else { return "Cargando el estado de la consulta…" }
        if datos["estado"] == "alta" { return "Este paciente ya está de alta. Si vuelve, abre una consulta nueva" }
        return nil
    }

    /// El texto de ayuda de la hoja, como `DarDeAlta.vue`.
    static func help(patientName: String?) -> String {
        let nombre = patientName.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? "el paciente"
        return "Se cierra esta consulta. Desde mañana \(nombre) no sale en la lista; se lo encuentra buscándolo "
            + "o en el filtro «Alta». Si vuelve, se abre una consulta nueva con su propio motivo."
    }
}

/// «🏁 Dar de alta» (PAPER §35.2, `DarDeAlta.vue`): confirmación con nota opcional. Si falla,
/// la hoja sigue abierta con el motivo del bot.
struct DarDeAltaView: View {
    let episodio: String
    let paciente: String
    /// Tras guardar el alta.
    let onDischarged: () async -> Void

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var nota = ""
    @State private var guardando = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ej.: Lesión resuelta, sin controles pendientes", text: $nota, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Nota del alta (opcional)")
                } footer: {
                    Text(PatientDischarge.help(patientName: paciente))
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .disabled(guardando)
            .navigationTitle("🏁 Dar de alta")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { cerrar() }
                        .disabled(guardando)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if guardando {
                        ProgressView()
                    } else {
                        Button("Dar de alta") { Task { await confirmar() } }
                    }
                }
            }
            .interactiveDismissDisabled(guardando)
        }
    }

    private func confirmar() async {
        guardando = true
        error = nil
        defer { guardando = false }
        do {
            try await sesion.api.dischargePatient(PatientDischargeRequest(episodio: episodio, nota: nota))
            cerrar()
            await onDischarged()
        } catch {
            // El 409 ("Este paciente ya está de alta") trae el motivo en español: tal cual.
            self.error = error.localizedDescription
        }
    }
}
