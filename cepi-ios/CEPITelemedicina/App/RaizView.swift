import SwiftUI

/// Qué se ve según la sesión. El login va por encima de todo, como en `App.vue`: no es una
/// pantalla más de la navegación.
struct RaizView: View {
    @Environment(Sesion.self) private var sesion
    @Environment(\.scenePhase) private var fase

    var body: some View {
        Group {
            switch sesion.estado {
            case .cargando:
                ProgressView()
                    .controlSize(.large)
            case .sinSesion:
                LoginView()
            case .pendiente:
                PendienteView()
            case .activa:
                PacientesView()
            case .sinValidar(let motivo):
                ContentUnavailableView {
                    Label("No se pudo abrir la sesión", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(motivo)
                } actions: {
                    Button("Reintentar") { Task { await sesion.renovar() } }
                        .buttonStyle(.borderedProminent)
                    Button("Cerrar sesión", role: .destructive) { Task { await sesion.salir() } }
                }
            }
        }
        .task { await sesion.restaurar() }
        .onChange(of: fase) { _, nueva in
            if nueva == .active { Task { await sesion.renovarSiHaceFalta() } }
        }
    }
}
