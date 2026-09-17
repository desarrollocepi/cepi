import PhotosUI
import SwiftUI

/// Caja de texto y acciones del hilo. Lo que no aplica se ve gris y el pie dice por qué
/// (CLAUDE.md: nunca ocultes un botón).
struct Composer: View {
    @Binding var texto: String
    let ocupado: Bool
    let subiendo: Bool
    let adjunto: Adjunto?
    @Binding var fotoElegida: PhotosPickerItem?
    let alTomarFoto: () -> Void
    let alQuitarAdjunto: () -> Void
    let alEnviar: () -> Void

    private var hayCamara: Bool { CamaraView.disponible }

    private var puedeEnviar: Bool {
        !ocupado && !subiendo
            && (!texto.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || adjunto != nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let adjunto {
                HStack {
                    Label(adjunto.nombre, systemImage: "paperclip")
                        .font(.footnote)
                        .lineLimit(1)
                    Spacer()
                    Button("Quitar", action: alQuitarAdjunto)
                        .font(.footnote)
                }
            }

            TextField("Escribe o pega un texto largo…", text: $texto, axis: .vertical)
                .lineLimit(1...8)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 18))
                .accessibilityIdentifier("composer.texto")

            HStack(spacing: 18) {
                PhotosPicker(selection: $fotoElegida, matching: .images) {
                    Image(systemName: "photo.on.rectangle")
                }
                .disabled(ocupado || subiendo)
                .accessibilityLabel("Adjuntar foto de la galería")

                Button(action: alTomarFoto) {
                    Image(systemName: "camera")
                }
                .disabled(!hayCamara || ocupado || subiendo)
                .accessibilityLabel("Tomar foto")

                Spacer()

                Button(action: alEnviar) {
                    if subiendo {
                        ProgressView()
                    } else {
                        Text("Enviar").bold()
                    }
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .disabled(!puedeEnviar)
                .accessibilityIdentifier("composer.enviar")
            }
            .font(.title3)

            // El dictado no está hasta que exista (PAPER §24.9, fase 4): un micrófono gris con
            // "llega en la fase 4" se leía como función a medias, y la App Store lo rechaza.
            if !hayCamara {
                Text("Cámara: este dispositivo no tiene")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}
