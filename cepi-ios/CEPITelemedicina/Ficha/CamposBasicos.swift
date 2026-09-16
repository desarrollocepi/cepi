import SwiftUI

/// Pone sus hijos en fila y salta de línea cuando no entran (las opciones de un `radio`).
struct FilaQueEnvuelve: Layout {
    var espacio: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let ancho = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var altoFila: CGFloat = 0
        var anchoMaximo: CGFloat = 0
        for subvista in subviews {
            let tamano = subvista.sizeThatFits(.unspecified)
            if x > 0 && x + tamano.width > ancho {
                x = 0
                y += altoFila + espacio
                altoFila = 0
            }
            x += tamano.width + espacio
            altoFila = max(altoFila, tamano.height)
            anchoMaximo = max(anchoMaximo, x - espacio)
        }
        return CGSize(width: min(anchoMaximo, ancho), height: y + altoFila)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var altoFila: CGFloat = 0
        for subvista in subviews {
            let tamano = subvista.sizeThatFits(.unspecified)
            if x > bounds.minX && x + tamano.width > bounds.maxX {
                x = bounds.minX
                y += altoFila + espacio
                altoFila = 0
            }
            subvista.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(tamano))
            x += tamano.width + espacio
            altoFila = max(altoFila, tamano.height)
        }
    }
}

/// Una fecha guardada como `YYYY-MM-DD`, que es lo que manda el `<input type="date">` de la web.
struct CampoFecha: View {
    @Binding var texto: String

    var body: some View {
        HStack {
            if let fecha = Fechas.dia(texto) {
                DatePicker("", selection: Binding(get: { fecha }, set: { texto = Fechas.textoDia($0) }), displayedComponents: .date)
                    .labelsHidden()
                Button("Quitar") { texto = "" }
                    .font(.footnote)
            } else {
                Button("Elegir fecha", systemImage: "calendar") { texto = Fechas.textoDia(.now) }
                    .buttonStyle(.bordered)
            }
        }
    }
}

extension View {
    func estiloCampo() -> some View {
        padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 10))
    }
}
