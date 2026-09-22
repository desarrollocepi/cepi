package ec.cepi.telemedicina.pacientes

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** El LED del estado de la ficha: un punto de color; "sin consulta" va hueco. */
@Composable
fun LedEstado(estado: EstadoFicha, modifier: Modifier = Modifier, tamano: Dp = 12.dp) {
    val color = Color(estado.color)
    val forma = if (estado == EstadoFicha.SinConsulta) {
        Modifier.border(2.dp, color, CircleShape)
    } else {
        Modifier.background(color, CircleShape)
    }
    Box(modifier.size(tamano).then(forma))
}
