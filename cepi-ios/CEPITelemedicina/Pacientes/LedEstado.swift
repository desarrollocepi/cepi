import SwiftUI

/// El LED del estado de la ficha: un punto de color; "sin consulta" va hueco.
struct LedEstado: View {
    let estado: EstadoFicha
    var tamano: CGFloat = 12

    var body: some View {
        Group {
            if estado == .sinConsulta {
                Circle().strokeBorder(estado.color, lineWidth: 2)
            } else {
                Circle().fill(estado.color)
            }
        }
        .frame(width: tamano, height: tamano)
    }
}
