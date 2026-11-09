import Foundation

// MARK: - Próximos controles de los pacientes (PAPER §33)

/// En qué está un control respecto del «hoy» del servidor (fecha de Ecuador).
enum ControlStatus: String, Decodable, Sendable, Hashable {
    case overdue = "atrasado"
    case today = "hoy"
    case upcoming = "proximo"

    /// Un valor que la app no conoce se trata como próximo: la fila se ve igual, sin chip.
    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ControlStatus(rawValue: raw) ?? .upcoming
    }
}

/// Un control de `GET /api/bot/controles`: el próximo control indicado en la consulta más
/// reciente de un paciente (§7 `proximo_control_fecha` / `proximo_control_motivo`).
struct PatientControl: Decodable, Sendable, Hashable, Identifiable {
    let episodeId: String
    let patientId: String?
    let patientName: String?
    let cedula: String?
    /// Día del control, `YYYY-MM-DD`.
    let controlDate: String
    /// Qué hacer en el control.
    let reason: String?
    let plan: String?
    let diagnosis: String?
    /// Día de la consulta que indicó el control.
    let consultationDate: String?
    /// Médico que lo indicó.
    let doctor: String?
    let status: ControlStatus

    var id: String { episodeId }

    enum CodingKeys: String, CodingKey {
        case episodeId = "episode_id"
        case patientId = "patient_id"
        case patientName = "paciente"
        case cedula
        case controlDate = "fecha_control"
        case reason = "motivo"
        case plan
        case diagnosis = "diagnostico"
        case consultationDate = "fecha_consulta"
        case doctor = "medico"
        case status = "estado_control"
    }

    init(
        episodeId: String, patientId: String?, patientName: String?, cedula: String? = nil,
        controlDate: String, reason: String? = nil, plan: String? = nil, diagnosis: String? = nil,
        consultationDate: String? = nil, doctor: String? = nil, status: ControlStatus
    ) {
        self.episodeId = episodeId
        self.patientId = patientId
        self.patientName = patientName
        self.cedula = cedula
        self.controlDate = controlDate
        self.reason = reason
        self.plan = plan
        self.diagnosis = diagnosis
        self.consultationDate = consultationDate
        self.doctor = doctor
        self.status = status
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func text(_ key: CodingKeys) throws -> String? {
            guard let v = try c.decodeIfPresent(String.self, forKey: key)?
                .trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty else { return nil }
            return v
        }
        episodeId = try c.decode(String.self, forKey: .episodeId)
        patientId = try text(.patientId)
        patientName = try text(.patientName)
        cedula = try text(.cedula)
        // Si algún día llega con hora, se queda el día.
        controlDate = String(try c.decode(String.self, forKey: .controlDate).prefix(10))
        reason = try text(.reason)
        plan = try text(.plan)
        diagnosis = try text(.diagnosis)
        consultationDate = try text(.consultationDate).map { String($0.prefix(10)) }
        doctor = try text(.doctor)
        status = try c.decodeIfPresent(ControlStatus.self, forKey: .status) ?? .upcoming
    }
}

/// `GET /api/bot/controles`: los controles del rango, ordenados por fecha, y el «hoy» del
/// servidor, que decide las semanas.
struct ControlList: Decodable, Sendable {
    let today: String?
    let from: String?
    let to: String?
    let data: [PatientControl]

    enum CodingKeys: String, CodingKey { case today, from, to, data }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        today = try c.decodeIfPresent(String.self, forKey: .today).map { String($0.prefix(10)) }
        from = try c.decodeIfPresent(String.self, forKey: .from)
        to = try c.decodeIfPresent(String.self, forKey: .to)
        data = try c.decodeIfPresent([PatientControl].self, forKey: .data) ?? []
    }
}
