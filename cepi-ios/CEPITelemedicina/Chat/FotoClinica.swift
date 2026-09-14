import Foundation
import ImageIO
import UniformTypeIdentifiers

enum FotoClinica {
    /// La foto lista para subir: JPEG, con el lado mayor acotado y **sin metadatos**. Así la
    /// ubicación GPS de la cámara no viaja con la imagen clínica, una foto de 48 MP no pesa
    /// megas que el backend no necesita, y un HEIC del iPhone llega en un formato que el
    /// inspector de imágenes (Pillow) sí lee.
    static func jpeg(desde datos: Data, ladoMaximo: Int = 4096) async -> Data? {
        let opciones: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: ladoMaximo,
        ]
        guard let fuente = CGImageSourceCreateWithData(datos as CFData, nil),
              let imagen = CGImageSourceCreateThumbnailAtIndex(fuente, 0, opciones as CFDictionary) else {
            return nil
        }
        let salida = NSMutableData()
        guard let destino = CGImageDestinationCreateWithData(salida, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(destino, imagen, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destino) else { return nil }
        return salida as Data
    }

    static func nombreNuevo() -> String {
        "foto-\(Int(Date.now.timeIntervalSince1970)).jpg"
    }
}
