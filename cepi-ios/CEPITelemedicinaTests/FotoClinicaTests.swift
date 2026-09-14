import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import CEPITelemedicina

struct FotoClinicaTests {
    @Test func acotaElLadoMayorYSaleJPEGSinGPS() async throws {
        let ancho = 5000
        let alto = 20
        let contexto = try #require(CGContext(
            data: nil, width: ancho, height: alto, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        contexto.setFillColor(red: 0.6, green: 0.4, blue: 0.3, alpha: 1)
        contexto.fill(CGRect(x: 0, y: 0, width: ancho, height: alto))
        let imagen = try #require(contexto.makeImage())

        // Un PNG con ubicación GPS, como la que trae una foto de la cámara.
        let png = NSMutableData()
        let destino = try #require(CGImageDestinationCreateWithData(png, UTType.png.identifier as CFString, 1, nil))
        let gps: [CFString: Any] = [kCGImagePropertyGPSLatitude: -0.18, kCGImagePropertyGPSLongitude: -78.47]
        CGImageDestinationAddImage(destino, imagen, [kCGImagePropertyGPSDictionary: gps] as CFDictionary)
        #expect(CGImageDestinationFinalize(destino))

        let jpeg = try #require(await FotoClinica.jpeg(desde: png as Data))
        #expect(jpeg.prefix(2) == Data([0xFF, 0xD8]))

        let fuente = try #require(CGImageSourceCreateWithData(jpeg as CFData, nil))
        let propiedades = try #require(CGImageSourceCopyPropertiesAtIndex(fuente, 0, nil) as? [CFString: Any])
        #expect(propiedades[kCGImagePropertyPixelWidth] as? Int == 4096)
        #expect(propiedades[kCGImagePropertyGPSDictionary] == nil)
    }
}
