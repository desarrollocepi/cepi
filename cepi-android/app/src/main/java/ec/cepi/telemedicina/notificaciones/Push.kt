package ec.cepi.telemedicina.notificaciones

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.app.MainActivity
import kotlinx.coroutines.tasks.await

/** De dónde sale el token de push. En la app, FCM; en los tests, uno fijo. */
interface FuenteToken {
    /** `null` si el push no está disponible (sin Firebase en esta compilación, sin Google Play). */
    suspend fun token(): String?
}

class FuenteFcm(private val contexto: Context) : FuenteToken {
    /** Sin `google-services.json` al compilar no hay Firebase: el push queda apagado. */
    val configurado: Boolean get() = FirebaseApp.getApps(contexto).isNotEmpty()

    override suspend fun token(): String? {
        if (!configurado) return null
        return try {
            FirebaseMessaging.getInstance().token.await()
        } catch (e: Exception) {
            // Sin Google Play o sin red: se reintenta en el próximo ingreso.
            Log.w("push", "sin token de FCM: ${e.javaClass.simpleName}")
            null
        }
    }
}

/**
 * El token de este teléfono en el backend (`/api/push/device-token`, `platform: 'android'`, lo
 * mismo que la APK). Se registra al entrar y se borra al salir, antes de soltar la sesión: si
 * no, las derivaciones le llegarían al teléfono de la próxima persona (PAPER §24.6).
 */
class RegistroPush(private val api: CepiApi, private val fuente: FuenteToken) {
    private var registrado: String? = null

    suspend fun registrar(token: String? = null) {
        val vigente = token ?: fuente.token() ?: return
        try {
            api.registrarDispositivo(vigente)
            registrado = vigente
        } catch (e: ApiError) {
            Log.w("push", "no se pudo registrar el token: ${e.mensaje}")
        }
    }

    suspend fun olvidar() {
        val vigente = registrado ?: fuente.token() ?: return
        try {
            api.olvidarDispositivo(vigente)
        } catch (e: ApiError) {
            Log.w("push", "no se pudo borrar el token: ${e.mensaje}")
        }
        registrado = null
    }
}

object Canales {
    /** Con la app cerrada: con sonido, como cualquier aviso. */
    const val DERIVACIONES = "derivaciones"

    /** Con la app abierta: banner y vibración, sin sonido (se usa en consulta, PAPER §24.6). */
    const val EN_CONSULTA = "en_consulta"

    fun crear(contexto: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val gestor = contexto.getSystemService(NotificationManager::class.java) ?: return
        gestor.createNotificationChannels(
            listOf(
                NotificationChannel(DERIVACIONES, "Derivaciones", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Pacientes derivados a ti y avisos de la telemedicina."
                    enableVibration(true)
                },
                NotificationChannel(EN_CONSULTA, "Derivaciones con la app abierta", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Sin sonido: la app se usa con el paciente delante."
                    setSound(null, null)
                    enableVibration(true)
                },
            ),
        )
    }
}

object Notificador {
    const val EXTRA_ENTIDAD = "entity_id"

    fun permitido(contexto: Context): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(contexto, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(contexto).areNotificationsEnabled()

    /** El aviso que llegó con la app abierta; tocarlo abre el paciente, igual que el del sistema. */
    fun mostrar(contexto: Context, titulo: String, cuerpo: String, entidad: String?, aviso: String?) {
        if (!permitido(contexto)) return
        val abrir = Intent(contexto, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (entidad != null) putExtra(EXTRA_ENTIDAD, entidad)
        }
        val codigo = (aviso ?: entidad ?: titulo).hashCode()
        val pendiente = PendingIntent.getActivity(contexto, codigo, abrir, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notificacion = NotificationCompat.Builder(contexto, Canales.EN_CONSULTA)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(titulo)
            .setContentText(cuerpo)
            .setStyle(NotificationCompat.BigTextStyle().bigText(cuerpo))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setSilent(false)
            .setAutoCancel(true)
            .setContentIntent(pendiente)
            .build()
        try {
            NotificationManagerCompat.from(contexto).notify(codigo, notificacion)
        } catch (_: SecurityException) {
            // El permiso se revocó entre la consulta y el aviso.
        }
    }
}
