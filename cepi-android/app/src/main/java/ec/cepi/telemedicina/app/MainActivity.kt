package ec.cepi.telemedicina.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import ec.cepi.telemedicina.api.Config

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val entorno = (application as CepiApp).entorno(Config.desde(intent))
        setContent {
            CepiTema {
                Raiz(entorno)
            }
        }
    }
}
