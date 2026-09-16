import Foundation

/// Los endpoints que usa la app, con tipos. Contrato completo en PAPER §24.4.
struct CEPIAPI: Sendable {
    static let definicionPaciente = "11000000-0000-0000-0000-000000000000"
    static let definicionEpisodio = "12000000-0000-0000-0000-000000000000"

    let cliente: APIClient

    // MARK: Sesión

    func login(email: String, password: String) async throws -> SesionRespuesta {
        try await cliente.post("/api/auth/login", json: ["email": email, "password": password])
    }

    func yo() async throws -> SesionRespuesta {
        try await cliente.get("/api/auth/me")
    }

    func cambiarOrganizacion(_ id: String) async throws -> TokenRespuesta {
        try await cliente.post("/api/orgs/switch", json: ["org_id": id])
    }

    // MARK: Pacientes

    /// Todos de una vez, como `listPatients` en la web: 500 filas son pocas para una `List`
    /// y así la búsqueda es local e instantánea. La PII llega redactada según el rol.
    func pacientes(limite: Int = 500) async throws -> [Registro] {
        let lista: Lista<Registro> = try await cliente.get("/api/entities", query: [
            URLQueryItem(name: "type", value: "business"),
            URLQueryItem(name: "entity_id", value: Self.definicionPaciente),
            URLQueryItem(name: "limit", value: String(limite)),
        ])
        return lista.data
    }

    /// Alta mínima; `title` = "Nombre Apellidos" para que sea ubicable por nombre en el ERP.
    func crearPaciente(nombre: String, apellidos: String, cedula: String) async throws -> Registro {
        let alta = AltaRegistro(
            definicion: Self.definicionPaciente,
            title: "\(nombre) \(apellidos)".trimmingCharacters(in: .whitespaces),
            data: ["nombre": nombre, "apellidos": apellidos, "cedula": cedula]
        )
        let creado: Uno<Registro> = try await cliente.post("/api/entities", json: alta)
        return creado.data
    }

    func colaRevision() async throws -> [String: PendienteRevision] {
        let cola: ColaRevision = try await cliente.get("/api/review-queue")
        return cola.porPaciente
    }

    func asignaciones() async throws -> [String: Asignacion] {
        let respuesta: Asignaciones = try await cliente.get("/api/patient-assignments")
        return respuesta.porPaciente
    }

    // MARK: Hilo y chat

    /// El hilo del paciente: los mensajes de todos los profesionales y del bot, en orden.
    func hilo(paciente: String) async throws -> [MensajeHilo] {
        let respuesta: HiloRespuesta = try await cliente.get("/api/patient-thread", query: [
            URLQueryItem(name: "patient_id", value: paciente),
        ])
        return respuesta.mensajes
    }

    func sesionesBot(paciente: String) async throws -> [SesionBot] {
        let respuesta: SesionesBot = try await cliente.get("/api/bot/sessions", query: [
            URLQueryItem(name: "patient_id", value: paciente),
        ])
        return respuesta.sesiones
    }

    func chat(_ mensaje: String, sesion: String?) async throws -> RespuestaChat {
        try await cliente.post("/api/bot/chat", json: TurnoChat(message: mensaje, sessionId: sesion, formulario: nil))
    }

    /// Un envío estructurado (`ficha_grp_*`, `ficha_goto`, `ficha_save`): no lleva texto, es la
    /// acción explícita del usuario y el bot la guarda sin pedir sí/no.
    func enviarFormulario(
        _ formId: String, datos: [String: JSONValor], sesion: String?, episodio: String? = nil
    ) async throws -> RespuestaChat {
        let envio = EnvioFormulario(formId: formId, data: datos, episodeId: episodio)
        return try await cliente.post("/api/bot/chat", json: TurnoChat(message: "", sessionId: sesion, formulario: envio))
    }

    // MARK: Derivar

    func grupos() async throws -> [GrupoDerivacion] {
        let lista: Lista<GrupoDerivacion> = try await cliente.get("/api/groups")
        return lista.data
    }

    func miembros(grupo slug: String) async throws -> [MiembroGrupo] {
        let lista: Lista<MiembroGrupo> = try await cliente.get("/api/groups/\(slug)/members")
        return lista.data
    }

    // MARK: Registros

    func entidad(_ id: String) async throws -> Registro {
        let uno: Uno<Registro> = try await cliente.get("/api/entities/\(id)")
        return uno.data
    }

    /// Las consultas del paciente, de la más nueva a la más vieja.
    func episodios(paciente: String) async throws -> [Registro] {
        let lista: Lista<Registro> = try await cliente.get("/api/entities", query: [
            URLQueryItem(name: "type", value: "business"),
            URLQueryItem(name: "entity_id", value: Self.definicionEpisodio),
            URLQueryItem(name: "limit", value: "100"),
            URLQueryItem(name: "filter[patient_id]", value: paciente),
        ])
        return lista.data.sorted { ($0["fecha"] ?? "") > ($1["fecha"] ?? "") }
    }

    /// Búsqueda de texto en una definición, paginada (campo `entity_search`).
    func buscar(definicion: String, texto: String, desde: Int, limite: Int) async throws -> [Registro] {
        let lista: Lista<Registro> = try await cliente.get("/api/entities", query: [
            URLQueryItem(name: "type", value: "business"),
            URLQueryItem(name: "entity_id", value: definicion),
            URLQueryItem(name: "q", value: texto),
            URLQueryItem(name: "limit", value: String(limite)),
            URLQueryItem(name: "offset", value: String(desde)),
        ])
        return lista.data
    }

    func buscarCIE10(_ texto: String) async throws -> [ResultadoCIE] {
        let respuesta: BusquedaCIE = try await cliente.get("/api/icd10/search", query: [
            URLQueryItem(name: "q", value: texto),
        ])
        return respuesta.results
    }

    func subirImagen(_ jpeg: Data, nombre: String) async throws -> Adjunto {
        try await cliente.subir("/api/attachments", archivo: jpeg, nombre: nombre, mime: "image/jpeg")
    }

    func archivo(adjunto id: String) async throws -> Data {
        try await cliente.datos("/api/attachments/\(id)/file")
    }
}

private struct TurnoChat: Encodable, Sendable {
    let message: String
    let sessionId: String?
    let formulario: EnvioFormulario?

    enum CodingKeys: String, CodingKey {
        case message
        case sessionId = "session_id"
        case formulario = "form_submission"
    }
}

private struct EnvioFormulario: Encodable, Sendable {
    let formId: String
    let data: [String: JSONValor]
    let episodeId: String?

    enum CodingKeys: String, CodingKey {
        case data
        case formId = "form_id"
        case episodeId = "episode_id"
    }
}

private struct AltaRegistro: Encodable, Sendable {
    let definicion: String
    let title: String
    let data: [String: String]

    enum CodingKeys: String, CodingKey {
        case recordType = "record_type"
        case definicion = "entity_id"
        case title, data, active
    }

    func encode(to encoder: any Encoder) throws {
        var contenedor = encoder.container(keyedBy: CodingKeys.self)
        try contenedor.encode("business", forKey: .recordType)
        try contenedor.encode(definicion, forKey: .definicion)
        try contenedor.encode(title, forKey: .title)
        try contenedor.encode(data, forKey: .data)
        try contenedor.encode(true, forKey: .active)
    }
}
