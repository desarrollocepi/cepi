package ec.cepi.telemedicina.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import ec.cepi.telemedicina.api.Config
import ec.cepi.telemedicina.chat.LocalImagenes

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val entorno = (application as CepiApp).entorno(Config.desde(intent))
        setContent {
            CepiTema {
                CompositionLocalProvider(LocalImagenes provides entorno.imagenes) {
                    Raiz(entorno)
                }
            }
        }
    }
}
