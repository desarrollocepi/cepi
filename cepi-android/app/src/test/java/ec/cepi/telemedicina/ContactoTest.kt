package ec.cepi.telemedicina

import ec.cepi.telemedicina.pacientes.Contacto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Celular obligatorio y email opcional en el alta (PAPER §36.1). */
class ContactoTest {
    @Test fun celularesValidos() {
        assertEquals("0991234567", Contacto.normalizeMobile("0991234567"))
        assertEquals("0991234567", Contacto.normalizeMobile("099-123-4567"))
        assertEquals("0991234567", Contacto.normalizeMobile("+593 99 123 4567"))
        assertEquals("0991234567", Contacto.normalizeMobile("593991234567"))
        assertEquals("+14155550100", Contacto.normalizeMobile("+1 (415) 555-0100"))
    }

    @Test fun celularesInvalidos() {
        for (x in listOf("", "02 234 5678", "12345", "abc", "0891234567", "+593 2 234 5678")) {
            assertNull(x, Contacto.normalizeMobile(x))
        }
    }

    @Test fun motivoDelBotonGris() {
        assertTrue(Contacto.blocker("Ana", "Ruiz", "1", "", "")!!.contains("celular son obligatorios"))
        assertTrue(Contacto.blocker("Ana", "Ruiz", "1", "123", "")!!.startsWith("Celular no válido"))
        assertTrue(Contacto.blocker("Ana", "Ruiz", "1", "0991234567", "ana@") != null)
        assertNull(Contacto.blocker("Ana", "Ruiz", "1", "0991234567", ""))
        assertNull(Contacto.blocker("Ana", "Ruiz", "1", "0991234567", "ana@correo.ec"))
    }
}
