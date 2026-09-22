package ec.cepi.telemedicina.chat

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.util.Locale

/**
 * Dictado en español con el reconocedor del sistema, sin plugin (PAPER §25.1). Se crea y se usa
 * en el hilo principal: el plugin de la APK lo hacía fuera y tumbaba la app.
 *
 * - En el dispositivo cuando se puede (Android 12+ con el idioma descargado): funciona en modo
 *   avión y el audio no sale del teléfono. Si el motor local no tiene el idioma, pasa al
 *   reconocedor por red y lo dice.
 * - Manos libres: en Android 13+ una sesión segmentada larga entrega un tramo por pausa sin
 *   cortar; antes, al terminar cada frase se relanza solo hasta que se toca el micrófono.
 */
class Dictado(private val contexto: Context) : RecognitionListener {
    var escuchando: Boolean by mutableStateOf(false)
        private set
    /** Lo que se está diciendo, todavía sin cerrar. */
    var parcial: String by mutableStateOf("")
        private set
    var aviso: String? by mutableStateOf(null)
        private set

    val disponible: Boolean = SpeechRecognizer.isRecognitionAvailable(contexto)

    /** Cada tramo ya reconocido; lo pega el composer en su borrador. */
    var alTramo: (String) -> Unit = {}

    private var reconocedor: SpeechRecognizer? = null
    private var enDispositivo = true

    /**
     * Las variantes de español que se prueban, en orden: la del teléfono si ya es español (la
     * que con seguridad tiene el paquete), es-EC, y las dos que traen los motores en el
     * dispositivo, es-US (latinoamericano) y es-ES. Un motor que no tiene una responde "idioma
     * no soportado" y se pasa a la siguiente.
     */
    private val idiomas: List<String> = variantes(Locale.getDefault())
    private var indiceIdioma = 0
    private val idioma: String get() = idiomas[indiceIdioma]

    fun empezar() {
        if (escuchando || !disponible) return
        aviso = null
        parcial = ""
        escuchando = true
        lanzar()
    }

    /** Deja de escuchar; lo último dicho llega igual por `onResults`. */
    fun terminar() {
        escuchando = false
        reconocedor?.stopListening()
    }

    fun liberar() {
        escuchando = false
        parcial = ""
        reconocedor?.destroy()
        reconocedor = null
    }

    private fun lanzar() {
        val actual = reconocedor ?: crear().also { reconocedor = it }
        actual.startListening(pedido())
    }

    private fun crear(): SpeechRecognizer {
        val local = enDispositivo && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(contexto)
        val nuevo = if (local && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(contexto)
        } else {
            SpeechRecognizer.createSpeechRecognizer(contexto)
        }
        nuevo.setRecognitionListener(this)
        return nuevo
    }

    private fun pedido() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, idioma)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, contexto.packageName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // El valor es el NOMBRE del extra que acota la sesión, y ese extra va aparte.
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, SESION_MS)
        }
    }

    private fun primero(resultados: Bundle?): String =
        resultados?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

    override fun onPartialResults(resultados: Bundle?) {
        parcial = primero(resultados)
    }

    override fun onSegmentResults(resultados: Bundle) {
        entregar(primero(resultados))
    }

    override fun onEndOfSegmentedSession() {
        if (escuchando) lanzar() else liberar()
    }

    override fun onResults(resultados: Bundle?) {
        entregar(primero(resultados))
        if (escuchando) lanzar() else liberar()
    }

    override fun onError(codigo: Int) {
        Log.i("dictado", "error $codigo (en el dispositivo: $enDispositivo, idioma $idioma)")
        when (codigo) {
            // Silencio o nada entendible: en manos libres se sigue escuchando.
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                if (escuchando) lanzar() else liberar()
            // Después de terminar() o de liberar(): no es un fallo.
            SpeechRecognizer.ERROR_CLIENT -> if (!escuchando) liberar() else parar("El dictado se detuvo.")
            ERROR_IDIOMA_NO_SOPORTADO -> when {
                indiceIdioma < idiomas.lastIndex -> {
                    indiceIdioma++
                    if (escuchando) lanzar()
                }
                enDispositivo -> {
                    // Ninguna variante en el motor local: el reconocedor por red, desde la primera.
                    enDispositivo = false
                    indiceIdioma = 0
                    reconocedor?.destroy()
                    reconocedor = null
                    aviso = "El español no está en el reconocedor del teléfono sin conexión: se usa la red."
                    if (escuchando) lanzar()
                }
                else -> parar("Este teléfono no reconoce español.")
            }
            ERROR_IDIOMA_NO_DESCARGADO -> if (enDispositivo) {
                // El motor local tiene el español pero sin bajar: se le pide la descarga (Android
                // 13+) y mientras tanto se dicta por red. La próxima vez ya funciona en modo avión.
                val descarga = codigo == ERROR_IDIOMA_NO_DESCARGADO && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                if (descarga && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) reconocedor?.triggerModelDownload(pedido())
                enDispositivo = false
                reconocedor?.destroy()
                reconocedor = null
                aviso = if (descarga) {
                    "Descargando el español para dictar sin conexión; mientras tanto se usa la red."
                } else {
                    "El español no está en el reconocedor del teléfono sin conexión: se usa la red."
                }
                if (escuchando) lanzar()
            } else {
                parar("Este teléfono no reconoce español.")
            }
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> parar("Falta el permiso de micrófono.")
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER ->
                parar("Sin conexión y sin el español descargado en el teléfono no se puede dictar.")
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> parar("El micrófono lo está usando otra app.")
            else -> parar("El dictado se detuvo (código $codigo).")
        }
    }

    private fun entregar(tramo: String) {
        parcial = ""
        if (tramo.isNotEmpty()) alTramo(tramo)
    }

    private fun parar(motivo: String) {
        aviso = motivo
        liberar()
    }

    override fun onReadyForSpeech(params: Bundle?) {
        Log.i("dictado", "escuchando en $idioma (en el dispositivo: $enDispositivo)")
    }

    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = Unit
    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    companion object {
        /** Una consulta larga: el reconocedor corta la sesión segmentada a los 10 min y se relanza. */
        private const val SESION_MS = 10 * 60 * 1000L

        // SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED / ERROR_LANGUAGE_UNAVAILABLE (API 31).
        private const val ERROR_IDIOMA_NO_SOPORTADO = 12
        private const val ERROR_IDIOMA_NO_DESCARGADO = 13

        fun variantes(telefono: Locale): List<String> =
            listOfNotNull(telefono.toLanguageTag().takeIf { telefono.language == "es" }, "es-EC", "es-US", "es-ES").distinct()

        /** Une el borrador con un tramo dictado, con un espacio y sin dobles. */
        fun unir(borrador: String, tramo: String): String =
            listOf(borrador.trimEnd(), tramo.trim()).filter { it.isNotEmpty() }.joinToString(" ")
    }
}

/**
 * Un dictado por pantalla. Se suelta al salir y al pasar a segundo plano: el micrófono no queda
 * abierto con la app cerrada.
 */
@Composable
fun rememberDictado(alTramo: (String) -> Unit): Dictado {
    val contexto = LocalContext.current
    val dictado = remember { Dictado(contexto.applicationContext) }
    dictado.alTramo = alTramo
    val ciclo = LocalLifecycleOwner.current
    DisposableEffect(ciclo) {
        val observador = LifecycleEventObserver { _, evento ->
            if (evento == Lifecycle.Event.ON_STOP) dictado.liberar()
        }
        ciclo.lifecycle.addObserver(observador)
        onDispose {
            ciclo.lifecycle.removeObserver(observador)
            dictado.liberar()
        }
    }
    return dictado
}
