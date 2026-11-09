import SwiftUI

/// Lo que se ve con la sesión abierta: pacientes, galería y turnos (PAPER §24.2.1, D-Aux-22, §32).
/// Dentro de un paciente hay otras tres secciones, esas sí deslizables (`PacienteView`).
struct PrincipalView: View {
    var body: some View {
        TabView {
            PacientesView()
                .tabItem { Label("Pacientes", systemImage: "person.2") }

            GaleriaView()
                .tabItem { Label("Galería", systemImage: "photo.on.rectangle.angled") }

            ShiftsView()
                .tabItem { Label("Turnos", systemImage: "calendar") }
        }
    }
}
