package ec.cepi.telemedicina.app

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import ec.cepi.telemedicina.api.Config

/** Un fallo del ingreso con Google que se muestra tal cual. Cancelar no es un fallo. */
class FallaGoogle(val mensaje: String) : Exception(mensaje)

class GoogleCancelado : Exception()

/**
 * El ID token de Google por Credential Manager: la hoja del sistema con las cuentas del
 * teléfono, sin WebView (Google bloquea OAuth en WebViews) y sin plugin. Es lo que hace hoy la
 * APK con el plugin de capgo, sin el plugin.
 */
object LoginGoogle {
    suspend fun idToken(actividad: Context): String {
        val pedido = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(Config.GOOGLE_CLIENT_ID_WEB).build())
            .build()
        val respuesta = try {
            CredentialManager.create(actividad).getCredential(actividad, pedido)
        } catch (_: GetCredentialCancellationException) {
            throw GoogleCancelado()
        } catch (_: NoCredentialException) {
            throw FallaGoogle("No hay una cuenta de Google en este teléfono. Agrégala en Ajustes → Cuentas.")
        } catch (e: GetCredentialException) {
            throw FallaGoogle("Google no respondió: ${e.errorMessage ?: e.type}")
        }
        val credencial = respuesta.credential
        if (credencial is CustomCredential && credencial.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            return GoogleIdTokenCredential.createFrom(credencial.data).idToken
        }
        throw FallaGoogle("Google devolvió una credencial inesperada.")
    }
}
