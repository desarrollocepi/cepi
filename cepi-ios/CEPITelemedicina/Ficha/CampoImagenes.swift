import PhotosUI
import SwiftUI

/// §4.7 y §8: fotos que se suben al elegirlas; el campo guarda el CSV de ids de adjunto
/// (ImageUploadField.vue). El bot las inspecciona y registra al guardar el grupo.
struct CampoImagenes: View {
    @Binding var csv: String
    let multiple: Bool

    @Environment(Sesion.self) private var sesion
    @State private var elegidas: [PhotosPickerItem] = []
    @State private var items: [Item] = []
    @State private var subiendo = false

    struct Item: Identifiable {
        enum Estado { case subiendo, lista, error }
        let id = UUID()
        let nombre: String
        let miniatura: UIImage?
        var estado: Estado
        var adjunto: String?
    }

    var body: some View {
        // Fuera del closure de la etiqueta, que es @Sendable y no puede leer el estado.
        let textoBoton = subiendo ? "Subiendo…" : (multiple ? "Elegir imágenes" : "Elegir imagen")
        VStack(alignment: .leading, spacing: 8) {
            PhotosPicker(
                selection: $elegidas,
                maxSelectionCount: multiple ? nil : 1,
                matching: .images
            ) {
                Label(textoBoton, systemImage: "photo.badge.plus")
            }
            .buttonStyle(.bordered)
            .disabled(subiendo)

            if items.isEmpty {
                Text(multiple ? "Sube una o más imágenes." : "Sube la imagen.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(items) { item in
                HStack(spacing: 10) {
                    Group {
                        if let miniatura = item.miniatura {
                            Image(uiImage: miniatura).resizable().scaledToFill()
                        } else {
                            Color.secondary.opacity(0.2)
                        }
                    }
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                    Text(item.nombre).font(.footnote).lineLimit(1)
                    Spacer()
                    switch item.estado {
                    case .subiendo: ProgressView()
                    case .lista: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    case .error: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    }
                    Button { quitar(item.id) } label: { Image(systemName: "xmark.circle") }
                        .buttonStyle(.plain)
                        .disabled(item.estado == .subiendo)
                        .accessibilityLabel("Quitar \(item.nombre)")
                }
            }
        }
        .onChange(of: elegidas) { _, nuevas in
            guard !nuevas.isEmpty else { return }
            elegidas = []
            Task { await subir(nuevas) }
        }
    }

    private func subir(_ fotos: [PhotosPickerItem]) async {
        subiendo = true
        defer { subiendo = false }
        if !multiple { items = [] }
        for foto in fotos {
            guard let datos = try? await foto.loadTransferable(type: Data.self),
                  let jpeg = await FotoClinica.jpeg(desde: datos) else { continue }
            let nombre = FotoClinica.nombreNuevo()
            let item = Item(nombre: nombre, miniatura: CargadorImagenes.reducir(jpeg, ladoMaximo: 120), estado: .subiendo)
            items.append(item)
            let adjunto = try? await sesion.api.subirImagen(jpeg, nombre: nombre)
            if let indice = items.firstIndex(where: { $0.id == item.id }) {
                items[indice].adjunto = adjunto?.id
                items[indice].estado = adjunto == nil ? .error : .lista
            }
            sincronizar()
        }
    }

    private func quitar(_ id: UUID) {
        items.removeAll { $0.id == id }
        sincronizar()
    }

    private func sincronizar() {
        csv = items.compactMap { $0.estado == .lista ? $0.adjunto : nil }.joined(separator: ",")
    }
}
