import SwiftUI

/// El estado de la consulta más reciente del paciente (`estado` del episodio, que manda
/// `GET /api/patient-assignments`). El orden de los casos es el de la lista: del más avanzado
/// en el circuito de telemedicina al menos avanzado, y al final lo cerrado y lo que no tiene
/// consulta (PAPER §24.2.1). `color` es el del LED de la fila, igual en Android (`EstadoFicha.kt`).
enum EstadoFicha: Int, CaseIterable, Identifiable, Sendable {
    case respondida
    case revisionSolicitada
    case derivada
    case enTriaje
    case enviada
    case enCurso
    case agendada
    case cerrada
    /// Un valor que la app no conoce: se muestra, al final de los abiertos, sin inventarle sentido.
    case otro
    /// El paciente no tiene consulta en la org activa: el LED va hueco.
    case sinConsulta

    init(_ valor: String?) {
        guard let valor, !valor.trimmingCharacters(in: .whitespaces).isEmpty else {
            self = .sinConsulta
            return
        }
        self = Self.allCases.first { $0.valor == valor } ?? .otro
    }

    var id: Int { rawValue }

    /// El valor de `entity_episode.estado`. Los dos últimos no vienen del backend.
    var valor: String? {
        switch self {
        case .respondida: "respondida"
        case .revisionSolicitada: "en_revisión_solicitada"
        case .derivada: "derivada"
        case .enTriaje: "en_triage"
        case .enviada: "enviada"
        case .enCurso: "en_curso"
        case .agendada: "agendado"
        case .cerrada: "cerrado"
        case .otro, .sinConsulta: nil
        }
    }

    var etiqueta: String {
        switch self {
        case .respondida: "Respondida"
        case .revisionSolicitada: "Revisión solicitada"
        case .derivada: "Derivada"
        case .enTriaje: "En triaje"
        case .enviada: "Enviada al turno"
        case .enCurso: "En curso"
        case .agendada: "Agendada"
        case .cerrada: "Cerrada"
        case .otro: "Otro estado"
        case .sinConsulta: "Sin consulta"
        }
    }

    var color: Color {
        switch self {
        case .respondida: Self.rgb(0x16A34A)
        case .revisionSolicitada: Self.rgb(0xDC2626)
        case .derivada: Self.rgb(0xF59E0B)
        case .enTriaje: Self.rgb(0x06B6D4)
        case .enviada: Self.rgb(0x8B5CF6)
        case .enCurso: Self.rgb(0x2563EB)
        case .agendada: Self.rgb(0x64748B)
        case .cerrada, .sinConsulta: Self.rgb(0x9CA3AF)
        case .otro: Self.rgb(0x6B7280)
        }
    }

    private static func rgb(_ hex: UInt32) -> Color {
        Color(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
