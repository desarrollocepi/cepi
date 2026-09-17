import SwiftUI

/// Borrar la cuenta desde la app (App Store 5.1.1(v)): el login con Google crea cuentas, así
/// que también tienen que poder borrarse acá. Lo usan el menú de la cuenta y la pantalla de
/// cuenta pendiente, que es donde cae una cuenta recién creada con Google.
///
/// El botón vive en quien lo muestra; la confirmación y el error, acá. Van por fuera del
/// botón porque una alerta colgada de un botón de `Menu` no llega a presentarse: el menú se
/// cierra y se lleva la vista.
struct EliminarCuenta: ViewModifier {
    @Environment(Sesion.self) private var sesion
    @Binding var confirmar: Bool
    @State private var eliminando = false
    @State private var error: String?

    static let explicacion = """
        Se borran tu email, teléfono y cédula, tu acceso con contraseña o con Google, tus \
        organizaciones y las notificaciones en tus dispositivos. No se puede deshacer.

        Las historias clínicas que registraste no se borran: pertenecen al paciente y a la \
        institución, y la ley obliga a conservarlas. Por eso en ellas sigue tu nombre como \
        profesional que atendió.
        """

    func body(content: Content) -> some View {
        content
            .disabled(eliminando)
            .overlay {
                if eliminando { ProgressView() }
            }
            .alert("¿Eliminar tu cuenta?", isPresented: $confirmar) {
                Button("Eliminar cuenta", role: .destructive) {
                    Task { await eliminar() }
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text(Self.explicacion)
            }
            .alert("No se pudo eliminar la cuenta", isPresented: Binding(
                get: { error != nil },
                set: { if !$0 { error = nil } }
            )) {
                Button("Aceptar", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
    }

    private func eliminar() async {
        eliminando = true
        defer { eliminando = false }
        do {
            try await sesion.eliminarCuenta()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension View {
    /// Confirmación y error del borrado de cuenta; `confirmar` lo pone en `true` el botón.
    func eliminarCuenta(confirmar: Binding<Bool>) -> some View {
        modifier(EliminarCuenta(confirmar: confirmar))
    }
}
