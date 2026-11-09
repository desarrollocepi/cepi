import Foundation
import Testing
@testable import CEPITelemedicina

/// `GET /api/bot/ficha` tal como lo arma `fichaCompleta` en cepi-bot/src/flowV1.ts (recortado a
/// los grupos que ejercitan cada caso: paciente, encabezado, opciones Sí/No, fotos, sección 7).
enum FichaJSON {
    static let completa = """
    {"ok":true,"episode_id":"e2","patient_id":"p1",
     "grupos":[
      {"id":"g_1_1","label":"1.1 Datos de contacto","category":"Filiación","target":"patient","done":true,
       "form":{"id":"ficha_grp_g_1_1","title":"1.1 Datos de contacto","submit_mode":"structured","submit_label":"Guardar",
               "fields":[{"key":"direccion","label":"Dirección","type":"text"},{"key":"telefono","label":"Teléfono","type":"text"},
                         {"key":"sector_ciudad","label":"Sector / ciudad","type":"text"},{"key":"ocupacion","label":"Ocupación","type":"text"},
                         {"key":"email","label":"Email","type":"text"}],
               "actions":[{"label":"Omitir","send":"omitir ficha"}],
               "values":{"direccion":"Av. Castro #647","telefono":"0923453558"}}},
      {"id":"g_1_3","label":"1.3 Sexo","category":"Filiación","target":"patient","done":false,
       "form":{"id":"ficha_grp_g_1_3","title":"1.3 Sexo","submit_mode":"structured","submit_label":"Guardar",
               "fields":[{"key":"sexo","label":"Sexo","type":"radio","options":["M","F","Otro"]}],
               "actions":[{"label":"Omitir","send":"omitir ficha"}]}},
      {"id":"g_prioridad","label":"3.8 Prioridad clínica","category":"Anamnesis","target":"episode","done":true,
       "form":{"id":"ficha_grp_g_prioridad","title":"3.8 Prioridad clínica","submit_mode":"structured","submit_label":"Guardar",
               "fields":[{"label":"Urgente: sospecha de melanoma o lesión que sangra. Preferente: crecimiento reciente.","type":"heading"},
                         {"key":"prioridad","label":"Prioridad","type":"radio","options":["Urgente","Preferente","Programada"]}],
               "actions":[{"label":"Omitir","send":"omitir ficha"}],
               "values":{"prioridad":"Preferente"}}},
      {"id":"g_4_1","label":"4.1 Lesión elemental","category":"Examen físico","target":"episode","done":true,
       "form":{"id":"ficha_grp_g_4_1","title":"4.1 Lesión elemental","submit_mode":"structured","submit_label":"Guardar",
               "fields":[{"key":"lesion_macula","label":"Lesión: Mácula","type":"radio","options":[{"label":"Sí","value":true},{"label":"No","value":false}]},
                         {"key":"lesion_placa","label":"Lesión: Placa","type":"radio","options":[{"label":"Sí","value":true},{"label":"No","value":false}]},
                         {"key":"lesion_otra","label":"Lesión: Otra","type":"text"}],
               "actions":[{"label":"Omitir","send":"omitir ficha"}],
               "values":{"lesion_macula":false,"lesion_placa":true}}},
      {"id":"g_4_7","label":"4.7 Imágenes Lesión","category":"Examen físico","target":"episode","done":true,
       "form":{"id":"ficha_grp_g_4_7","title":"4.7 Imágenes Lesión","submit_mode":"structured","submit_label":"Guardar",
               "fields":[{"key":"imagenes_lesion","label":"Imágenes de la lesión","type":"image_upload","multiple":true}],
               "actions":[{"label":"Omitir","send":"omitir ficha"}],
               "values":{"imagenes_lesion":"a1,a2"}}},
      {"id":"g_7","label":"7 Tratamiento y plan","category":"Tratamiento","target":"episode","done":false,
       "form":{"id":"ficha_grp_g_7","title":"7 Tratamiento y plan","submit_mode":"structured","submit_label":"Guardar",
               "fields":[{"key":"tratamiento_resumen","label":"Tratamiento","type":"textarea"},{"key":"plan","label":"Plan","type":"textarea"},
                         {"key":"proximo_control_fecha","label":"Próximo control","type":"date"},
                         {"key":"proximo_control_motivo","label":"Motivo del próximo control","type":"text"},
                         {"key":"observaciones","label":"Observaciones","type":"textarea"}],
               "actions":[{"label":"Omitir","send":"omitir ficha"}]}},
      {"id":"g_8","label":"8.1 Consentimiento informado (firma el paciente)","category":"Consentimiento","target":"patient","done":false,
       "form":{"id":"ficha_grp_g_8","title":"8.1 Consentimiento informado (firma el paciente)","submit_mode":"structured","submit_label":"Guardar",
               "fields":[{"key":"imagen_consentimiento","label":"Foto del consentimiento informado firmado por el paciente","type":"image_upload"}],
               "actions":[{"label":"Omitir","send":"omitir ficha"}]}},
      {"id":"g_x","label":"Grupo sin formulario","category":"Consentimiento","target":"episode","done":false,"form":null}
     ],
     "faltantes":["1.3 Sexo","7 Tratamiento y plan","8.1 Consentimiento informado (firma el paciente)","Grupo sin formulario"],
     "completos":4,"total":8}
    """

    static func ficha() throws -> FullFicha {
        try JSONDecoder().decode(FullFicha.self, from: Data(completa.utf8))
    }

    static func group(_ id: String) throws -> FichaGroup {
        try #require(try ficha().groups.first { $0.id == id })
    }
}

struct FichaCompletaContratoTests {
    @Test func decodificaLaFichaDelBot() throws {
        let ficha = try FichaJSON.ficha()
        #expect(ficha.groups.count == 8)
        #expect(ficha.complete == 4)
        #expect(ficha.total == 8)
        #expect(ficha.missing.first == "1.3 Sexo")

        let contacto = ficha.groups[0]
        #expect(contacto.id == "g_1_1")
        #expect(contacto.category == "Filiación")
        #expect(contacto.target == "patient")
        #expect(contacto.done)
        #expect(contacto.form?.id == "ficha_grp_g_1_1")
        #expect(contacto.form?.valores["direccion"] == .texto("Av. Castro #647"))

        let prioridad = try FichaJSON.group("g_prioridad")
        #expect(prioridad.form?.campos.first?.tipo == .titulo)
        #expect(prioridad.form?.campos.first?.clave == nil)

        #expect(try FichaJSON.group("g_x").form == nil)
    }

    @Test func sinTotalCuentaLosGrupos() throws {
        let ficha = try JSONDecoder().decode(FullFicha.self, from: Data("""
        {"ok":true,"grupos":[{"id":"g_1_2","label":"1.2 Fecha de nacimiento","category":"Filiación","target":"patient","done":false,"form":null}]}
        """.utf8))
        #expect(ficha.total == 1)
        #expect(ficha.complete == 0)
    }

    @Test func elGuardadoDeUnGrupo() throws {
        let cuerpo = try JSONEncoder().encode(FichaGroupSave(
            groupId: "g_4_1", data: ["lesion_placa": .booleano(true), "lesion_otra": .texto("costra")],
            episodeId: "e2", patientId: "p1"
        ))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(Set(json.keys) == ["group_id", "data", "episode_id", "patient_id"])
        #expect(json["group_id"] as? String == "g_4_1")
        let data = try #require(json["data"] as? [String: Any])
        #expect(data["lesion_placa"] as? Bool == true)
        #expect(data["lesion_otra"] as? String == "costra")

        let conPorcentaje = try JSONDecoder().decode(FichaGroupSaveResult.self, from: Data(
            #"{"ok":true,"target":"episode","targetId":"e2","completitud":81}"#.utf8))
        #expect(conPorcentaje.completeness == 81)
        let sinPorcentaje = try JSONDecoder().decode(FichaGroupSaveResult.self, from: Data(
            #"{"ok":true,"target":"patient","targetId":"p1","completitud":null}"#.utf8))
        #expect(sinPorcentaje.completeness == nil)
    }
}

struct FichaLogicTests {
    @Test func progreso() {
        #expect(FichaLogic.percent(complete: 4, total: 8) == 50)
        #expect(FichaLogic.percent(complete: 2, total: 3) == 67)
        #expect(FichaLogic.percent(complete: 0, total: 0) == 0)
        #expect(FichaLogic.progressText(complete: 4, total: 8) == "4 de 8 grupos con dato")
    }

    @Test func categoriasEnOrdenYSoloLoQueFalta() throws {
        let grupos = try FichaJSON.ficha().groups
        let todas = FichaLogic.categories(grupos, onlyMissing: false)
        #expect(todas.map(\.name) == ["Filiación", "Anamnesis", "Examen físico", "Tratamiento", "Consentimiento"])
        #expect(todas[0].complete == 1)
        #expect(todas[0].visible.map(\.id) == ["g_1_1", "g_1_3"])

        let faltan = FichaLogic.categories(grupos, onlyMissing: true)
        // Las categorías completas desaparecen; en las otras solo quedan los grupos sin dato.
        #expect(faltan.map(\.name) == ["Filiación", "Tratamiento", "Consentimiento"])
        #expect(faltan[0].visible.map(\.id) == ["g_1_3"])
        #expect(faltan[0].groups.count == 2)
        #expect(faltan.flatMap(\.visible).allSatisfy { !$0.done })
    }

    @Test func losGruposDeFotosNoSeEditan() throws {
        for id in ["g_4_7", "g_8"] {
            let grupo = try FichaJSON.group(id)
            #expect(!FichaLogic.isEditable(grupo))
            #expect(FichaLogic.editBlockReason(grupo) == "Las fotos se suben en Imágenes o en el chat.")
            #expect(FichaLogic.editableForm(grupo) == nil)
        }
        #expect(FichaLogic.imageGroups == ["g_4_7", "g_8", "g_8_2"])

        let sinFormulario = try FichaJSON.group("g_x")
        #expect(FichaLogic.editBlockReason(sinFormulario) == "Este grupo no tiene formulario.")
    }

    @Test func editarAbreElFormularioDelChatSinOmitir() throws {
        let contacto = try FichaJSON.group("g_1_1")
        #expect(FichaLogic.editTitle(contacto) == "Editar")
        #expect(FichaLogic.editTitle(try FichaJSON.group("g_7")) == "Completar")
        let formulario = try #require(FichaLogic.editableForm(contacto))
        #expect(formulario.acciones.isEmpty)
        #expect(contacto.form?.acciones.count == 1)
        #expect(formulario.id == "ficha_grp_g_1_1")
        #expect(formulario.estructurado)
        #expect(formulario.campos.count == 5)
        #expect(formulario.valores["telefono"] == .texto("0923453558"))
        // El renderer de siempre lo abre prellenado.
        #expect(LogicaFormulario.valoresIniciales(formulario)["direccion"] == .texto("Av. Castro #647"))
    }

    @Test func loCargadoSeLeeComoEnLaWeb() throws {
        let contacto = FichaLogic.values(try FichaJSON.group("g_1_1"))
        #expect(contacto.map(\.label) == ["Dirección", "Teléfono"])

        // El encabezado no es dato; la opción se lee por su etiqueta.
        let prioridad = FichaLogic.values(try FichaJSON.group("g_prioridad"))
        #expect(prioridad.map(\.text) == ["Preferente"])

        // `false` es una respuesta ("No"), no un vacío.
        let lesion = FichaLogic.values(try FichaJSON.group("g_4_1"))
        #expect(lesion.map(\.text) == ["No", "Sí"])

        #expect(FichaLogic.values(try FichaJSON.group("g_4_7")).map(\.text) == ["2 imágenes"])
        #expect(FichaLogic.values(try FichaJSON.group("g_7")).isEmpty)
    }

    @Test func cambiosRespectoDeLaConsultaAnterior() throws {
        let grupos = try FichaJSON.ficha().groups
        let anterior: [String: JSONValor] = [
            "prioridad": .texto("Programada"), "lesion_macula": .nulo, "lesion_placa": .booleano(true),
            "direccion": .texto("Otra dirección"),
        ]
        let prioridad = FichaLogic.values(try FichaJSON.group("g_prioridad"), previous: anterior)
        #expect(prioridad.first?.previous == "Programada")
        // Falso y ausente son lo mismo; los datos del paciente no se comparan.
        let lesion = FichaLogic.values(try FichaJSON.group("g_4_1"), previous: anterior)
        #expect(lesion.allSatisfy { !$0.changed })
        #expect(FichaLogic.values(try FichaJSON.group("g_1_1"), previous: anterior).allSatisfy { !$0.changed })
        // Las fotos: antes no había ninguna.
        #expect(FichaLogic.changeCount(grupos, previous: anterior) == 2)
        #expect(FichaLogic.changeCount(grupos, previous: nil) == 0)
        #expect(FichaLogic.change(key: "fecha", current: .texto("2026-11-09"), target: "episode", previous: ["fecha": .texto("2026-10-01")]) == nil)
    }

    private func visitas(_ ids: [String]) throws -> [Registro] {
        try ids.enumerated().map { index, id in
            try JSONDecoder().decode(Registro.self, from: Data(
                #"{"id":"\#(id)","data":{"fecha":"2026-1\#(index)-01T00:00:00.000Z"}}"#.utf8))
        }
    }

    @Test func navegacionEntreConsultas() throws {
        let tres = try visitas(["e3", "e2", "e1"])
        let medio = FichaLogic.Navigation(visits: tres, episode: "e2")
        #expect(medio.title == "Episodio 2 de 3")
        #expect(medio.hasPrevious && medio.hasNext)
        #expect(medio.previousIndex == 2)
        #expect(medio.nextIndex == 0)

        let nueva = FichaLogic.Navigation(visits: tres, episode: "e3")
        #expect(!nueva.hasNext)
        #expect(nueva.nextHint == "Es el episodio más reciente")
        let vieja = FichaLogic.Navigation(visits: tres, episode: "e1")
        #expect(!vieja.hasPrevious)
        #expect(FichaLogic.navigationNote(vieja, loading: false, failed: false, changes: 0, previousDate: nil)
            == "es el primer episodio del paciente")
        #expect(FichaLogic.navigationNote(medio, loading: false, failed: false, changes: 1, previousDate: "2026-12-01")
            == "1 campo cambió desde el del 2026-12-01")
        #expect(FichaLogic.navigationNote(medio, loading: false, failed: false, changes: 0, previousDate: "2026-12-01")
            == "sin cambios respecto del 2026-12-01")
        #expect(FichaLogic.date(of: tres[0]) == "2026-10-01")

        let una = FichaLogic.Navigation(visits: try visitas(["e1"]), episode: "e1")
        #expect(una.title == "Episodio 1 de 1")
        #expect(!una.hasPrevious && !una.hasNext)
        #expect(FichaLogic.navigationNote(una, loading: false, failed: false, changes: 0, previousDate: nil)
            == "único episodio registrado de este paciente")

        let ninguna = FichaLogic.Navigation(visits: [], episode: nil)
        #expect(ninguna.title == "Episodio")
        #expect(FichaLogic.navigationNote(ninguna, loading: true, failed: false, changes: 0, previousDate: nil)
            == "buscando los otros episodios…")
        #expect(FichaLogic.navigationNote(ninguna, loading: false, failed: true, changes: 0, previousDate: nil)
            == "no se pudieron listar los otros episodios")
    }

    @Test func respuestaDelEspecialista() throws {
        let respondido = try JSONDecoder().decode(Registro.self, from: Data(
            #"{"id":"e2","data":{"recomendacion":"Biopsia incisional","recomendacion_at":"2026-11-08T15:00:00Z"}}"#.utf8))
        #expect(FichaLogic.specialistAnswer(respondido) == FichaLogic.SpecialistAnswer(text: "Biopsia incisional", date: "2026-11-08T15:00:00Z"))
        let sin = try JSONDecoder().decode(Registro.self, from: Data(#"{"id":"e2","data":{"recomendacion":""}}"#.utf8))
        #expect(FichaLogic.specialistAnswer(sin) == nil)
        #expect(FichaLogic.specialistAnswer(nil) == nil)
    }

    @Test func avisoTrasGuardar() throws {
        let con = try JSONDecoder().decode(FichaGroupSaveResult.self, from: Data(#"{"ok":true,"completitud":80.6}"#.utf8))
        #expect(FichaLogic.savedNotice(con) == "Guardado · 81% de la ficha")
        let sin = try JSONDecoder().decode(FichaGroupSaveResult.self, from: Data(#"{"ok":true}"#.utf8))
        #expect(FichaLogic.savedNotice(sin) == "Guardado")
    }
}

/// La sección Ficha contra un bot falso: qué pide, qué guarda y que recarga tras guardar.
@MainActor
struct FichaModelTests {
    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, baseBot: base, credenciales: credenciales, configuracion: red))
    }

    private let episodios = """
    {"ok":true,"data":[
     {"id":"e2","data":{"fecha":"2026-11-08","patient_id":"p1","prioridad":"Preferente","recomendacion":"Control en 4 semanas"}},
     {"id":"e1","data":{"fecha":"2026-10-01","patient_id":"p1","prioridad":"Programada"}}]}
    """

    @Test func abreLaConsultaActivaYGuardaUnGrupo() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/entities", .http(200, episodios))
        servidor.fijar("GET /api/bot/ficha", .http(200, FichaJSON.completa))
        servidor.fijar("POST /api/bot/ficha/grupo", .http(200, #"{"ok":true,"target":"episode","targetId":"e2","completitud":62.5}"#))
        let api = api(servidor)
        let modelo = FichaModel(patientId: "p1")

        await modelo.open(preferred: "e2", api: api)
        #expect(modelo.episodeId == "e2")
        #expect(modelo.groups.count == 8)
        #expect(modelo.percent == 50)
        #expect(modelo.navigation.title == "Episodio 2 de 2")
        #expect(modelo.specialistAnswer?.text == "Control en 4 semanas")
        // 3.8 cambió de Programada a Preferente; la placa y las fotos no estaban.
        #expect(modelo.changeCount == 3)
        #expect(modelo.navigationNote == "3 campos cambiaron desde el del 2026-10-01")

        let grupo = try FichaJSON.group("g_7")
        modelo.edit(grupo)
        #expect(modelo.editing?.id == "g_7")
        let error = await modelo.save(grupo, data: ["plan": .texto("Biopsia")], api: api)
        #expect(error == nil)
        #expect(modelo.editing == nil)
        #expect(modelo.notice == "Guardado · 63% de la ficha")
        #expect(!modelo.noticeIsError)

        let cuerpo = try #require(servidor.cuerpo(de: "POST /api/bot/ficha/grupo"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(json["group_id"] as? String == "g_7")
        #expect(json["episode_id"] as? String == "e2")
        #expect(json["patient_id"] as? String == "p1")
        #expect(json["data"] as? [String: String] == ["plan": "Biopsia"])
        // Tras guardar se vuelve a pedir la ficha entera.
        #expect(servidor.pedidos.filter { $0 == "GET /api/bot/ficha" }.count == 2)
    }

    @Test func unGrupoDeFotosNoAbreFormulario() async throws {
        let modelo = FichaModel(patientId: "p1")
        modelo.edit(try FichaJSON.group("g_4_7"))
        #expect(modelo.editing == nil)
    }

    @Test func unFalloAlGuardarDejaElFormularioAbierto() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/entities", .http(200, episodios))
        servidor.fijar("GET /api/bot/ficha", .http(200, FichaJSON.completa))
        servidor.fijar("POST /api/bot/ficha/grupo", .http(400, #"{"ok":false,"error":"campo desconocido: x"}"#))
        let api = api(servidor)
        let modelo = FichaModel(patientId: "p1")
        await modelo.open(preferred: nil, api: api)
        // Sin pedido abre la más nueva.
        #expect(modelo.episodeId == "e2")

        let grupo = try FichaJSON.group("g_1_3")
        modelo.edit(grupo)
        let error = await modelo.save(grupo, data: ["x": .texto("y")], api: api)
        #expect(error == "campo desconocido: x")
        #expect(modelo.editing?.id == "g_1_3")
        #expect(modelo.noticeIsError)
    }

    @Test func navegarPideLaFichaDeLaOtraConsulta() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/entities", .http(200, episodios))
        servidor.fijar("GET /api/bot/ficha", .http(200, FichaJSON.completa))
        let api = api(servidor)
        let modelo = FichaModel(patientId: "p1")
        await modelo.open(preferred: "e2", api: api)
        await modelo.goPrevious(api: api)
        #expect(modelo.episodeId == "e1")
        #expect(modelo.navigation.title == "Episodio 1 de 2")
        #expect(modelo.navigationNote == "es el primer episodio del paciente")
        #expect(modelo.specialistAnswer == nil)
        await modelo.goNext(api: api)
        #expect(modelo.episodeId == "e2")
    }

    @Test func laPeticionLlevaLosDosIds() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/bot/ficha", .http(200, FichaJSON.completa))
        let ficha = try await api(servidor).fullFicha(episode: "e2", patient: "p1")
        #expect(ficha.total == 8)
        #expect(servidor.pedidos == ["GET /api/bot/ficha"])
    }
}

struct EvolutionLogicTests {
    private func fila(_ id: String, observaciones: String? = nil, medico: String? = nil, especialista: String? = nil) -> FilaEvolucion {
        FilaEvolucion(
            episodio: id, fecha: "2026-11-08", estado: "en_revision", medico: medico, especialista: especialista,
            diagnostico: "L40.0 — Psoriasis", diagnosticoHistopatologico: nil, tratamiento: nil,
            observaciones: observaciones
        )
    }

    @Test func tarjetaConLasColumnasDeLaWeb() {
        let celdas = EvolutionLogic.cells(fila("e1", medico: "Dra. Pérez"))
        #expect(celdas.map(\.label) == ["Fecha", "Atendió", "Diagnóstico clínico", "Diagnóstico histopatológico", "Tratamiento"])
        #expect(celdas.map(\.text) == ["2026-11-08", "Dra. Pérez", "L40.0 — Psoriasis", "Sin biopsia", "Sin tratamiento"])
        #expect(celdas.map(\.empty) == [false, false, false, true, true])
        // Sin médico pero con especialista, Atendió no va en gris.
        #expect(EvolutionLogic.cells(fila("e1", especialista: "Dra. Derma"))[1].empty == false)
        #expect(EvolutionLogic.cells(fila("e1"))[1] == .init(label: "Atendió", text: "—", empty: true))
        #expect(EvolutionLogic.observationsText(fila("e1")) == "Sin observaciones")
        #expect(EvolutionLogic.summary([fila("e1")]) == "1 ficha")
        #expect(EvolutionLogic.summary([fila("e1"), fila("e2")]) == "2 fichas")
    }

    @Test func soloUnaObservacionALaVez() {
        #expect(EvolutionLogic.editBlockReason(row: "e1", editing: nil) == nil)
        #expect(EvolutionLogic.editBlockReason(row: "e1", editing: "e1") == nil)
        #expect(EvolutionLogic.editBlockReason(row: "e2", editing: "e1") == "Termina primero la otra observación")
    }

    @Test func guardarSoloConCambios() {
        #expect(!EvolutionLogic.canSave(draft: "Control", original: "Control", saving: false))
        #expect(!EvolutionLogic.canSave(draft: "  Control \n", original: "Control", saving: false))
        #expect(!EvolutionLogic.canSave(draft: "", original: nil, saving: false))
        #expect(EvolutionLogic.canSave(draft: "Control en 4 semanas", original: "Control", saving: false))
        #expect(!EvolutionLogic.canSave(draft: "Otra", original: "Control", saving: true))
        // Borrar lo que había también es un cambio.
        #expect(EvolutionLogic.canSave(draft: "", original: "Control", saving: false))
        #expect(EvolutionLogic.saveHint(draft: "Control", original: "Control", saving: false) == "No hay cambios que guardar")
        #expect(EvolutionLogic.saveHint(draft: "x", original: nil, saving: true) == "Guardando…")
    }

    @Test func loGuardadoQuedaEnSuFila() {
        let filas = [fila("e2", observaciones: "Antes"), fila("e1", observaciones: "Otra")]
        let guardadas = EvolutionLogic.applying(observations: "  Resumen nuevo ", to: "e2", in: filas)
        #expect(guardadas.map(\.observaciones) == ["Resumen nuevo", "Otra"])
        #expect(guardadas[0].diagnostico == "L40.0 — Psoriasis")
        let vacia = EvolutionLogic.applying(observations: "   ", to: "e1", in: filas)
        #expect(vacia[1].observaciones == nil)
    }
}
