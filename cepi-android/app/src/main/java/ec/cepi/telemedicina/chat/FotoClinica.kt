package ec.cepi.telemedicina.chat

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

object FotoClinica {
    private const val LADO_MAXIMO = 4096

    /**
     * La foto lista para subir: JPEG, con el lado mayor acotado, derecha y **sin metadatos**. Así
     * la ubicación GPS de la cámara no viaja con la imagen clínica, una foto de 50 MP no pesa
     * megas que el backend no necesita, y un HEIC llega en un formato que el inspector de
     * imágenes (Pillow) sí lee. `Bitmap.compress` no escribe EXIF.
     *
     * Bloquea: llamar fuera del hilo principal.
     */
    fun jpeg(resolver: ContentResolver, uri: Uri, ladoMaximo: Int = LADO_MAXIMO): ByteArray? {
        val imagen = runCatching { decodificar(resolver, uri, ladoMaximo) }.getOrNull() ?: return null
        return ByteArrayOutputStream().use { salida ->
            imagen.compress(Bitmap.CompressFormat.JPEG, 85, salida)
            imagen.recycle()
            salida.toByteArray()
        }
    }

    fun nombreNuevo(): String = "foto-${System.currentTimeMillis() / 1000}.jpg"

    /** Una miniatura del JPEG ya preparado, decodificada chica: la lista de subidas no guarda originales. */
    fun miniatura(jpeg: ByteArray, lado: Int = 120): Bitmap? {
        val limites = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, limites)
        if (limites.outWidth <= 0) return null
        val opciones = BitmapFactory.Options().apply { inSampleSize = muestreo(limites.outWidth, limites.outHeight, lado) }
        return BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, opciones)
    }

    /** El tamaño final: el lado mayor en `ladoMaximo`, sin agrandar. */
    fun medidas(ancho: Int, alto: Int, ladoMaximo: Int): Pair<Int, Int> {
        val mayor = max(ancho, alto)
        if (mayor <= ladoMaximo) return ancho to alto
        val factor = ladoMaximo.toDouble() / mayor
        return (ancho * factor).roundToInt().coerceAtLeast(1) to (alto * factor).roundToInt().coerceAtLeast(1)
    }

    /**
     * `inSampleSize` para Android < 9: la menor potencia de 2 que deja el lado mayor en
     * `ladoMaximo` o menos, así nunca se decodifica el original entero en memoria.
     */
    fun muestreo(ancho: Int, alto: Int, ladoMaximo: Int): Int {
        var muestreo = 1
        while (max(ancho, alto) / muestreo > ladoMaximo) muestreo *= 2
        return muestreo
    }

    private fun decodificar(resolver: ContentResolver, uri: Uri, ladoMaximo: Int): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // ImageDecoder decodifica directo al tamaño pedido y aplica la orientación EXIF.
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decodificador, info, _ ->
                val (ancho, alto) = medidas(info.size.width, info.size.height, ladoMaximo)
                decodificador.setTargetSize(ancho, alto)
                decodificador.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        }
        val limites = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, limites) }
        if (limites.outWidth <= 0 || limites.outHeight <= 0) return null
        val opciones = BitmapFactory.Options().apply {
            inSampleSize = muestreo(limites.outWidth, limites.outHeight, ladoMaximo)
        }
        val imagen = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opciones) } ?: return null
        val orientacion = resolver.openInputStream(uri)?.use {
            ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } ?: ExifInterface.ORIENTATION_NORMAL
        return enderezar(imagen, orientacion)
    }

    private fun enderezar(imagen: Bitmap, orientacion: Int): Bitmap {
        val matriz = Matrix()
        when (orientacion) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matriz.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matriz.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matriz.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> matriz.apply { setRotate(90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> matriz.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> matriz.apply { setRotate(-90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> matriz.setRotate(-90f)
            else -> return imagen
        }
        val derecha = Bitmap.createBitmap(imagen, 0, 0, imagen.width, imagen.height, matriz, true)
        if (derecha !== imagen) imagen.recycle()
        return derecha
    }
}
