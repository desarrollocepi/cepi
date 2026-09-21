package ec.cepi.telemedicina.baselineprofile

import android.content.Intent
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val PAQUETE = "ec.cepi.telemedicina"
private const val ESPERA = 20_000L

/**
 * El recorrido de todos los días: entrar, ver la lista, bajar y subir, abrir un paciente y pasar a
 * la galería. Lo que se ejecuta acá queda precompilado en la app (Baseline Profile): el primer
 * arranque y el primer scroll no pagan el JIT. Solo contra el stack local con datos ficticios;
 * el backend y la cuenta se cambian con argumentos de instrumentación (`api`, `bot`, `email`,
 * `password`).
 */
@RunWith(AndroidJUnit4::class)
class GeneradorPerfil {
    @get:Rule
    val regla = BaselineProfileRule()

    @Test
    fun recorridoPrincipal() = regla.collect(packageName = PAQUETE, includeInStartupProfile = true) {
        val argumentos = InstrumentationRegistry.getArguments()
        fun argumento(clave: String, porDefecto: String) = argumentos.getString(clave) ?: porDefecto

        pressHome()
        startActivityAndWait(
            Intent(Intent.ACTION_MAIN).apply {
                setClassName(PAQUETE, "$PAQUETE.app.MainActivity")
                putExtra("CEPI_API_BASE", argumento("api", "http://10.0.2.2:3001"))
                putExtra("CEPI_BOT_BASE", argumento("bot", "http://10.0.2.2:3002"))
                putExtra("CEPI_DEV_EMAIL", argumento("email", "primario@cepi.local"))
                putExtra("CEPI_DEV_PASSWORD", argumento("password", "Admin123!"))
            },
        )

        // Lista cargada: hay filas con cédula.
        check(device.wait(Until.hasObject(By.textStartsWith("CC:")), ESPERA)) { "La lista de pacientes no cargó" }
        device.findObject(By.scrollable(true))?.let { lista ->
            lista.setGestureMargin(device.displayWidth / 5)
            lista.fling(Direction.DOWN)
            device.waitForIdle()
            lista.fling(Direction.UP)
            device.waitForIdle()
        }

        // Un paciente: el hilo con su composer.
        device.findObject(By.textStartsWith("CC:")).click()
        check(device.wait(Until.hasObject(By.text("Enviar")), ESPERA)) { "El hilo no abrió" }
        device.findObject(By.text("Imágenes"))?.click()
        device.waitForIdle()
        device.pressBack()

        // La galería de la organización.
        check(device.wait(Until.hasObject(By.text("Galería")), ESPERA))
        device.findObject(By.text("Galería")).click()
        device.wait(Until.hasObject(By.textStartsWith("Paciente, cédula")), ESPERA)
        device.waitForIdle()
    }
}
