import SwiftUI

/// Alta mínima: nombre, apellidos y cédula, igual que ChatList.vue. El resto de la ficha lo
/// pide el asistente después.
struct NuevoPacienteView: View {
    let alCrear: @MainActor (Registro) async -> Void

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var nombre = ""
    @State private var apellidos = ""
    @State private var cedula = ""
    @State private var creando = false
    @State private var error: String?

    private var completo: Bool {
        [nombre, apellidos, cedula].allSatisfy { !limpio($0).isEmpty }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nombre", text: $nombre)
                        .textContentType(.givenName)
                    TextField("Apellidos", text: $apellidos)
                        .textContentType(.familyName)
                    TextField("Cédula", text: $cedula)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                } footer: {
                    Text("Los tres son obligatorios. El resto de la ficha lo completa el asistente.")
                }
                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Nuevo paciente")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { cerrar() }
                        .disabled(creando)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Crear") { Task { await crear() } }
                        .disabled(!completo || creando)
                }
            }
            .interactiveDismissDisabled(creando)
        }
    }

    private func crear() async {
        creando = true
        error = nil
        defer { creando = false }
        do {
            let registro = try await sesion.api.crearPaciente(
                nombre: limpio(nombre),
                apellidos: limpio(apellidos),
                cedula: limpio(cedula)
            )
            await alCrear(registro)
            cerrar()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func limpio(_ texto: String) -> String {
        texto.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
