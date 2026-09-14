import SwiftUI

/// Una imagen clínica a pantalla completa, con zoom: pellizcar, doble toque y arrastrar.
/// Equivale al lightbox de MessageContent.vue.
struct VisorImagen: View {
    let id: String

    @Environment(\.dismiss) private var cerrar
    @State private var escala: CGFloat = 1
    @State private var escalaAlEmpezar: CGFloat = 1
    @State private var desplazamiento: CGSize = .zero
    @State private var desplazamientoAlEmpezar: CGSize = .zero

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            // Más grande que la miniatura: el zoom tiene que mostrar detalle de la lesión.
            ImagenAutenticada(id: id, ladoMaximo: 2800)
                .scaleEffect(escala)
                .offset(desplazamiento)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    MagnifyGesture()
                        .onChanged { valor in
                            escala = min(6, max(1, escalaAlEmpezar * valor.magnification))
                        }
                        .onEnded { _ in
                            escalaAlEmpezar = escala
                            if escala == 1 { centrar() }
                        }
                )
                .simultaneousGesture(
                    DragGesture()
                        .onChanged { valor in
                            guard escala > 1 else { return }
                            desplazamiento = CGSize(
                                width: desplazamientoAlEmpezar.width + valor.translation.width,
                                height: desplazamientoAlEmpezar.height + valor.translation.height
                            )
                        }
                        .onEnded { _ in desplazamientoAlEmpezar = desplazamiento }
                )
                .onTapGesture(count: 2) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        if escala > 1 {
                            centrar()
                        } else {
                            escala = 2.5
                            escalaAlEmpezar = 2.5
                        }
                    }
                }

            Button { cerrar() } label: {
                Image(systemName: "xmark")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(12)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("Cerrar")
            .padding()
        }
        .overlay(alignment: .bottom) {
            Text("Doble toque para acercar · pellizca para zoom · arrastra para mover")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.7))
                .padding()
        }
    }

    private func centrar() {
        escala = 1
        escalaAlEmpezar = 1
        desplazamiento = .zero
        desplazamientoAlEmpezar = .zero
    }
}
