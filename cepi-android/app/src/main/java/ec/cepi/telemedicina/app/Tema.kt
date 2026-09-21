package ec.cepi.telemedicina.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Colores de marca, tomados de `cepi-frontend/src/style.css` y del catálogo de iOS para que las
 * tres se reconozcan como el mismo producto. Sin color dinámico: la marca manda.
 */
object Marca {
    /** `--accent` de la web. */
    val acento = Color(0xFF63421E)
    /** El acento en modo oscuro (AccentColor de iOS). */
    val acentoOscuro = Color(0xFFC9A36B)
    /** Fondo del logo, que es blanco: el marrón de `--accent`, fijo en claro y oscuro. */
    val placaLogo = Color(0xFF63421E)
    /** Naranja de "revisar" (`.rev-badge` en ChatList.vue). */
    val revisar = Color(0xFFF97316)
}

private val claro = lightColorScheme(
    primary = Marca.acento,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF1E4D3),
    onPrimaryContainer = Color(0xFF2B1B08),
    background = Color(0xFFF0F4F8),
    surface = Color(0xFFF0F4F8),
)

private val oscuro = darkColorScheme(
    primary = Marca.acentoOscuro,
    onPrimary = Color(0xFF2B1B08),
    primaryContainer = Color(0xFF4A3116),
    onPrimaryContainer = Color(0xFFF1E4D3),
    background = Color(0xFF0F172A),
    surface = Color(0xFF0F172A),
)

@Composable
fun CepiTema(contenido: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) oscuro else claro, content = contenido)
}
