import SwiftUI

/// Cuenta y organización activa, en la barra de la lista. El selector de organización se
/// muestra siempre: con una sola, gris y diciendo por qué no hay a cuál cambiar
/// (CLAUDE.md: nunca ocultes un botón).
///
/// Las alertas (confirmar el borrado, error al cambiar de org) las presenta quien contiene
/// la barra, no este menú: una alerta colgada de un `Menu` dentro de un `ToolbarItem` no
/// llega a presentarse cuando el menú se cierra al elegir la opción.
struct MenuCuenta: View {
    @Environment(Sesion.self) private var sesion
    @Binding var confirmarBorrado: Bool
    @Binding var errorOrganizacion: String?
    @State private var orgElegida = ""

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
        .onAppear { orgElegida = sesion.usuario?.orgActiva ?? "" }
        .onChange(of: sesion.usuario?.orgActiva) { _, activa in orgElegida = activa ?? "" }
        .onChange(of: orgElegida) { _, id in
            guard !id.isEmpty, id != sesion.usuario?.orgActiva else { return }
            Task { await cambiar(a: id) }
        }
    }

    private func cambiar(a id: String) async {
        do {
            try await sesion.cambiarOrganizacion(a: id)
        } catch {
            orgElegida = sesion.usuario?.orgActiva ?? ""
            errorOrganizacion = error.localizedDescription
        }
    }
}
