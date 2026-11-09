package ec.cepi.telemedicina

import ec.cepi.telemedicina.galeria.ConsentModel
import ec.cepi.telemedicina.galeria.ConsentType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** El botón «Subir foto» de los consentimientos nunca se oculta: dice por qué está gris (PAPER §31.3). */
class ConsentimientosTest {
    private fun reason(loaded: Boolean, error: String?, uploading: ConsentType?, type: ConsentType) =
        ConsentModel.uploadDisabledReason(loaded, error, uploading, type)

    @Test
    fun tiposYClaves() {
        assertEquals("informado", ConsentType.INFORMED.key)
        assertEquals("privacidad_datos", ConsentType.DATA_PRIVACY.key)
        assertEquals("Lo firma el paciente", ConsentType.INFORMED.signer)
        assertEquals("Lo firma el profesional que atiende", ConsentType.DATA_PRIVACY.signer)
    }

    @Test
    fun motivoDelBotonGris() {
        assertEquals("Espera a que carguen los consentimientos", reason(false, null, null, ConsentType.INFORMED))
        assertEquals("No se cargaron los consentimientos: reintenta", reason(false, "x", null, ConsentType.INFORMED))
        assertEquals("Subiendo…", reason(true, null, ConsentType.INFORMED, ConsentType.INFORMED))
        assertEquals("Termina primero la otra subida", reason(true, null, ConsentType.INFORMED, ConsentType.DATA_PRIVACY))
        assertNull(reason(true, null, null, ConsentType.DATA_PRIVACY))
    }
}
