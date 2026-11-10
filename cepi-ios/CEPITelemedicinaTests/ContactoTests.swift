import Testing
@testable import CEPITelemedicina

/// Celular obligatorio y email opcional en el alta (PAPER §36.1).
struct ContactoTests {
    @Test func celularesValidos() {
        #expect(Contacto.normalizeMobile("0991234567") == "0991234567")
        #expect(Contacto.normalizeMobile("099-123-4567") == "0991234567")
        #expect(Contacto.normalizeMobile("+593 99 123 4567") == "0991234567")
        #expect(Contacto.normalizeMobile("593991234567") == "0991234567")
        #expect(Contacto.normalizeMobile("+1 (415) 555-0100") == "+14155550100")
    }

    @Test func celularesInvalidos() {
        for x in ["", "02 234 5678", "12345", "abc", "0891234567", "+593 2 234 5678"] {
            #expect(Contacto.normalizeMobile(x) == nil)
        }
    }

    @Test func motivoDelBotonGris() {
        #expect(Contacto.blocker(nombre: "Ana", apellidos: "Ruiz", cedula: "1", celular: "", email: "")?
            .contains("celular son obligatorios") == true)
        #expect(Contacto.blocker(nombre: "Ana", apellidos: "Ruiz", cedula: "1", celular: "123", email: "")?
            .hasPrefix("Celular no válido") == true)
        #expect(Contacto.blocker(nombre: "Ana", apellidos: "Ruiz", cedula: "1", celular: "0991234567", email: "ana@") != nil)
        #expect(Contacto.blocker(nombre: "Ana", apellidos: "Ruiz", cedula: "1", celular: "0991234567", email: "") == nil)
        #expect(Contacto.blocker(nombre: "Ana", apellidos: "Ruiz", cedula: "1", celular: "0991234567", email: "ana@correo.ec") == nil)
    }
}
