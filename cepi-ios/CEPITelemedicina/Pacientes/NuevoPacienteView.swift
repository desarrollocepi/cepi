import SwiftUI

/// Alta mínima: nombre, apellidos, cédula y celular (email opcional), igual que ChatList.vue
/// (PAPER §36.1). El celular es para avisarle de sus citas. El resto de la ficha lo pide el
/// asistente después.
struct NuevoPacienteView: View {
    let alCrear: @MainActor (Registro) async -> Void

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var nombre = ""
    @State private var apellidos = ""
    @State private var cedula = ""
    @State private var celular = ""
    @State private var email = ""
    @State private var creando = false
    @State private var error: String?

    private var motivo: String? {
        Contacto.blocker(nombre: nombre, apellidos: apellidos, cedula: cedula, celular: celular, email: email)
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
                    TextField("Celular (09…)", text: $celular)
                        .textContentType(.telephoneNumber)
                        .keyboardType(.phonePad)
                    TextField("Email (opcional)", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text(motivo ?? "El celular es para avisarle de sus citas. El resto de la ficha lo completa el asistente.")
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
                        .disabled(motivo != nil || creando)
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
                cedula: limpio(cedula),
                celular: Contacto.normalizeMobile(celular) ?? limpio(celular),
                email: limpio(email)
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
