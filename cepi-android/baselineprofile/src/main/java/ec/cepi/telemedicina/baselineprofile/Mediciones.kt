package ec.cepi.telemedicina.baselineprofile

import android.content.Intent
import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.ExperimentalMetricApi
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.benchmark.macro.MemoryUsageMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val APP = "ec.cepi.telemedicina"
private const val ESPERA_MS = 20_000L

private fun argumento(clave: String, porDefecto: String) =
    InstrumentationRegistry.getArguments().getString(clave) ?: porDefecto

/**
 * Contra el stack local, sin credenciales: lo que se mide es volver con la sesión guardada. Por
 * `adb reverse tcp:3001 tcp:3001` (y 3002) y 127.0.0.1, en teléfono y en emulador: la red del
 * emulador hacia 10.0.2.2 agrega ~500 ms fijos por pedido y se comía la medición.
 */
private fun intentApp() = Intent(Intent.ACTION_MAIN).apply {
    setClassName(APP, "$APP.app.MainActivity")
    putExtra("CEPI_API_BASE", argumento("api", "http://127.0.0.1:3001"))
    putExtra("CEPI_BOT_BASE", argumento("bot", "http://127.0.0.1:3002"))
}

private fun MacrobenchmarkScope.esperarLista() {
    check(device.wait(Until.hasObject(By.textStartsWith("CC:")), ESPERA_MS)) { "La lista de pacientes no apareció" }
}

/**
 * Las métricas de PAPER §25.5. Antes de medir se entra una vez con la cuenta de desarrollo: el
 * arranque en frío que cuenta es el de todos los días, con la sesión guardada.
 */
@RunWith(AndroidJUnit4::class)
class Mediciones {
    @get:Rule
    val regla = MacrobenchmarkRule()

    @Before
    fun entrarUnaVez() {
        val dispositivo = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        // El pedido de permiso de notificaciones (Android 13+) taparía la lista.
        dispositivo.executeShellCommand("pm grant $APP android.permission.POST_NOTIFICATIONS")
        dispositivo.executeShellCommand(
            "am start -S -W -n $APP/.app.MainActivity" +
                " --es CEPI_API_BASE ${argumento("api", "http://127.0.0.1:3001")}" +
                " --es CEPI_BOT_BASE ${argumento("bot", "http://127.0.0.1:3002")}" +
                " --es CEPI_DEV_EMAIL ${argumento("email", "primario@cepi.local")}" +
                // Sin comillas: executeShellCommand no pasa por un shell, las comillas llegarían tal cual.
                " --es CEPI_DEV_PASSWORD ${argumento("password", "Admin123!")}",
        )
        check(dispositivo.wait(Until.hasObject(By.textStartsWith("CC:")), ESPERA_MS)) { "No se pudo entrar" }
    }

    /** Arranque en frío con sesión → lista visible (`reportFullyDrawn`), sin precompilar. */
    @Test
    fun arranqueSinPerfil() = arranque(CompilationMode.None())

    /** Lo mismo con el Baseline Profile instalado, como sale de Play. */
    @Test
    fun arranqueConPerfil() = arranque(CompilationMode.Partial(BaselineProfileMode.Require))

    private fun arranque(modo: CompilationMode) = regla.measureRepeated(
        packageName = APP,
        metrics = listOf(StartupTimingMetric()),
        compilationMode = modo,
        startupMode = StartupMode.COLD,
        iterations = 8,
        setupBlock = { pressHome() },
    ) {
        startActivityAndWait(intentApp())
        esperarLista()
    }

    /** Scroll de la lista de pacientes: `frameOverrunMs` P95 ≤ 0 es ningún frame tarde. */
    @Test
    fun scrollDeLaLista() = regla.measureRepeated(
        packageName = APP,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = CompilationMode.Partial(BaselineProfileMode.Require),
        startupMode = StartupMode.WARM,
        iterations = 5,
        setupBlock = {
            startActivityAndWait(intentApp())
            esperarLista()
        },
    ) {
        val lista = device.findObject(By.scrollable(true))
        lista.setGestureMargin(device.displayWidth / 5)
        repeat(2) {
            lista.fling(Direction.DOWN)
            device.waitForIdle()
        }
        lista.fling(Direction.UP)
        device.waitForIdle()
    }

    /** Memoria al abrir un paciente con su hilo e imágenes y pasar a la galería. */
    @OptIn(ExperimentalMetricApi::class)
    @Test
    fun memoriaPacienteYGaleria() = regla.measureRepeated(
        packageName = APP,
        metrics = listOf(MemoryUsageMetric(MemoryUsageMetric.Mode.Max)),
        compilationMode = CompilationMode.Partial(BaselineProfileMode.Require),
        startupMode = StartupMode.COLD,
        iterations = 3,
        setupBlock = { pressHome() },
    ) {
        startActivityAndWait(intentApp())
        esperarLista()
        device.findObject(By.textStartsWith("CC:")).click()
        device.wait(Until.hasObject(By.text("Enviar")), ESPERA_MS)
        device.findObject(By.text("Imágenes"))?.click()
        device.waitForIdle()
        Thread.sleep(2_000)
        device.pressBack()
        device.wait(Until.hasObject(By.text("Galería")), ESPERA_MS)
        device.findObject(By.text("Galería")).click()
        device.waitForIdle()
        Thread.sleep(3_000)
    }
}
