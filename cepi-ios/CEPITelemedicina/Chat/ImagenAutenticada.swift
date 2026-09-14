import ImageIO
import SwiftUI
import UIKit

/// Imágenes de adjuntos: se piden con Bearer y se guardan en memoria ya reducidas al tamaño en
/// que se muestran. Un hilo con 50 fotos no debe tener 50 originales decodificados (§24.5).
actor CargadorImagenes {
    static let compartido = CargadorImagenes()

    private let cache = NSCache<NSString, UIImage>()
    private var enCurso: [String: Task<UIImage?, Never>] = [:]

    func imagen(id: String, ladoMaximo: CGFloat, api: CEPIAPI) async -> UIImage? {
        let clave = "\(id)@\(Int(ladoMaximo))"
        if let guardada = cache.object(forKey: clave as NSString) { return guardada }
        if let pendiente = enCurso[clave] { return await pendiente.value }

        // Desacoplada del actor: decodificar no debe hacer fila detrás de otras imágenes.
        let tarea = Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let datos = try? await api.archivo(adjunto: id) else { return nil }
            return Self.reducir(datos, ladoMaximo: ladoMaximo)
        }
        enCurso[clave] = tarea
        let imagen = await tarea.value
        enCurso[clave] = nil
        if let imagen { cache.setObject(imagen, forKey: clave as NSString) }
        return imagen
    }

    /// Decodifica directo al tamaño pedido, respetando la orientación EXIF.
    static func reducir(_ datos: Data, ladoMaximo: CGFloat) -> UIImage? {
        guard let fuente = CGImageSourceCreateWithData(datos as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else {
            return nil
        }
        let opciones: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: ladoMaximo,
        ]
        guard let imagen = CGImageSourceCreateThumbnailAtIndex(fuente, 0, opciones as CFDictionary) else { return nil }
        return UIImage(cgImage: imagen)
    }
}

struct ImagenAutenticada: View {
    let id: String
    /// En píxeles: 720 alcanza para una miniatura de 240 pt en pantallas @3x.
    var ladoMaximo: CGFloat = 720

    @Environment(Sesion.self) private var sesion
    @State private var imagen: UIImage?
    @State private var fallo = false

    var body: some View {
        Group {
            if let imagen {
                Image(uiImage: imagen)
                    .resizable()
                    .scaledToFit()
            } else if fallo {
                Label("No se pudo cargar la imagen", systemImage: "photo.badge.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ProgressView()
                    .frame(width: 120, height: 90)
            }
        }
        .task(id: id) {
            imagen = await CargadorImagenes.compartido.imagen(id: id, ladoMaximo: ladoMaximo, api: sesion.api)
            fallo = imagen == nil
        }
    }
}
