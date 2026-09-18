import SwiftUI

/// Las imágenes clínicas de un paciente, de todas sus consultas: la tercera sección de
/// `PacienteView` (PAPER §24.2.1). El nombre del paciente no se repite en cada foto.
struct ImagenesPacienteView: View {
    let paciente: FilaPaciente

    @Environment(Sesion.self) private var sesion
    @State private var modelo: GaleriaModelo

    init(paciente: FilaPaciente) {
        self.paciente = paciente
        _modelo = State(initialValue: GaleriaModelo(paciente: paciente.id))
    }

    var body: some View {
        RejillaImagenes(
            modelo: modelo,
            vacio: "Este paciente todavía no tiene imágenes",
            mostrarPaciente: false
        )
        .refreshable { await modelo.recargar(api: sesion.api) }
        .task { await modelo.buscar("", api: sesion.api, esperar: .zero) }
    }
}
