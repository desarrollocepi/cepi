package ec.cepi.telemedicina.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import ec.cepi.telemedicina.api.Config
import ec.cepi.telemedicina.chat.LocalImagenes
import ec.cepi.telemedicina.notificaciones.Notificador

class MainActivity : ComponentActivity() {
    private lateinit var entorno: Entorno

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        entorno = (application as CepiApp).entorno(Config.desde(intent))
        tomarDestino(intent)
        setContent {
            CepiTema {
                CompositionLocalProvider(LocalImagenes provides entorno.imagenes) {
                    Raiz(entorno)
                }
            }
        }
    }

    /** `singleTop`: tocar una notificación con la app abierta llega acá, no a otra actividad. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tomarDestino(intent)
    }

    /**
     * La notificación trae `entity_id` (el sistema pone en los extras el `data` del push). Se
     * saca del intent al leerla: recrear la actividad no vuelve a abrir el mismo paciente.
     */
    private fun tomarDestino(intent: Intent?) {
        val entidad = intent?.getStringExtra(Notificador.EXTRA_ENTIDAD)?.takeIf { it.isNotBlank() } ?: return
        intent.removeExtra(Notificador.EXTRA_ENTIDAD)
        entorno.destinoPush = entidad
    }
}
