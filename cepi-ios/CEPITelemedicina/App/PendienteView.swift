import SwiftUI

/// La cuenta existe pero nadie le asignó un rol clínico todavía. Equivale a
/// `PendingApproval.vue`.
struct PendienteView: View {
    @Environment(Sesion.self) private var sesion

    var body: some View {
        ContentUnavailableView {
            Label("Cuenta pendiente de aprobación", systemImage: "hourglass")
        } description: {
            Text("Un administrador de CEPI tiene que asignarte un rol antes de que puedas ver pacientes.")
        } actions: {
            Button("Volver a comprobar") { Task { await sesion.renovar() } }
                .buttonStyle(.borderedProminent)
            Button("Cerrar sesión", role: .destructive) { Task { await sesion.salir() } }
        }
    }
}
