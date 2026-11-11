import Foundation
import Testing
@testable import CEPITelemedicina

/// Las formas JSON que devuelve el backend hoy (PAPER §24.4). Si el backend cambia una
/// clave, falla acá y no en la mano de un médico.
struct ContratoTests {
    private func decodificar<T: Decodable>(_ tipo: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(tipo, from: Data(json.utf8))
    }

    @Test func fichaDeEvolucion() throws {
        // GET /api/patient-evolution (PAPER §28). Las claves de especialista, histopatología y
        // observaciones son nuevas: ContratoTest.kt de Android todavía no las trae.
        var filas = try decodificar(Lista<FilaEvolucion>.self, """
        {"ok":true,"data":[
           {"episode_id":"e3","fecha":"2026-11-02","estado":"respondida","medico":"Dra. Ana Pérez",
            "especialista":"Dr. Luis Mora","diagnostico":"L43.9 — Liquen plano",
            "diagnostico_histopatologico":"Dermatitis liquenoide","tratamiento":"Tacrolimus 0,1 %",
            "observaciones":"Control en 4 semanas"},
           {"episode_id":"e2","fecha":"2026-10-01","estado":"cerrado","medico":"Dra. Ana Pérez",
            "especialista":null,"diagnostico":"L40.0 — Psoriasis vulgar",
            "diagnostico_histopatologico":null,"tratamiento":"Clobetasol 0,05 %","observaciones":null},
           {"episode_id":"e1","fecha":"2026-08-15","estado":"en_curso","medico":null,
            "diagnostico":null,"tratamiento":null}]}
        """).data
        #expect(filas.map(\.episodio) == ["e3", "e2", "e1"])
        #expect(filas[0].especialista == "Dr. Luis Mora")
        #expect(filas[0].diagnosticoHistopatologico == "Dermatitis liquenoide")
        #expect(filas[0].observaciones == "Control en 4 semanas")
        // Con las claves nuevas en null y sin ellas (backend anterior) da lo mismo.
        #expect(filas[1].especialista == nil)
        #expect(filas[1].diagnosticoHistopatologico == nil)
        #expect(filas[1].observaciones == nil)
        #expect(filas[2].especialista == nil)
        #expect(filas[2].observaciones == nil)
        filas.removeFirst()
        #expect(filas[0].fecha == "2026-10-01")
        #expect(filas[0].medico == "Dra. Ana Pérez")
        #expect(filas[0].diagnostico == "L40.0 — Psoriasis vulgar")
        #expect(filas[0].tratamiento == "Clobetasol 0,05 %")
        #expect(filas[1].diagnostico == nil)
        #expect(filas[1].medico == nil)
    }

    @Test func evolucionesDeUnaFicha() throws {
        // GET /api/patient-evolution con los campos de PAPER §28.4: una fila por evolución
        // registrada; la ficha sin evoluciones da una fila armada con evolution_id null.
        let filas = try decodificar(Lista<FilaEvolucion>.self, """
        {"ok":true,"data":[
           {"episode_id":"e2","evolution_id":"v2","motivo":"Placas en codos","estado":"en_curso",
            "es_inicial":false,"fecha":"2026-11-09","medico":"Dra. Ana Pérez","especialista":null,
            "diagnostico":"L40.0 — Psoriasis","histopatologico":"Psoriasis vulgar",
            "tratamiento":"Calcipotriol","observaciones":"Mejor","hallazgos":"Placas más finas",
            "proximo_control_fecha":"2026-12-09","proximo_control_motivo":"Control de respuesta"},
           {"episode_id":"e2","evolution_id":"v1","motivo":"Placas en codos","estado":"en_curso",
            "es_inicial":true,"fecha":"2026-10-01","medico":"Dra. Ana Pérez","especialista":"Dr. Luis Mora",
            "diagnostico":"L40.0 — Psoriasis","histopatologico":null,"tratamiento":"Clobetasol 0,05 %",
            "observaciones":null,"hallazgos":null,"proximo_control_fecha":null,"proximo_control_motivo":null},
           {"episode_id":"e1","evolution_id":null,"motivo":"Lunar","estado":"alta","es_inicial":false,
            "fecha":"2026-06-10","medico":"Dr. Ruiz","especialista":null,"diagnostico":null,
            "histopatologico":null,"tratamiento":null,"observaciones":null,"hallazgos":null,
            "proximo_control_fecha":null,"proximo_control_motivo":null}]}
        """).data
        #expect(filas.map(\.id) == ["v2", "v1", "episode:e1"])
        #expect(filas[0].evolutionId == "v2")
        #expect(filas[0].motivo == "Placas en codos")
        #expect(filas[0].estado == "en_curso")
        #expect(!filas[0].esInicial)
        #expect(filas[0].hallazgos == "Placas más finas")
        #expect(filas[0].diagnosticoHistopatologico == "Psoriasis vulgar")
        #expect(filas[0].proximoControlFecha == "2026-12-09")
        #expect(filas[0].proximoControlMotivo == "Control de respuesta")
        #expect(filas[1].esInicial)
        #expect(filas[1].especialista == "Dr. Luis Mora")
        #expect(filas[2].evolutionId == nil)
        #expect(filas[2].isAssembled)
        #expect(filas[2].estado == "alta")
        // El backend de §28.1 (sin los campos nuevos) se lee como la fila armada de cada ficha.
        let vieja = try decodificar(FilaEvolucion.self, #"{"episode_id":"e3","fecha":"2026-01-01"}"#)
        #expect(vieja.isAssembled)
        #expect(!vieja.esInicial)
        #expect(vieja.motivo == nil)
    }

    @Test func cuerpoDeAgregarEvolucion() throws {
        // POST /api/bot/episodio/evolucion (PAPER §28.4): lo vacío no viaja.
        let cuerpo = try JSONEncoder().encode(EvolutionCreate(
            episodeId: "e2", fecha: "2026-11-09", hallazgos: " Placas más finas ", diagnostico: "L40.0 — Psoriasis",
            tratamiento: "", observaciones: "Mejor", proximoControlFecha: "2026-12-09",
            proximoControlMotivo: "Control de respuesta"
        ))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(Set(json.keys) == ["episode_id", "fecha", "hallazgos", "diagnostico", "observaciones",
                                   "proximo_control_fecha", "proximo_control_motivo"])
        #expect(json["episode_id"] as? String == "e2")
        #expect(json["fecha"] as? String == "2026-11-09")
        #expect(json["hallazgos"] as? String == "Placas más finas")
        #expect(json["proximo_control_fecha"] as? String == "2026-12-09")
        #expect(json["proximo_control_motivo"] as? String == "Control de respuesta")
        let minimo = try JSONEncoder().encode(EvolutionCreate(episodeId: "e2", fecha: nil, observaciones: "Solo esto"))
        let jsonMinimo = try #require(try JSONSerialization.jsonObject(with: minimo) as? [String: Any])
        #expect(Set(jsonMinimo.keys) == ["episode_id", "observaciones"])

        let respuesta = try decodificar(EvolutionCreateResult.self, #"{"ok":true,"evolution_id":"v9"}"#)
        #expect(respuesta.ok)
        #expect(respuesta.evolutionId == "v9")
    }

    @Test func cuerpoDeEditarEvolucion() throws {
        // POST /api/bot/evolucion/editar (PAPER §28.4).
        let cuerpo = try JSONEncoder().encode(EvolutionEdit(evolutionId: "v2", observaciones: "Resumen"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: String])
        #expect(json == ["evolution_id": "v2", "observaciones": "Resumen"])
    }

    @Test func cuerpoDeGuardarObservaciones() throws {
        // POST /api/bot/ficha/grupo desde la sección Evolución (PAPER §28.3).
        let cuerpo = try JSONEncoder().encode(ObservationsSave(episodio: "e2", paciente: "p1", texto: "Línea 1\n\"citada\""))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(Set(json.keys) == ["group_id", "data", "episode_id", "patient_id"])
        #expect(json["group_id"] as? String == "g_7")
        #expect(json["episode_id"] as? String == "e2")
        #expect(json["patient_id"] as? String == "p1")
        #expect(json["data"] as? [String: String] == ["observaciones": "Línea 1\n\"citada\""])
    }

    @Test func sesionDeMe() throws {
        let respuesta = try decodificar(SesionRespuesta.self, """
        {"ok":true,"token":"abc","user":{"id":"u1","name":"Dra. Pérez","email":"p@cepi.ec",
         "role":"medico_primario","phone":"","cedula":"","permissions":["entity:x:record:create"],
         "org_id":"o2","orgs":[{"id":"o1","slug":"cepi","name":"CEPI","role_in_org":"member"},
         {"id":"o2","slug":"cepi-testing","name":"CEPI Testing","role_in_org":"member"}]}}
        """)
        #expect(respuesta.token == "abc")
        #expect(respuesta.user.orgActiva == "o2")
        #expect(respuesta.user.orgs.map(\.name) == ["CEPI", "CEPI Testing"])
        #expect(respuesta.user.permissions == ["entity:x:record:create"])
    }

    /// `/me` de una cuenta pendiente en telemedicina y aprobada en otras (backend 2026-11-11):
    /// la pantalla de «pendiente» ofrece entrar solo a las reales donde tiene rol.
    @Test func pendienteConRolEnOtraOrg() throws {
        let respuesta = try decodificar(SesionRespuesta.self, """
        {"ok":true,"token":"abc","user":{"id":"u1","name":"Dr. X","email":"x@cepi.ec","role":"pendiente",
         "permissions":["chat:bot"],"org_id":"tele","orgs":[
         {"id":"tele","slug":"cepi","name":"CEPI Telemedicina","role_in_org":"member","features":[],"sandbox":false,"approved":false},
         {"id":"cons","slug":"cepi-drpro","name":"Consultorio","role_in_org":"member","features":[],"sandbox":false,"approved":true},
         {"id":"test","slug":"cepi-testing","name":"Testing","role_in_org":"member","features":[],"sandbox":true,"approved":true}]}}
        """)
        #expect(respuesta.user.otrasOrgsAprobadas.map(\.id) == ["cons"])
        // Un backend viejo no manda `approved`: no se ofrece nada.
        let viejo = try decodificar(SesionRespuesta.self, """
        {"ok":true,"token":"t","user":{"id":"u","name":"X","email":"x@cepi.ec","role":"pendiente","permissions":[],
         "org_id":"o1","orgs":[{"id":"o1","slug":"cepi","name":"CEPI"},{"id":"o2","slug":"cepi-drpro","name":"C"}]}}
        """)
        #expect(viejo.user.otrasOrgsAprobadas.isEmpty)
    }

    @Test func loginSinOrganizaciones() throws {
        let respuesta = try decodificar(SesionRespuesta.self, """
        {"ok":true,"token":"t","user":{"id":"u","name":"X","email":"x@cepi.ec","role":"pendiente","permissions":[]}}
        """)
        #expect(respuesta.user.orgs.isEmpty)
        #expect(respuesta.user.orgActiva == nil)
        #expect(respuesta.user.role == "pendiente")
    }

    /// `DELETE /api/auth/me {"confirm":true}`, capturado del backend local. Los rechazos
    /// (`{ok:false, error}`) los prueba `SesionTests` con el servidor falso.
    @Test func borradoDeCuenta() throws {
        let respuesta = try decodificar(Confirmacion.self, #"{"ok":true}"#)
        #expect(respuesta.ok)
    }

    @Test func registroConCamposDinamicos() throws {
        let lista = try decodificar(Lista<Registro>.self, """
        {"ok":true,"data":[{"id":"p1","title":"Ana Ruiz","entity_id":"11000000-0000-0000-0000-000000000000",
          "data":{"nombre":"Ana","apellidos":" Ruiz ","cedula":1712345678,"alergias":null,
                  "fumador":true,"peso":61.5,"regiones":["torax"],"vacio":""}}]}
        """)
        let paciente = try #require(lista.data.first)
        #expect(paciente.definicion == CEPIAPI.definicionPaciente)
        #expect(paciente["nombre"] == "Ana")
        #expect(paciente["apellidos"] == "Ruiz")
        #expect(paciente["cedula"] == "1712345678")
        #expect(paciente["peso"] == "61.5")
        #expect(paciente["alergias"] == nil)
        #expect(paciente["vacio"] == nil)
        #expect(paciente.data["fumador"] == .booleano(true))
        #expect(paciente.data["regiones"] == .lista([.texto("torax")]))
    }

    @Test func registroSinData() throws {
        let registro = try decodificar(Registro.self, #"{"id":"r1","title":null}"#)
        #expect(registro.data.isEmpty)
        #expect(registro.title == nil)
    }

    @Test func colaDeRevisionYAsignaciones() throws {
        let cola = try decodificar(ColaRevision.self, """
        {"ok":true,"patient_ids":["p1"],"by_patient":{"p1":{"pending":2,"earliest_due":"2026-09-15T10:00:00.000Z"}}}
        """)
        #expect(cola.porPaciente["p1"]?.pendientes == 2)

        let asignaciones = try decodificar(Asignaciones.self, """
        {"ok":true,"assignments":{"p1":{"assignee_id":"u9","assignee_name":"Dr. Mora","source":"derivado_grupo","estado":"derivada"}}}
        """)
        #expect(asignaciones.porPaciente["p1"]?.nombre == "Dr. Mora")
        #expect(asignaciones.porPaciente["p1"]?.origen == "derivado_grupo")
        #expect(asignaciones.porPaciente["p1"]?.estado == "derivada")
        // Sin `prioridad` (backend anterior o consulta sin clasificar): no hay chip.
        #expect(asignaciones.porPaciente["p1"]?.prioridad == nil)

        // PAPER §34: la prioridad clínica de la consulta alimenta el chip de la fila.
        let conPrioridad = try decodificar(Asignaciones.self, """
        {"ok":true,"assignments":{"p1":{"assignee_id":"u9","assignee_name":"Dr. Mora","source":"responsable",
         "estado":"en_curso","prioridad":"Urgente","derivados":[]},
         "p2":{"assignee_name":"Dra. Paz","estado":"en_curso","prioridad":null},
         "p3":{"estado":"en_curso","prioridad":"Programada"}}}
        """)
        #expect(conPrioridad.porPaciente["p1"]?.prioridad == "Urgente")
        #expect(conPrioridad.porPaciente["p1"]?.prioridadClinica == .urgent)
        #expect(conPrioridad.porPaciente["p2"]?.prioridadClinica == nil)
        #expect(conPrioridad.porPaciente["p3"]?.prioridadClinica == .scheduled)
        #expect(Asignacion(prioridad: "BLINK").prioridadClinica == nil)

        // Derivado a varios: la fila resume los nombres en vez del único "a cargo".
        let varios = try decodificar(Asignaciones.self, """
        {"ok":true,"assignments":{"p1":{"assignee_name":"Dr. Mora","source":"derivado","estado":"derivada",
         "derivados":[{"id":"u1","name":"Dra. Ramon"},{"id":"u2","name":"Dr. Mora"},{"id":"u3","name":"Dra. Paz"}]}}}
        """)
        #expect(varios.porPaciente["p1"]?.aCargo == "Dra. Ramon, Dr. Mora +1")

        // PAPER §35: la fecha del alta; sin la clave (backend anterior) queda nil.
        let conAlta = try decodificar(Asignaciones.self, """
        {"ok":true,"assignments":{"p1":{"estado":"alta","alta_at":"2026-11-09","prioridad":null},
         "p2":{"estado":"en_curso","alta_at":null}}}
        """)
        #expect(conAlta.porPaciente["p1"]?.dischargedOn == "2026-11-09")
        #expect(conAlta.porPaciente["p2"]?.dischargedOn == nil)
        #expect(asignaciones.porPaciente["p1"]?.dischargedOn == nil)

        let derivaciones = try decodificar(Derivaciones.self, """
        {"ok":true,"entity_id":"e1","derivados":[{"user_id":"u1","name":"Dra. Ramon","email":"r@cepi.ec"}]}
        """)
        #expect(derivaciones.derivados.first?.comoSeLlama == "Dra. Ramon")
    }

    @Test func urlCodificaElMas() {
        let url = APIClient.url(
            base: URL(string: "https://telemedicina.cepi.ec")!,
            ruta: "/api/entities",
            query: [
                URLQueryItem(name: "q", value: "a+b ñ"),
                URLQueryItem(name: "filter[patient_id]", value: "p1"),
            ]
        )
        #expect(url.absoluteString.hasPrefix("https://telemedicina.cepi.ec/api/entities?"))
        #expect(url.query(percentEncoded: true)?.contains("q=a%2Bb%20%C3%B1") == true)
        #expect(url.query(percentEncoded: false)?.contains("filter[patient_id]=p1") == true)
    }
}

/// Guardar observaciones contra un bot falso: el cuerpo que sale y el error que vuelve.
struct GuardarObservacionesTests {
    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, baseBot: base, credenciales: credenciales, configuracion: red))
    }

    @Test func guardaEnElGrupoSieteDelBot() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("POST /api/bot/ficha/grupo", .http(200, #"{"ok":true,"target":"episode","targetId":"e2","completitud":80}"#))
        try await api(servidor).saveObservations(episodio: "e2", paciente: "p1", texto: "Control en 4 semanas")
        let cuerpo = try #require(servidor.cuerpo(de: "POST /api/bot/ficha/grupo"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(json["group_id"] as? String == "g_7")
        #expect(json["data"] as? [String: String] == ["observaciones": "Control en 4 semanas"])
    }

    @Test func unFalloTraeElMensajeDelBot() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("POST /api/bot/ficha/grupo", .http(400, #"{"ok":false,"error":"campo desconocido"}"#))
        do {
            try await api(servidor).saveObservations(episodio: "e2", paciente: "p1", texto: "x")
            Issue.record("debía fallar")
        } catch {
            #expect((error as? APIError)?.status == 400)
            #expect(error.localizedDescription == "campo desconocido")
        }
    }
}

/// «Responder interconsulta» (PAPER §30): el cuerpo, la respuesta del bot y cuándo se puede.
struct ResponderInterconsultaTests {
    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, baseBot: base, credenciales: credenciales, configuracion: red))
    }

    private func episodio(_ data: String) throws -> Registro {
        try JSONDecoder().decode(Registro.self, from: Data(#"{"id":"e1","data":\#(data)}"#.utf8))
    }

    @Test func cuerpoDelPedido() throws {
        let cuerpo = try JSONEncoder().encode(InterconsultaAnswer(
            episodio: "e1", recomendacion: "  Biopsia por punch\n", diagnostico: "D22.5 — Nevus atípico",
            tratamiento: "", observaciones: "Control en 3 meses",
        ))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: String])
        #expect(json == [
            "episode_id": "e1", "recomendacion": "Biopsia por punch", "diagnostico": "D22.5 — Nevus atípico",
            "tratamiento": "", "observaciones": "Control en 3 meses", "prioridad": "",
        ])
    }

    /// PAPER §34: la prioridad elegida viaja como `prioridad`; el mismo cuerpo que ContratoTest.kt.
    @Test func cuerpoConPrioridad() throws {
        let cuerpo = try JSONEncoder().encode(InterconsultaAnswer(
            episodio: "e2", recomendacion: "Biopsia escisional", diagnostico: "D22.5 — Nevus atípico",
            tratamiento: "", observaciones: "", prioridad: .preferred,
        ))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: String])
        #expect(json == [
            "episode_id": "e2", "recomendacion": "Biopsia escisional", "diagnostico": "D22.5 — Nevus atípico",
            "tratamiento": "", "observaciones": "", "prioridad": "Preferente",
        ])
        #expect(ClinicalPriority.allCases.map(\.rawValue) == ["Urgente", "Preferente", "Programada"])
    }

    @Test func respondeYDiceSiAviso() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("POST /api/bot/interconsulta/responder", .http(200, #"{"ok":true,"notified":true}"#))
        let resultado = try await api(servidor).answerInterconsulta(InterconsultaAnswer(
            episodio: "e1", recomendacion: "Biopsia", diagnostico: "", tratamiento: "", observaciones: "",
        ))
        #expect(resultado.notified == true)
        let cuerpo = try #require(servidor.cuerpo(de: "POST /api/bot/interconsulta/responder"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: String])
        #expect(json["episode_id"] == "e1")
        #expect(json["recomendacion"] == "Biopsia")
    }

    @Test func un409TraeElMotivoTalCual() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("POST /api/bot/interconsulta/responder",
                       .http(409, #"{"ok":false,"error":"Esta consulta ya fue respondida."}"#))
        do {
            _ = try await api(servidor).answerInterconsulta(InterconsultaAnswer(
                episodio: "e1", recomendacion: "x", diagnostico: "", tratamiento: "", observaciones: "",
            ))
            Issue.record("debía fallar")
        } catch {
            #expect((error as? APIError)?.status == 409)
            #expect(error.localizedDescription == "Esta consulta ya fue respondida.")
        }
    }

    @Test func motivosDelBotonComoLaWeb() throws {
        #expect(Interconsulta.blockReason(episode: nil, episodeData: nil, userId: "u1")
                == "Este paciente no tiene una consulta abierta")
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: nil, userId: "u1")
                == "Cargando el estado de la consulta…")
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: try episodio(#"{"estado":"respondida"}"#), userId: "u1")
                == "Esta interconsulta ya fue respondida")
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: try episodio(#"{"estado":"en_curso"}"#), userId: "u1")
                == "Esta consulta no tiene una interconsulta pendiente")
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: try episodio(#"{}"#), userId: "u1")
                == "Esta consulta no tiene una interconsulta pendiente")
        let propia = try episodio(#"{"estado":"derivada","medico_primario_id":"u1"}"#)
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: propia, userId: "u1")
                == "Tú ingresaste este caso: lo responde el especialista responsable")
        // Sin medico_primario_id, el primario es medico_id.
        let porMedicoId = try episodio(#"{"estado":"enviada","medico_id":"u1"}"#)
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: porMedicoId, userId: "u1")
                == "Tú ingresaste este caso: lo responde el especialista responsable")
        // El responsable de turno responde el caso nuevo aunque siga en_curso (PAPER §32.2.1).
        let deTurno = try episodio(#"{"estado":"en_curso","medico_id":"u2","responsable_actual_id":"u1"}"#)
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: deTurno, userId: "u1") == nil)
        let deOtro = try episodio(#"{"estado":"en_curso","medico_id":"u2","responsable_actual_id":"u3"}"#)
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: deOtro, userId: "u1")
                == "Esta consulta no tiene una interconsulta pendiente")
        let cerrado = try episodio(#"{"estado":"cerrado","medico_id":"u2","responsable_actual_id":"u1"}"#)
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: cerrado, userId: "u1")
                == "Esta consulta no tiene una interconsulta pendiente")
        let respondida = try episodio(#"{"estado":"respondida","responsable_actual_id":"u1"}"#)
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: respondida, userId: "u1")
                == "Esta interconsulta ya fue respondida")
        let deAlta = try episodio(#"{"estado":"alta","responsable_actual_id":"u1"}"#)
        #expect(Interconsulta.blockReason(episode: "e1", episodeData: deAlta, userId: "u1")
                == "El paciente está de alta: si vuelve, abre una consulta nueva")
        for estado in ["enviada", "en_triage", "derivada", "en_revisión_solicitada"] {
            let ajena = try episodio(#"{"estado":"\#(estado)","medico_primario_id":"u2"}"#)
            #expect(Interconsulta.blockReason(episode: "e1", episodeData: ajena, userId: "u1") == nil)
        }
    }
}

/// «Dar de alta» (PAPER §35.2): el cuerpo, el 409 y cuándo se puede.
struct DarDeAltaTests {
    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, baseBot: base, credenciales: credenciales, configuracion: red))
    }

    private func episodio(_ data: String) throws -> Registro {
        try JSONDecoder().decode(Registro.self, from: Data(#"{"id":"e1","data":\#(data)}"#.utf8))
    }

    /// El mismo cuerpo que ContratoTest.kt.
    @Test func cuerpoDelPedido() throws {
        let cuerpo = try JSONEncoder().encode(PatientDischargeRequest(episodio: "e1", nota: "  Lesión resuelta\n"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: String])
        #expect(json == ["episode_id": "e1", "nota": "Lesión resuelta"])
        let sinNota = try JSONEncoder().encode(PatientDischargeRequest(episodio: "e1"))
        #expect(try JSONSerialization.jsonObject(with: sinNota) as? [String: String] == ["episode_id": "e1", "nota": ""])
    }

    @Test func daDeAlta() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("POST /api/bot/episodio/alta", .http(200, #"{"ok":true}"#))
        try await api(servidor).dischargePatient(PatientDischargeRequest(episodio: "e1", nota: "Sin controles"))
        let cuerpo = try #require(servidor.cuerpo(de: "POST /api/bot/episodio/alta"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: String])
        #expect(json == ["episode_id": "e1", "nota": "Sin controles"])
    }

    @Test func un409TraeElMotivoTalCual() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("POST /api/bot/episodio/alta", .http(409, #"{"ok":false,"error":"Este paciente ya está de alta"}"#))
        do {
            try await api(servidor).dischargePatient(PatientDischargeRequest(episodio: "e1"))
            Issue.record("debía fallar")
        } catch {
            #expect((error as? APIError)?.status == 409)
            #expect(error.localizedDescription == "Este paciente ya está de alta")
        }
    }

    @Test func motivosDelBotonComoLaWeb() throws {
        #expect(PatientDischarge.blockReason(episode: nil, episodeData: nil)
                == "Elige un paciente con una consulta abierta")
        #expect(PatientDischarge.blockReason(episode: "e1", episodeData: nil)
                == "Cargando el estado de la consulta…")
        #expect(PatientDischarge.blockReason(episode: "e1", episodeData: try episodio(#"{"estado":"alta"}"#))
                == "Este paciente ya está de alta. Si vuelve, abre una consulta nueva")
        for estado in ["en_curso", "enviada", "derivada", "respondida", "cerrado"] {
            #expect(PatientDischarge.blockReason(episode: "e1", episodeData: try episodio(#"{"estado":"\#(estado)"}"#)) == nil)
        }
        #expect(PatientDischarge.help(patientName: "Ana Ruiz").contains("Desde mañana Ana Ruiz no sale en la lista"))
        #expect(PatientDischarge.help(patientName: nil).contains("Desde mañana el paciente no sale en la lista"))
    }
}
