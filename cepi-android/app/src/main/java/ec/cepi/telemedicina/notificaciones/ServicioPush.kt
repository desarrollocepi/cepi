package ec.cepi.telemedicina.notificaciones

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import ec.cepi.telemedicina.app.CepiApp
import ec.cepi.telemedicina.app.Sesion
import kotlinx.coroutines.launch

/**
 * FCM. Con la app en segundo plano el backend manda `notification` y la pinta el sistema en el
 * canal por defecto (`derivaciones`); tocarla abre la app con `entity_id` en los extras. Con la
 * app abierta llega acá y se pinta en el canal sin sonido.
 */
class ServicioPush : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val entorno = (application as CepiApp).entornoActual() ?: return
        if (entorno.sesion.estado != Sesion.Estado.Activa) return
        entorno.alcance.launch { entorno.registroPush.registrar(token) }
    }

    override fun onMessageReceived(mensaje: RemoteMessage) {
        val titulo = mensaje.notification?.title ?: mensaje.data["title"] ?: "CEPI Telemedicina"
        val cuerpo = mensaje.notification?.body ?: mensaje.data["body"].orEmpty()
        Notificador.mostrar(this, titulo, cuerpo, mensaje.data["entity_id"], mensaje.data["reminder_id"])
        // La bandeja se refresca sin esperar a su próxima vuelta.
        (application as CepiApp).entornoActual()?.let { it.avisosNuevos++ }
    }
}
