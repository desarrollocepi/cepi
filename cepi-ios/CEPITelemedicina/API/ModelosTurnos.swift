import Foundation

// MARK: - Turnos de un grupo (PAPER §32)

/// Un turno de `GET /api/groups/:slug/shifts`: quién cubre el grupo entre dos fechas, ambas
/// incluidas. Las fechas son días `YYYY-MM-DD`, sin hora.
struct Shift: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    let userId: String
    let userName: String?
    let startsOn: String
    let endsOn: String
    let createdBy: String?
    let createdAt: String?

    /// Lo que se muestra: el nombre, o un genérico si el backend no lo mandó.
    var displayName: String { userName ?? "Sin nombre" }

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case userName = "user_name"
        case startsOn = "starts_on"
        case endsOn = "ends_on"
        case createdBy = "created_by"
        case createdAt = "created_at"
    }

    init(
        id: String, userId: String, userName: String?, startsOn: String, endsOn: String,
        createdBy: String? = nil, createdAt: String? = nil
    ) {
        self.id = id
        self.userId = userId
        self.userName = userName
        self.startsOn = startsOn
        self.endsOn = endsOn
        self.createdBy = createdBy
        self.createdAt = createdAt
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        userId = try c.decode(String.self, forKey: .userId)
        userName = try c.decodeIfPresent(String.self, forKey: .userName)
        // Si algún día llega con hora («2026-11-09T00:00:00.000Z»), se queda el día.
        startsOn = String(try c.decode(String.self, forKey: .startsOn).prefix(10))
        endsOn = String(try c.decode(String.self, forKey: .endsOn).prefix(10))
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

/// `GET /api/groups/:slug/shifts?from=&to=`: los turnos que tocan el rango y el «hoy» del
/// servidor (zona `SHIFTS_TIMEZONE`, Ecuador por defecto).
struct ShiftList: Decodable, Sendable {
    let data: [Shift]
    let from: String?
    let to: String?
    let today: String?

    enum CodingKeys: String, CodingKey { case data, from, to, today }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        data = try c.decodeIfPresent([Shift].self, forKey: .data) ?? []
        from = try c.decodeIfPresent(String.self, forKey: .from)
        to = try c.decodeIfPresent(String.self, forKey: .to)
        today = try c.decodeIfPresent(String.self, forKey: .today).map { String($0.prefix(10)) }
    }
}

/// Cuerpo de `POST /api/groups/:slug/shifts`.
struct ShiftCreate: Encodable, Sendable, Equatable {
    let userId: String
    let startsOn: String
    let endsOn: String

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case startsOn = "starts_on"
        case endsOn = "ends_on"
    }
}
