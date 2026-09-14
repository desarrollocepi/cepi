import SwiftUI

/// Un mensaje del hilo: el propio a la derecha; los del asistente y de otros profesionales a
/// la izquierda, con el autor encima de cada racha.
struct BurbujaMensaje: View {
    let mensaje: MensajeHilo
    let autor: String?
    let alAbrirImagen: (String) -> Void

    var body: some View {
        HStack(alignment: .bottom) {
            if mensaje.propio { Spacer(minLength: 40) }

            VStack(alignment: .leading, spacing: 6) {
                if let autor {
                    Label(autor, systemImage: mensaje.esBot ? "sparkles" : "person")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(mensaje.esBot ? Color.secondary : Color.purple)
                }
                ForEach(Array(Segmento.dividir(mensaje.contenido).enumerated()), id: \.offset) { _, segmento in
                    switch segmento {
                    case .texto(let texto):
                        Text(texto)
                            .textSelection(.enabled)
                    case .imagen(let id, let nombre):
                        // Tamaño fijo desde antes de cargar: si la miniatura crece al llegar,
                        // empuja el hilo y el último mensaje queda tapado por el composer.
                        ImagenAutenticada(id: id)
                            .frame(width: 220, height: 220)
                            .background(Color.black.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .contentShape(Rectangle())
                            .onTapGesture { alAbrirImagen(id) }
                            .accessibilityLabel(nombre ?? "Imagen clínica")
                            .accessibilityAddTraits(.isButton)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .foregroundStyle(mensaje.propio ? Color.white : Color.primary)
            .background(fondo, in: RoundedRectangle(cornerRadius: 16))

            if !mensaje.propio { Spacer(minLength: 40) }
        }
    }

    private var fondo: Color {
        if mensaje.propio { return Marca.acento }
        return mensaje.esBot ? Color(uiColor: .secondarySystemBackground) : Color.purple.opacity(0.12)
    }
}
