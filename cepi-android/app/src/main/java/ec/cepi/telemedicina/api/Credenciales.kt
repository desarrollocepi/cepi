package ec.cepi.telemedicina.api

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Dónde persiste el JWT. En la app es el Keystore; en los tests, memoria. */
interface Almacen {
    fun leer(): String?
    fun guardar(valor: String?)
}

/**
 * El JWT de la sesión. Abre historias clínicas: se guarda cifrado (`AlmacenKeystore`) y se
 * lee una sola vez por proceso.
 */
class Credenciales(private val almacen: Almacen) {
    /**
     * Avisa cuando el backend rechazó el token (401). La sesión lo escucha para volver al
     * login; el cliente HTTP no sabe nada de la UI.
     */
    @Volatile
    var alExpirar: (() -> Unit)? = null

    private val candado = Any()
    private var enMemoria: String? = null
    private var leido = false

    suspend fun token(): String? = withContext(Dispatchers.IO) {
        synchronized(candado) {
            if (!leido) {
                enMemoria = almacen.leer()
                leido = true
            }
            enMemoria
        }
    }

    suspend fun guardar(token: String?) = withContext(Dispatchers.IO) {
        synchronized(candado) { fijar(token) }
    }

    /**
     * Solo si el token rechazado sigue siendo el vigente: el 401 de una llamada que salió
     * antes de un login nuevo no debe tirar la sesión recién abierta.
     */
    suspend fun expirar(tokenRechazado: String) {
        val expiro = withContext(Dispatchers.IO) {
            synchronized(candado) {
                if (tokenRechazado != enMemoria) return@withContext false
                fijar(null)
                true
            }
        }
        if (expiro) alExpirar?.invoke()
    }

    private fun fijar(token: String?) {
        enMemoria = token
        leido = true
        almacen.guardar(token)
    }
}

/**
 * AES-GCM con una llave del Android Keystore, que no sale del hardware. El texto cifrado vive
 * en `noBackupFilesDir`: ni backup ni restauración en otro teléfono, como
 * `ThisDeviceOnly` en el Keychain de iOS. `EncryptedSharedPreferences` está deprecada.
 */
class AlmacenKeystore(contexto: Context) : Almacen {
    private val archivo = AtomicFile(File(contexto.noBackupFilesDir, "sesion.bin"))

    override fun leer(): String? = try {
        val datos = archivo.readFully()
        val cifrador = Cipher.getInstance(TRANSFORMACION)
        cifrador.init(Cipher.DECRYPT_MODE, llave(), GCMParameterSpec(128, datos, 0, LARGO_IV))
        String(cifrador.doFinal(datos, LARGO_IV, datos.size - LARGO_IV), Charsets.UTF_8)
    } catch (_: FileNotFoundException) {
        null
    } catch (_: Exception) {
        // Llave regenerada (restauración de fábrica del Keystore) o archivo dañado: la
        // sesión no se recupera, se vuelve a entrar.
        archivo.delete()
        null
    }

    override fun guardar(valor: String?) {
        if (valor == null) {
            archivo.delete()
            return
        }
        val cifrador = Cipher.getInstance(TRANSFORMACION)
        cifrador.init(Cipher.ENCRYPT_MODE, llave())
        val datos = cifrador.iv + cifrador.doFinal(valor.toByteArray(Charsets.UTF_8))
        val salida = archivo.startWrite()
        try {
            salida.write(datos)
            archivo.finishWrite(salida)
        } catch (e: Exception) {
            archivo.failWrite(salida)
            throw e
        }
    }

    private fun llave(): SecretKey {
        val almacen = KeyStore.getInstance(PROVEEDOR).apply { load(null) }
        (almacen.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVEEDOR)
        generador.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generador.generateKey()
    }

    private companion object {
        const val PROVEEDOR = "AndroidKeyStore"
        const val ALIAS = "cepi-sesion"
        const val TRANSFORMACION = "AES/GCM/NoPadding"
        const val LARGO_IV = 12
    }
}
