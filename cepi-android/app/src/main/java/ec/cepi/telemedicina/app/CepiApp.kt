package ec.cepi.telemedicina.app

import android.app.Application
import ec.cepi.telemedicina.api.Config

/** Lo que vive lo mismo que el proceso: la config del arranque y la sesión. */
class Entorno(val config: Config, val sesion: Sesion)

class CepiApp : Application() {
    private var entorno: Entorno? = null

    /**
     * Uno por proceso: la sesión sobrevive a la actividad. La config es la del primer
     * arranque; para probar otra en debug, relanzar con `am start -S`.
     */
    fun entorno(config: Config): Entorno =
        entorno ?: Entorno(config, Sesion.crear(this, config)).also { entorno = it }
}
