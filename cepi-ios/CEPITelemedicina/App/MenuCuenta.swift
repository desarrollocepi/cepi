import SwiftUI

/// Cuenta y organización activa, en la barra de la lista. El selector de organización se
/// muestra siempre: con una sola, gris y diciendo por qué no hay a cuál cambiar
/// (CLAUDE.md: nunca ocultes un botón).
struct MenuCuenta: View {
    @Environment(Sesion.self) private var sesion
    @State private var orgElegida = ""
    @State private var error: String?
    @State private var mostrarError = false
    @State private var confirmarBorrado = false

    var body: some View {
        Menu {
            if let usuario = sesion.usuario {
                Section(usuario.email) {
                    if usuario.orgs.count > 1 {
                        Picker("Organización", selection: $orgElegida) {
                            ForEach(usuario.orgs) { org in
                                Text(org.name).tag(org.id)
                            }
                        }
                        .pickerStyle(.menu)
                    } else {
                        Button {} label: {
                            Label(usuario.orgs.first?.name ?? "Sin organización", systemImage: "building.2")
                            Text("Única organización de tu cuenta")
                        }
                        .disabled(true)
                    }
                }
            }
            Button("Cerrar sesión", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                Task { await sesion.salir() }
            }
            Section {
                Button("Eliminar cuenta", systemImage: "person.crop.circle.badge.xmark", role: .destructive) {
                    confirmarBorrado = true
                }
            }
        } label: {
            Label("Cuenta", systemImage: "person.crop.circle")
        }
        .eliminarCuenta(confirmar: $confirmarBorrado)
        .onAppear { orgElegida = sesion.usuario?.orgActiva ?? "" }
        .onChange(of: sesion.usuario?.orgActiva) { _, activa in orgElegida = activa ?? "" }
        .onChange(of: orgElegida) { _, id in
            guard !id.isEmpty, id != sesion.usuario?.orgActiva else { return }
            Task { await cambiar(a: id) }
        }
        .alert("No se pudo cambiar de organización", isPresented: $mostrarError) {
            Button("Aceptar", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }

    private func cambiar(a id: String) async {
        do {
            try await sesion.cambiarOrganizacion(a: id)
        } catch {
            orgElegida = sesion.usuario?.orgActiva ?? ""
            self.error = error.localizedDescription
            mostrarError = true
        }
    }
}
