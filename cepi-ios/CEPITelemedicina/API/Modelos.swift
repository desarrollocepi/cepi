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

/// Respuestas que solo confirman (`DELETE /api/auth/me` → `{ok: true}`).
struct Confirmacion: Decodable, Sendable {
    let ok: Bool
}

/// Una imagen clínica en la galería: la foto más lo que hace falta para reconocer el caso
/// sin abrirlo (`GET /api/bot/galeria`, PAPER §24.2.1).
struct ImagenGaleria: Decodable, Sendable, Identifiable, Hashable {
    let id: String
    let adjunto: String
    let pacienteId: String?
    let paciente: String?
    let cedula: String?
    let episodioId: String?
    let fecha: String?
    let diagnostico: String?
    let codigoCIE10: String?
    let region: String?

    enum CodingKeys: String, CodingKey {
        case id, paciente, cedula, fecha, diagnostico
        case adjunto = "attachment_id"
        case pacienteId = "patient_id"
        case episodioId = "episode_id"
        case codigoCIE10 = "codigo_cie10"
        case region = "body_region"
    }
}

/// `GET /api/bot/galeria`: la página pedida y cuántas hay en total.
struct RespuestaGaleria: Decodable, Sendable {
    let data: [ImagenGaleria]
    let total: Int?
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
    /// Estado de la consulta más reciente (`en_curso`, `derivada`, `cerrado`…).
    let estado: String?
    /// A quién está derivado el caso ahora; puede ser más de uno.
    let derivados: [DerivadoBreve]

    /// Cómo se resume "a cargo" en la fila: con varios derivados, sus nombres.
    var aCargo: String? {
        guard derivados.count > 1 else { return nombre }
        let nombres = derivados.map(\.nombre)
        return nombres.count > 2 ? "\(nombres.prefix(2).joined(separator: ", ")) +\(nombres.count - 2)" : nombres.joined(separator: ", ")
    }

    enum CodingKeys: String, CodingKey {
        case nombre = "assignee_name"
        case origen = "source"
        case estado, derivados
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        nombre = try c.decodeIfPresent(String.self, forKey: .nombre)
        origen = try c.decodeIfPresent(String.self, forKey: .origen)
        estado = try c.decodeIfPresent(String.self, forKey: .estado)
        derivados = try c.decodeIfPresent([DerivadoBreve].self, forKey: .derivados) ?? []
    }

    init(nombre: String? = nil, origen: String? = nil, estado: String? = nil, derivados: [DerivadoBreve] = []) {
        self.nombre = nombre
        self.origen = origen
        self.estado = estado
        self.derivados = derivados
    }
}

struct DerivadoBreve: Decodable, Sendable, Hashable {
    let id: String
    let nombre: String

    enum CodingKeys: String, CodingKey { case id, nombre = "name" }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        nombre = try c.decodeIfPresent(String.self, forKey: .nombre) ?? ""
    }

    init(id: String, nombre: String) {
        self.id = id
        self.nombre = nombre
    }
}

// MARK: - Hilo y chat

/// Un mensaje del hilo del paciente (`GET /api/patient-thread`): los turnos de todos los
/// profesionales y del asistente, en orden y con su autor.
struct MensajeHilo: Decodable, Sendable, Hashable {
    let rol: String
    let contenido: String
    let autorId: String?
    let autorNombre: String?
    /// Lo escribió quien está usando la app.
    let propio: Bool
    let esBot: Bool
    let ts: String?
    /// La consulta (episodio) del turno; la sella el bot.
    let episodio: String?

    enum CodingKeys: String, CodingKey {
        case rol = "role"
        case contenido = "content"
        case autorId = "author_id"
        case autorNombre = "author_name"
        case propio = "self"
        case esBot = "is_bot"
        case ts
        case episodio = "episode_id"
    }

    init(from decoder: any Decoder) throws {
        let contenedor = try decoder.container(keyedBy: CodingKeys.self)
        rol = try contenedor.decodeIfPresent(String.self, forKey: .rol) ?? "assistant"
        contenido = try contenedor.decodeIfPresent(String.self, forKey: .contenido) ?? ""
        autorId = try contenedor.decodeIfPresent(String.self, forKey: .autorId)
        autorNombre = try contenedor.decodeIfPresent(String.self, forKey: .autorNombre)
        propio = try contenedor.decodeIfPresent(Bool.self, forKey: .propio) ?? false
        esBot = try contenedor.decodeIfPresent(Bool.self, forKey: .esBot) ?? false
        ts = try contenedor.decodeIfPresent(String.self, forKey: .ts)
        episodio = try contenedor.decodeIfPresent(String.self, forKey: .episodio)
    }

    /// Eco de lo que se acaba de enviar, visible mientras el bot responde; la relectura del
    /// hilo lo reemplaza por el turno real. Va en la consulta activa para no desaparecer de la
    /// página que se está mirando.
    init(eco contenido: String, episodio: String?) {
        rol = "user"
        self.contenido = contenido
        autorId = nil
        autorNombre = nil
        propio = true
        esBot = false
        ts = nil
        self.episodio = episodio
    }

    var fecha: Date? { Fechas.iso(ts) }
}

struct HiloRespuesta: Decodable, Sendable {
    let mensajes: [MensajeHilo]

    enum CodingKeys: String, CodingKey {
        case mensajes = "messages"
    }
}

/// Botón que propone el bot: al tocarlo se envía `send` como mensaje.
struct RespuestaRapida: Decodable, Sendable, Hashable {
    let label: String
    let send: String
}

/// Escritura inferida que espera el sí/no del usuario (PAPER §13.3.1).
struct AccionPendiente: Decodable, Sendable, Hashable {
    let summary: String
}

/// `POST /api/bot/chat`. Que una clave no venga no es lo mismo que venga en `null`:
/// `IntakeChat.vue` solo cambia el pendiente o la consulta activa cuando la clave está.
struct RespuestaChat: Decodable, Sendable {
    let sessionId: String?
    let texto: String?
    let respuestasRapidas: [RespuestaRapida]
    let traePendiente: Bool
    let pendiente: AccionPendiente?
    let traeEpisodioActivo: Bool
    let episodioActivo: String?
    /// `form` presente (objeto o `null`) cambia el formulario activo; ausente, lo deja.
    let traeFormulario: Bool
    let formulario: FormularioBot?
    /// Secciones de la ficha; `nil` si no vinieron.
    let marcadores: [Marcador]?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case texto = "text"
        case respuestasRapidas = "quick_replies"
        case pendiente = "pending_action"
        case episodioActivo = "active_episode_id"
        case formulario = "form"
        case marcadores = "bookmarks"
    }

    init(from decoder: any Decoder) throws {
        let contenedor = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try contenedor.decodeIfPresent(String.self, forKey: .sessionId)
        texto = try contenedor.decodeIfPresent(String.self, forKey: .texto)
        respuestasRapidas = try contenedor.decodeIfPresent([RespuestaRapida].self, forKey: .respuestasRapidas) ?? []
        traePendiente = contenedor.contains(.pendiente)
        pendiente = try contenedor.decodeIfPresent(AccionPendiente.self, forKey: .pendiente)
        traeEpisodioActivo = contenedor.contains(.episodioActivo)
        episodioActivo = try contenedor.decodeIfPresent(String.self, forKey: .episodioActivo)
        traeFormulario = contenedor.contains(.formulario)
        formulario = try contenedor.decodeIfPresent(FormularioBot.self, forKey: .formulario)
        marcadores = try contenedor.decodeIfPresent([Marcador].self, forKey: .marcadores)
    }
}

/// `GET /api/bot/sessions`: las sesiones propias con el bot.
struct SesionesBot: Decodable, Sendable {
    let sesiones: [SesionBot]

    enum CodingKeys: String, CodingKey {
        case sesiones = "sessions"
    }
}

struct SesionBot: Decodable, Sendable, Hashable {
    let id: String
    let pacienteActivo: String?
    let estado: String?

    enum CodingKeys: String, CodingKey {
        case id, estado
        case pacienteActivo = "active_patient_id"
    }
}

/// La fila de `attachments` que devuelve `POST /api/attachments` al subir un archivo.
struct Adjunto: Decodable, Sendable, Hashable {
    let id: String
    let nombreOriginal: String?
    let filename: String?

    enum CodingKeys: String, CodingKey {
        case id, filename
        case nombreOriginal = "original_name"
    }

    var nombre: String { nombreOriginal ?? filename ?? "imagen" }
}
