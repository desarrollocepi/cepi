import SwiftUI

/// Lugar del hilo del paciente, que llega en la fase 2 (PAPER §24.9). Mientras tanto la
/// selección de la lista ya funciona y se ve a quién se abrió.
struct HiloPendienteView: View {
    let fila: FilaPaciente

    var body: some View {
        ContentUnavailableView {
            Label(fila.nombre, systemImage: "bubble.left.and.text.bubble.right")
        } description: {
            Text("El hilo del paciente, la ficha y el dictado llegan en la fase 2.")
        }
        .navigationTitle(fila.nombre)
        .navigationBarTitleDisplayMode(.inline)
    }
}
