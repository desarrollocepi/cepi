import SwiftUI

/// Colores de marca, tomados de `cepi-frontend/src/style.css` para que la app y la web se
/// reconozcan como el mismo producto. El acento vive en el catálogo (AccentColor) porque
/// necesita una variante para modo oscuro que la web no tiene.
enum Marca {
    static let acento = Color.accentColor
    /// Fondo del logo, que es blanco: el marrón de `--accent`, fijo en modo claro y oscuro.
    static let placaLogo = Color(red: 0x63 / 255, green: 0x42 / 255, blue: 0x1E / 255)
    /// Naranja de "revisar" (`.rev-badge` en ChatList.vue).
    static let revisar = Color(red: 249 / 255, green: 115 / 255, blue: 22 / 255)
}
