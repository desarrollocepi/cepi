import Foundation

/// Celular y email del paciente (PAPER §36.1). Misma regla que cepi-bot/src/contacto.ts.
enum Contacto {
    static let mobileHint = "Celular de 10 dígitos que empiece con 09 (o con + y el código del país)."

    /// Celular de Ecuador `09XXXXXXXX` o internacional con `+` y 8 a 15 dígitos. Acepta
    /// espacios, guiones y paréntesis. Devuelve el número limpio o nil.
    static func normalizeMobile(_ raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = s.first, first == "+" || first.isNumber else { return nil }
        let allowed = CharacterSet(charactersIn: "+0123456789 ().-")
        guard s.unicodeScalars.dropFirst().allSatisfy({ allowed.contains($0) && $0 != "+" }) else { return nil }
        let digits = s.filter(\.isNumber)
        if s.hasPrefix("+") {
            if digits.hasPrefix("593") {
                let rest = digits.dropFirst(3)
                return digits.count == 12 && rest.first == "9" ? "0" + rest : nil
            }
            return (8...15).contains(digits.count) ? "+" + digits : nil
        }
        if digits.count == 10, digits.hasPrefix("09") { return digits }
        if digits.count == 12, digits.hasPrefix("5939") { return "0" + digits.dropFirst(3) }
        if digits.count == 9, digits.hasPrefix("9") { return "0" + digits }
        return nil
    }

    static func isValidEmail(_ raw: String) -> Bool {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"#, options: .regularExpression) != nil
    }

    /// Por qué «Crear» está gris, o nil si se puede crear.
    static func blocker(nombre: String, apellidos: String, cedula: String, celular: String, email: String) -> String? {
        let t = { (x: String) in x.trimmingCharacters(in: .whitespacesAndNewlines) }
        if [nombre, apellidos, cedula, celular].contains(where: { t($0).isEmpty }) {
            return "Nombre, apellidos, cédula y celular son obligatorios."
        }
        if normalizeMobile(celular) == nil { return "Celular no válido. " + mobileHint }
        if !t(email).isEmpty && !isValidEmail(email) { return "Email no válido (o déjalo vacío)." }
        return nil
    }
}
