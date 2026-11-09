import SwiftUI

/// Las imágenes de un paciente, de todas sus consultas: la tercera sección de `PacienteView`
/// (PAPER §24.2.1). Arriba, sus dos consentimientos (§31.3); debajo, las fotos clínicas. El
/// nombre del paciente no se repite en cada foto.
struct ImagenesPacienteView: View {
    let paciente: FilaPaciente

    @Environment(Sesion.self) private var sesion
    @State private var modelo: GaleriaModelo
    @State private var consents: ConsentsModel

    init(paciente: FilaPaciente) {
        self.paciente = paciente
        _modelo = State(initialValue: GaleriaModelo(paciente: paciente.id))
        _consents = State(initialValue: ConsentsModel(patient: paciente.id))
    }

    var body: some View {
        RejillaImagenes(
            modelo: modelo,
            vacio: "Este paciente todavía no tiene imágenes",
            mostrarPaciente: false
        ) {
            PatientConsentsView(model: consents)
        }
        .refreshable {
            await consents.load(api: sesion.api)
            await modelo.recargar(api: sesion.api)
        }
        .task { await modelo.buscar("", api: sesion.api, esperar: .zero) }
        .task { await consents.load(api: sesion.api) }
    }
}
