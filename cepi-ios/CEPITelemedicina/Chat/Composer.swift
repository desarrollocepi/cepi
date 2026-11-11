import PhotosUI
import SwiftUI

/// Caja de texto y acciones del hilo. Lo que no aplica se ve gris y el pie dice por qué
/// (CLAUDE.md: nunca ocultes un botón).
///
/// Al enviar, el campo se vacía y se recrea (`.id(generation)`). Vaciar solo el binding no
/// alcanzaba: el `TextField` con `axis: .vertical` es un `UITextView` que, mientras tiene el
/// foco, guarda la palabra en curso del teclado (autocorrección, predicción, dictado). Al
/// tocar «Enviar» el teclado la confirma DESPUÉS de que el binding quedó en "", y el
/// `UITextView` le devuelve al binding el texto entero: quedaba pegado, o volvía a aparecer en
/// el siguiente redibujo (cuando llegaba la respuesta). Un campo nuevo no arrastra ese estado.
struct Composer: View {
    @Binding var texto: String
    let ocupado: Bool
    let subiendo: Bool
    let adjunto: Adjunto?
    @Binding var fotoElegida: PhotosPickerItem?
    let alTomarFoto: () -> Void
    let alQuitarAdjunto: () -> Void
    /// Recibe el texto a mandar; el campo ya quedó vacío.
    let alEnviar: (String) -> Void

    @FocusState private var focused: Bool
    /// Sube en cada envío: recrea el campo sin el estado del teclado.
    @State private var generation = 0
    /// Lo último que se mandó: si el teclado lo devuelve al campo, se descarta.
    @State private var lastSent: String?

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
                .focused($focused)
                .id(generation)
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

                Button(action: send) {
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
        .onChange(of: texto) { _, value in
            guard let lastSent else { return }
            if ComposerLogic.isEcho(value, of: lastSent) {
                texto = ""
            } else if !value.isEmpty {
                self.lastSent = nil
            }
        }
    }

    private func send() {
        guard puedeEnviar else { return }
        let text = texto
        let keepTyping = focused
        lastSent = ComposerLogic.sentKey(text)
        texto = ""
        generation += 1
        alEnviar(text)
        // El campo nuevo recupera el foco: se sigue escribiendo sin tocarlo otra vez.
        if keepTyping {
            Task { @MainActor in focused = true }
        }
    }
}

/// Lo que decide si un cambio del campo tras enviar es el teclado devolviendo lo enviado.
enum ComposerLogic {
    static func sentKey(_ text: String) -> String? {
        let key = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return key.isEmpty ? nil : key
    }

    /// El texto que reaparece es el ya enviado (igual, salvo espacios al borde).
    static func isEcho(_ value: String, of sent: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed == sent
    }
}
