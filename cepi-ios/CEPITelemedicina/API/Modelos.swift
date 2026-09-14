import Foundation

/// Valor JSON sin esquema fijo. Los `data` de las entidades del ERP salen de
/// `entity_definitions` y cambian con un seed, sin pasar por la app.
enum JSONValor: Codable, Sendable, Hashable {
    case texto(String)
    case numero(Double)
    case booleano(Bool)
    case objeto([String: JSONValor])
    case lista([JSONValor])
    case nulo

    init(from decoder: any Decoder) throws {
        let contenedor = try decoder.singleValueContainer()
        // Número antes que booleano: hay decodificadores que leen `1` como `true`, pero
        // ninguno lee `true` como número.
        if let valor = try? contenedor.decode(String.self) {
            self = .texto(valor)
        } else if let valor = try? contenedor.decode(Double.self) {
            self = .numero(valor)
        } else if let valor = try? contenedor.decode(Bool.self) {
            self = .booleano(valor)
        } else if let valor = try? contenedor.decode([String: JSONValor].self) {
            self = .objeto(valor)
        } else if let valor = try? contenedor.decode([JSONValor].self) {
            self = .lista(valor)
        } else {
            self = .nulo
        }
    }

    func encode(to encoder: any Encoder) throws {
        var contenedor = encoder.singleValueContainer()
        switch self {
        case .texto(let valor): try contenedor.encode(valor)
        case .numero(let valor): try contenedor.encode(valor)
        case .booleano(let valor): try contenedor.encode(valor)
        case .objeto(let valor): try contenedor.encode(valor)
        case .lista(let valor): try contenedor.encode(valor)
        case .nulo: try contenedor.encodeNil()
        }
    }

    /// El valor como texto para mostrar. Un entero sale sin decimales: una cédula guardada
    /// como número no debe verse "1712345678.0".
    var texto: String? {
        switch self {
        case .texto(let valor):
            return valor
        case .numero(let valor):
            return valor.rounded() == valor && abs(valor) < 1e15 ? String(Int64(valor)) : String(valor)
        case .booleano(let valor):
            return valor ? "sí" : "no"
        case .objeto, .lista, .nulo:
            return nil
        }
    }
}

/// Un registro del ERP (`/api/entities`). Solo `id` es fijo; lo clínico va en `data`.
struct Registro: Decodable, Identifiable, Sendable, Hashable {
    let id: String
    let title: String?
    /// `entity_id`: de qué `entity_definition` es (paciente, episodio…).
    let definicion: String?
    let data: [String: JSONValor]

    enum CodingKeys: String, CodingKey {
        case id, title, data
        case definicion = "entity_id"
    }

    init(from decoder: any Decoder) throws {
        let contenedor = try decoder.container(keyedBy: CodingKeys.self)
        id = try contenedor.decode(String.self, forKey: .id)
        title = try contenedor.decodeIfPresent(String.self, forKey: .title)
        definicion = try contenedor.decodeIfPresent(String.self, forKey: .definicion)
        data = try contenedor.decodeIfPresent([String: JSONValor].self, forKey: .data) ?? [:]
    }

    /// Un campo de `data` como texto; `nil` si falta o está vacío.
    subscript(campo: String) -> String? {
        guard let valor = data[campo]?.texto?.trimmingCharacters(in: .whitespacesAndNewlines),
              !valor.isEmpty else { return nil }
        return valor
    }
}

struct Organizacion: Decodable, Identifiable, Sendable, Hashable {
    let id: String
    let name: String
}

struct Usuario: Decodable, Sendable, Equatable {
    let id: String
    let name: String?
    let email: String
    let role: String?
    let permissions: [String]
    let orgActiva: String?
    let orgs: [Organizacion]

    enum CodingKeys: String, CodingKey {
        case id, name, email, role, permissions, orgs
        case orgActiva = "org_id"
    }

    // `/login` puede no traer `orgs` ni `org_id` (AuthResponse los declara opcionales).
    init(from decoder: any Decoder) throws {
        let contenedor = try decoder.container(keyedBy: CodingKeys.self)
        id = try contenedor.decode(String.self, forKey: .id)
        name = try contenedor.decodeIfPresent(String.self, forKey: .name)
        email = try contenedor.decode(String.self, forKey: .email)
        role = try contenedor.decodeIfPresent(String.self, forKey: .role)
        permissions = try contenedor.decodeIfPresent([String].self, forKey: .permissions) ?? []
        orgActiva = try contenedor.decodeIfPresent(String.self, forKey: .orgActiva)
        orgs = try contenedor.decodeIfPresent([Organizacion].self, forKey: .orgs) ?? []
    }
}

/// `POST /api/auth/login` y `GET /api/auth/me`: el token (re)emitido y el usuario.
struct SesionRespuesta: Decodable, Sendable {
    let token: String
    let user: Usuario
}

/// Respuestas que solo reemiten el token (`POST /api/orgs/switch`).
struct TokenRespuesta: Decodable, Sendable {
    let token: String?
}

/// `{ ok, data: [...] }`
struct Lista<Elemento: Decodable & Sendable>: Decodable, Sendable {
    let data: [Elemento]
}

/// `{ ok, data: {...} }`
struct Uno<Elemento: Decodable & Sendable>: Decodable, Sendable {
    let data: Elemento
}

/// `GET /api/review-queue`: pacientes con derivaciones pendientes para quien consulta.
struct ColaRevision: Decodable, Sendable {
    let porPaciente: [String: PendienteRevision]

    enum CodingKeys: String, CodingKey {
        case porPaciente = "by_patient"
    }
}

struct PendienteRevision: Decodable, Sendable, Hashable {
    let pendientes: Int
    /// ISO 8601; el que vence antes va primero en la lista.
    let vence: String?

    enum CodingKeys: String, CodingKey {
        case pendientes = "pending"
        case vence = "earliest_due"
    }
}

/// `GET /api/patient-assignments`: quién tiene a cargo a cada paciente.
struct Asignaciones: Decodable, Sendable {
    let porPaciente: [String: Asignacion]

    enum CodingKeys: String, CodingKey {
        case porPaciente = "assignments"
    }
}

struct Asignacion: Decodable, Sendable, Hashable {
    let nombre: String?
    /// `responsable` | `derivado` | `derivado_grupo` | `creador`
    let origen: String?

    enum CodingKeys: String, CodingKey {
        case nombre = "assignee_name"
        case origen = "source"
    }
}
