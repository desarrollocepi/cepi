import SwiftUI

/// La cuenta existe pero nadie le asignó un rol clínico todavía. Equivale a
/// `PendingApproval.vue`. Es donde cae una cuenta recién creada con Google, así que también
/// ofrece borrarla.
struct PendienteView: View {
    @Environment(Sesion.self) private var sesion
    @State private var confirmarBorrado = false
    @State private var error: String?

    /// Orgs reales (no sandbox) donde ya tiene rol, distintas de la activa.
    private var otrasOrgs: [Organizacion] {
        sesion.usuario?.otrasOrgsAprobadas ?? []
    }

    private func entrar(a id: String) {
        error = nil
        Task {
            do { try await sesion.cambiarOrganizacion(a: id) }
            catch { self.error = "No se pudo cambiar de organización." }
        }
    }

    var body: some View {
        ContentUnavailableView {
            Label("Cuenta pendiente de aprobación", systemImage: "hourglass")
        } description: {
            Text("Un administrador de CEPI tiene que asignarte un rol antes de que puedas ver pacientes.")
        } actions: {
            // Si ya tiene rol en otra organización real, entra a ella a propósito: la sesión
            // nunca lo lleva sola a otra org (PAPER §13.8).
            ForEach(otrasOrgs) { org in
                Button("Entrar a \(org.name)") { entrar(a: org.id) }
                    .buttonStyle(.borderedProminent)
                    .disabled(sesion.cambiandoOrganizacion)
            }
            if sesion.cambiandoOrganizacion {
                Text("Cambiando de organización…").font(.footnote).foregroundStyle(.secondary)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            if otrasOrgs.isEmpty {
                Button("Volver a comprobar") { Task { await sesion.renovar() } }
                    .buttonStyle(.borderedProminent)
            } else {
                Button("Volver a comprobar") { Task { await sesion.renovar() } }
                    .buttonStyle(.bordered)
            }
            Button("Cerrar sesión", role: .destructive) { Task { await sesion.salir() } }
            Button("Eliminar cuenta", role: .destructive) { confirmarBorrado = true }
                .font(.footnote)
        }
        .eliminarCuenta(confirmar: $confirmarBorrado)
    }
}
