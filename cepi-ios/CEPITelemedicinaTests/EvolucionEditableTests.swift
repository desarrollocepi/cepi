import Foundation
import Testing
@testable import CEPITelemedicina

/// PAPER §28.4.1: evolución en orden de cita, su formulario editable y el navegador de
/// episodios en las cuatro secciones del paciente.
struct EvolucionEditableTests {
    private func fila(
        episodio: String = "e2", evolution: String? = nil, fecha: String? = "2026-11-08", estado: String = "en_curso",
        diagnostico: String? = "L40.0 — Psoriasis", tratamiento: String? = nil, observaciones: String? = nil,
        hallazgos: String? = nil, control: String? = nil, motivoControl: String? = nil, esInicial: Bool = false
    ) -> FilaEvolucion {
        FilaEvolucion(
            episodio: episodio, fecha: fecha, estado: estado, medico: nil, especialista: nil,
            diagnostico: diagnostico, diagnosticoHistopatologico: nil, tratamiento: tratamiento,
            observaciones: observaciones, evolutionId: evolution, esInicial: esInicial, hallazgos: hallazgos,
            proximoControlFecha: control, proximoControlMotivo: motivoControl
        )
    }

    private func json(_ edit: EvolutionEdit) throws -> [String: String] {
        let datos = try JSONEncoder().encode(edit)
        return try #require(try JSONSerialization.jsonObject(with: datos) as? [String: String])
    }

    // MARK: Orden

    @Test func evolucionesEnOrdenDeCita() {
        // El servidor manda de la más nueva a la más vieja.
        let filas = [
            fila(evolution: "v3", fecha: "2026-11-08", control: "2026-12-08", motivoControl: "Ver respuesta"),
            fila(evolution: "v2", fecha: "2026-10-20", control: "2026-11-08"),
            fila(evolution: "v1", fecha: "2026-10-01", esInicial: true),
        ]
        let grupo = EvolutionLogic.groups(filas)[0]
        // En pantalla: la más vieja arriba, la más nueva abajo, junto al próximo control.
        #expect(grupo.chronological.map(\.id) == ["v1", "v2", "v3"])
        // La vigente sigue siendo la más nueva: la resaltada y la del próximo control.
        #expect(grupo.latest?.id == "v3")
        #expect(EvolutionLogic.nextControl(grupo, today: "2026-11-11")
            == .scheduled(date: "2026-12-08", reason: "Ver respuesta", status: .upcoming))
        // La fecha de apertura no cambia con el orden.
        #expect(grupo.openedOn == "2026-10-01")
        // La fila armada sola es su propia vigente.
        let armada = EvolutionLogic.groups([fila(episodio: "e1")])[0]
        #expect(armada.chronological.map(\.id) == ["episode:e1"])
        #expect(armada.latest?.isAssembled == true)
    }

    @Test func proximoControlSeTocaSalvoDeAlta() {
        let enCurso = EvolutionLogic.groups([fila(evolution: "v1")])[0]
        #expect(EvolutionLogic.nextControlTapBlockReason(enCurso) == nil)
        let armada = EvolutionLogic.groups([fila(episodio: "e1")])[0]
        #expect(EvolutionLogic.nextControlTapBlockReason(armada) == nil)
        let alta = EvolutionLogic.groups([fila(evolution: "v1", estado: "alta")])[0]
        #expect(EvolutionLogic.nextControlTapBlockReason(alta)
            == "Ficha de alta: abre una consulta nueva para otro control")
    }

    // MARK: Formulario

    @Test func borradorPrellenadoConLaFila() {
        let row = fila(
            evolution: "v2", fecha: "2026-10-20T00:00:00.000Z", tratamiento: "Clobetasol", observaciones: "Mejor",
            hallazgos: "Placas menores", control: "2026-11-20", motivoControl: "Ver respuesta"
        )
        let draft = EvolutionLogic.EvolutionDraft(row: row, today: "2026-11-11", suggestedNextControl: "2026-12-11")
        #expect(draft.date == "2026-10-20")
        #expect(draft.findings == "Placas menores")
        #expect(draft.diagnosis == "L40.0 — Psoriasis")
        #expect(draft.treatment == "Clobetasol")
        #expect(draft.observations == "Mejor")
        #expect(draft.hasNextControl)
        #expect(draft.nextControlDate == "2026-11-20")
        #expect(draft.nextControlReason == "Ver respuesta")
        // Sin fecha ni control: hoy, y el control sugerido apagado.
        let vacia = EvolutionLogic.EvolutionDraft(row: fila(episodio: "e1", fecha: nil), today: "2026-11-11", suggestedNextControl: "2026-12-11")
        #expect(vacia.date == "2026-11-11")
        #expect(!vacia.hasNextControl)
        #expect(vacia.nextControlDate == "2026-12-11")
    }

    @Test func cuerpoDeEditarConSoloLoQueCambio() throws {
        // POST /api/bot/evolucion/editar (PAPER §28.4.1).
        let row = fila(evolution: "v2", fecha: "2026-10-20", tratamiento: "Clobetasol", observaciones: "Mejor",
                       control: "2026-11-20", motivoControl: "Ver respuesta")
        var draft = EvolutionLogic.EvolutionDraft(row: row, today: "2026-11-11", suggestedNextControl: "2026-12-11")
        // Sin cambios no viaja nada y no se puede guardar.
        let igual = EvolutionLogic.edit(row, draft: draft)
        #expect(igual.isEmpty)
        #expect(try json(igual) == ["evolution_id": "v2"])
        #expect(EvolutionLogic.editSubmitBlockReason(igual, saving: false) == "No hay cambios que guardar")

        draft.date = "2026-10-21"
        draft.findings = "  Placas menores "
        draft.treatment = ""          // borrado: viaja vacío
        draft.observations = "Mejor"  // igual: no viaja
        draft.nextControlDate = "2026-12-01"
        let cambios = EvolutionLogic.edit(row, draft: draft)
        #expect(try json(cambios) == [
            "evolution_id": "v2", "fecha": "2026-10-21", "hallazgos": "Placas menores", "tratamiento": "",
            "proximo_control_fecha": "2026-12-01",
        ])
        #expect(EvolutionLogic.editSubmitBlockReason(cambios, saving: false) == nil)
        #expect(EvolutionLogic.editSubmitBlockReason(cambios, saving: true) == "Guardando…")

        // Apagar el próximo control borra su fecha y su motivo.
        var sinControl = EvolutionLogic.EvolutionDraft(row: row, today: "2026-11-11", suggestedNextControl: "2026-12-11")
        sinControl.hasNextControl = false
        #expect(try json(EvolutionLogic.edit(row, draft: sinControl)) == [
            "evolution_id": "v2", "proximo_control_fecha": "", "proximo_control_motivo": "",
        ])
        // La fecha de la cita nunca viaja vacía.
        var sinFecha = EvolutionLogic.EvolutionDraft(row: row, today: "2026-11-11", suggestedNextControl: "2026-12-11")
        sinFecha.date = ""
        #expect(EvolutionLogic.edit(row, draft: sinFecha).isEmpty)
    }

    @Test func laFilaArmadaSeEditaPorSuFicha() throws {
        let armada = fila(episodio: "e1", fecha: "2026-06-10", diagnostico: nil)
        var draft = EvolutionLogic.EvolutionDraft(row: armada, today: "2026-11-11", suggestedNextControl: "2026-12-11")
        draft.diagnosis = "D22.5 — Nevo melanocítico"
        draft.hasNextControl = true
        draft.nextControlReason = "Dermatoscopia"
        #expect(try json(EvolutionLogic.edit(armada, draft: draft)) == [
            "episode_id": "e1", "diagnostico": "D22.5 — Nevo melanocítico",
            "proximo_control_fecha": "2026-12-11", "proximo_control_motivo": "Dermatoscopia",
        ])
    }

    @Test func elCuerpoViejoDelLapizSigueIgual() throws {
        #expect(try json(EvolutionEdit(evolutionId: "v2", observaciones: "")) == ["evolution_id": "v2", "observaciones": ""])
    }

    // MARK: Navegador de episodios

    private func visitas(_ ids: [String], motivo: String? = nil) throws -> [Registro] {
        try ids.enumerated().map { index, id in
            let extra = motivo.map { #","motivo_consulta":"\#($0)""# } ?? ""
            return try JSONDecoder().decode(Registro.self, from: Data(
                #"{"id":"\#(id)","data":{"fecha":"2026-1\#(index)-01"\#(extra)}}"#.utf8))
        }
    }

    @Test func elEpisodioALaVista() throws {
        let tres = try visitas(["e3", "e2", "e1"])
        #expect(EpisodeNavigation.current(selected: "e1", active: "e3", visits: tres) == "e1")
        #expect(EpisodeNavigation.current(selected: nil, active: "e2", visits: tres) == "e2")
        #expect(EpisodeNavigation.current(selected: nil, active: nil, visits: tres) == "e3")
        #expect(EpisodeNavigation.current(selected: nil, active: nil, visits: []) == nil)
    }

    @Test func laNotaDiceDondeEsta() throws {
        let tres = try visitas(["e3", "e2", "e1"], motivo: "Placas")
        func note(_ episode: String?, _ visits: [Registro], loading: Bool = false, failed: Bool = false) -> String {
            let nav = FichaLogic.Navigation(visits: visits, episode: episode)
            return EpisodeNavigation.note(nav, loading: loading, failed: failed, motivo: visits.first { $0.id == episode }?["motivo_consulta"])
        }
        #expect(note("e3", tres) == "es el episodio más reciente")
        #expect(note("e1", tres) == "es el primer episodio del paciente")
        #expect(note("e2", tres) == "Placas")
        #expect(note("e2", try visitas(["e3", "e2", "e1"])) == "usa las flechas para ir a otro episodio")
        #expect(note("nueva", tres) == "episodio recién abierto: todavía no está en la lista")
        #expect(note("e1", try visitas(["e1"])) == "único episodio registrado de este paciente")
        #expect(note(nil, [], loading: true) == "buscando los episodios…")
        #expect(note(nil, [], failed: true) == "no se pudieron listar los episodios")
        #expect(note(nil, []) == "sin consultas registradas de este paciente")
    }

    @Test func elChatSigueAlEpisodioElegido() {
        // Elegido otro episodio con el chat a la vista: se activa.
        #expect(EpisodeNavigation.chatActivation(selected: "e1", active: "e2", inChat: true, busy: false, lastAttempt: nil) == "e1")
        // En otra sección, ocupado, sin elección, ya activo o ya intentado: nada.
        #expect(EpisodeNavigation.chatActivation(selected: "e1", active: "e2", inChat: false, busy: false, lastAttempt: nil) == nil)
        #expect(EpisodeNavigation.chatActivation(selected: "e1", active: "e2", inChat: true, busy: true, lastAttempt: nil) == nil)
        #expect(EpisodeNavigation.chatActivation(selected: nil, active: "e2", inChat: true, busy: false, lastAttempt: nil) == nil)
        #expect(EpisodeNavigation.chatActivation(selected: "e2", active: "e2", inChat: true, busy: false, lastAttempt: nil) == nil)
        #expect(EpisodeNavigation.chatActivation(selected: "e1", active: "e2", inChat: true, busy: false, lastAttempt: "e1") == nil)
        #expect(EpisodeNavigation.activationCommand("e1") == "activar episodio e1")
    }

    // MARK: Imágenes del episodio

    private func imagen(_ id: String, episodio: String?) throws -> ImagenGaleria {
        let ep = episodio.map { #""\#($0)""# } ?? "null"
        return try JSONDecoder().decode(ImagenGaleria.self, from: Data(
            #"{"id":"\#(id)","attachment_id":"a\#(id)","patient_id":"p1","episode_id":\#(ep)}"#.utf8))
    }

    @Test func imagenesDelEpisodioElegido() throws {
        let fotos = [try imagen("1", episodio: "e2"), try imagen("2", episodio: "e1"), try imagen("3", episodio: "e2"),
                     try imagen("4", episodio: nil)]
        #expect(EpisodeImages.filter(fotos, episode: "e2", showAll: false).map(\.id) == ["1", "3"])
        #expect(EpisodeImages.filter(fotos, episode: "e2", showAll: true).map(\.id) == ["1", "2", "3", "4"])
        #expect(EpisodeImages.filter(fotos, episode: nil, showAll: false).count == 4)
        #expect(EpisodeImages.filter(fotos, episode: "e9", showAll: false).isEmpty)
        #expect(EpisodeImages.emptyText(showAll: false, episode: "e9")
            == "Este episodio no tiene imágenes. «Ver todas» muestra las del paciente.")
        #expect(EpisodeImages.emptyText(showAll: true, episode: "e9") == "Este paciente todavía no tiene imágenes")
        #expect(EpisodeImages.onlyEpisodeBlockReason(episode: nil) == "Este paciente todavía no tiene episodios")
        #expect(EpisodeImages.onlyEpisodeBlockReason(episode: "e2") == nil)
    }

    // MARK: Composer

    @Test func elTecladoNoDevuelveLoEnviado() {
        let enviado = ComposerLogic.sentKey("  Placas en codos \n")
        #expect(enviado == "Placas en codos")
        #expect(ComposerLogic.sentKey("   ") == nil)
        #expect(ComposerLogic.isEcho("Placas en codos", of: "Placas en codos"))
        #expect(ComposerLogic.isEcho("Placas en codos ", of: "Placas en codos"))
        #expect(!ComposerLogic.isEcho("", of: "Placas en codos"))
        #expect(!ComposerLogic.isEcho("Otra cosa", of: "Placas en codos"))
    }
}

/// El navegador contra un ERP falso: lee las consultas, se mueve y sigue al chat.
@MainActor
struct EpisodeNavigatorModelTests {
    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, baseBot: base, credenciales: credenciales, configuracion: red))
    }

    @Test func navegaYSigueAlChat() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/entities", .http(200, """
        {"ok":true,"data":[
         {"id":"e2","data":{"fecha":"2026-11-08","patient_id":"p1"}},
         {"id":"e1","data":{"fecha":"2026-10-01","patient_id":"p1"}}]}
        """))
        let api = api(servidor)
        let modelo = EpisodeNavigatorModel(patientId: "p1")
        await modelo.load(api: api)
        // Sin elección ni episodio activo: el más nuevo, con Siguiente gris.
        #expect(modelo.current == "e2")
        #expect(modelo.navigation.title == "Episodio 2 de 2")
        #expect(!modelo.navigation.hasNext)
        #expect(modelo.note == "es el episodio más reciente")

        modelo.goPrevious()
        #expect(modelo.current == "e1")
        #expect(modelo.selected == "e1")
        #expect(!modelo.navigation.hasPrevious)
        modelo.goPrevious()   // en el extremo no se mueve
        #expect(modelo.current == "e1")
        modelo.goNext()
        #expect(modelo.current == "e2")

        // El chat activó otro episodio: la barra lo sigue y suelta la elección.
        modelo.select("e2")
        await modelo.follow(active: "e1", api: api)
        #expect(modelo.selected == nil)
        #expect(modelo.current == "e1")
        // Una consulta recién abierta no está en la lista: se relee.
        let antes = servidor.pedidos.filter { $0 == "GET /api/entities" }.count
        await modelo.follow(active: "e3", api: api)
        #expect(servidor.pedidos.filter { $0 == "GET /api/entities" }.count == antes + 1)
        #expect(modelo.current == "e3")
    }
}
