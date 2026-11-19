import SwiftUI

/// Un paciente abierto: cuatro secciones que se pasan deslizando (PAPER §24.2.1, D-Aux-22).
///
///   Chat · Ficha · Evolución · Imágenes
///
/// El modelo del hilo vive acá y no en el chat: la ficha guarda con él (`ficha_save`) y las
/// acciones (nueva consulta, secciones, derivar) valen desde cualquier sección. También el
/// navegador de episodios (PAPER §28.4.1): la barra «Episodio N de M» va debajo del selector
/// de secciones y el episodio elegido vale para las cuatro.
struct PacienteView: View {
    let fila: FilaPaciente
    /// Cierra el paciente (tras derivar, el médico pasa al siguiente).
    let alTerminar: () -> Void
    /// Vuelve a pedir la lista: tras responder o «🙋 Revisar», el paciente sale de
    /// "revisar"; tras el alta, pasa a «Alta».
    let onListChanged: () async -> Void

    @Environment(Sesion.self) private var sesion
    @State private var modelo: HiloModelo
    /// La sección a la vista. La tiene la lista: su menú de acciones abre directo en una.
    @Binding var seccion: Seccion
    @State private var mostrarSecciones = false
    @State private var mostrarDerivar = false
    /// El episodio elegido en la barra «Episodio N de M»: lo muestran las cuatro secciones.
    @State private var navigator: EpisodeNavigatorModel
    /// Sube cada vez que la Evolución vuelve a la vista: entre una vez y otra se pudo guardar
    /// un diagnóstico, así que se vuelve a pedir (PAPER §28.3).
    @State private var evolutionReload = 0
    /// El episodio activo tal como está en el ERP (estado, quién lo envió, ficha): decide si
    /// se puede responder la interconsulta y precarga el formulario.
    @State private var episodeRecord: Registro?
    @State private var showAnswer = false
    @State private var answerConfirmation: String?
    @State private var showDischarge = false
    @State private var dischargeDone = false
    /// «🙋 Revisar» o «☑️ Marcar revisado» en vuelo (PAPER §38.5): los dos quedan grises.
    @State private var reviewing = false
    /// Un fallo de «🙋 Revisar» o de «☑️ Marcar revisado», con su título.
    @State private var reviewError: ReviewError?

    enum Seccion: String, CaseIterable, Identifiable {
        case chat, ficha, evolucion, imagenes

        var id: Self { self }
        var titulo: String {
            switch self {
            case .chat: "Chat"
            case .ficha: "Ficha"
            case .evolucion: "Evolución"
            case .imagenes: "Imágenes"
            }
        }
    }

    init(
        fila: FilaPaciente, seccion: Binding<Seccion>,
        onListChanged: @escaping () async -> Void = {}, alTerminar: @escaping () -> Void = {}
    ) {
        self.fila = fila
        _seccion = seccion
        self.onListChanged = onListChanged
        self.alTerminar = alTerminar
        _modelo = State(initialValue: HiloModelo(pacienteId: fila.id))
        _navigator = State(initialValue: EpisodeNavigatorModel(patientId: fila.id))
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Sección", selection: $seccion) {
                ForEach(Seccion.allCases) { Text($0.titulo).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)

            EpisodeNavigatorBar(
                model: navigator,
                onPrevious: { navigator.goPrevious() },
                onNext: { navigator.goNext() }
            )

            // La franja de la consulta (PAPER §38.2–38.4), siempre que haya una consulta
            // activa: quién la tiene a cargo, los derivados con su estado y, a la derecha, el
            // botón único «🙋 Revisar» / «✓ Revisado». El texto se toca y abre Derivar para
            // sumar o cambiar destinos.
            if modelo.episodioActivo != nil {
                HStack(spacing: 8) {
                    Button {
                        mostrarDerivar = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "person.crop.circle")
                            VStack(alignment: .leading, spacing: 2) {
                                Text(ClaimStatus.ownerLine(responsable: modelo.responsable, userId: sesion.usuario?.id))
                                    .lineLimit(1)
                                if !modelo.derivados.isEmpty || !modelo.revisados.isEmpty {
                                    Text("Derivado a \(ReviewStatus.summary(derivados: modelo.derivados, revisados: modelo.revisados))")
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    // Flujo de revisión (PAPER §38.5, §38.6): «🙋 Revisar» empieza tu revisión
                    // (sin quitarle la consulta a nadie) y aparece «☑️ Marcar revisado»; al
                    // marcarlo vuelve «🙋 Revisar» y, a la derecha, la etiqueta «✓ Revisado».
                    if reviewFlow.showReview {
                        Button {
                            Task { await startReview() }
                        } label: {
                            Text(reviewing ? "Guardando…" : "🙋 Revisar")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                        .tint(Marca.revisar)
                        .disabled(reviewing || modelo.ocupado || reviewFlow.blockReason != nil)
                        .help(reviewFlow.blockReason ?? ReviewStatus.reviewHint)
                        .accessibilityHint(reviewFlow.blockReason ?? ReviewStatus.reviewHint)
                    }
                    if reviewFlow.showMark {
                        Button {
                            Task { await markReviewed() }
                        } label: {
                            Text(reviewing ? "Guardando…" : "☑️ Marcar revisado")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                        .tint(Marca.revisar)
                        .disabled(reviewing || modelo.ocupado || reviewFlow.blockReason != nil)
                        .help(reviewFlow.blockReason ?? ReviewStatus.markHint)
                        .accessibilityHint(reviewFlow.blockReason ?? ReviewStatus.markHint)
                    }
                    // La etiqueta va a la derecha, después de los botones.
                    if reviewFlow.showReviewedLabel {
                        Text("✓ Revisado")
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.green.opacity(0.22), in: Capsule())
                            .foregroundStyle(Color.green)
                            .help(reviewedOnHint)
                            .accessibilityHint(reviewedOnHint)
                    }
                }
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .background(Marca.revisar.opacity(0.18))
                .foregroundStyle(Marca.revisar)
            }

            TabView(selection: $seccion) {
                HiloView(fila: fila, modelo: modelo)
                    .tag(Seccion.chat)

                // La ficha editable y adaptable, como la pestaña de la web (PAPER §24.2.1);
                // el documento imprimible queda detrás de «Imprimir».
                PatientFichaView(
                    patientId: fila.id,
                    name: fila.nombre,
                    episode: navigator.current
                ) { datos, episodio in
                    await modelo.enviarFormulario("ficha_save", datos: datos, episodio: episodio, api: sesion.api)
                }
                .tag(Seccion.ficha)

                PatientEvolutionView(
                    patientId: fila.id,
                    current: navigator.current,
                    reload: evolutionReload
                ) { episodio in
                    selectEpisode(episodio)
                    seccion = .ficha
                }
                .tag(Seccion.evolucion)

                ImagenesPacienteView(paciente: fila, episode: navigator.current, episodeTitle: navigator.navigation.title)
                    .tag(Seccion.imagenes)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .navigationTitle(fila.nombre)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                menuDeAcciones
            }
        }
        .task { await modelo.abrir(api: sesion.api) }
        .task { await navigator.load(api: sesion.api) }
        .task(id: modelo.episodioActivo) { await loadEpisodeRecord() }
        // El chat cambió de episodio (abrir, nueva consulta, `activar episodio`): la barra lo sigue.
        .onChange(of: modelo.episodioActivo) { _, active in
            // Si en el chat ya se pidió otro episodio, lo elegido en la barra se mantiene.
            Task { await navigator.follow(active: active, keepSelection: modelo.episodioPedido != nil, api: sesion.api) }
        }
        // Con el chat a la vista, el episodio elegido en la barra pasa al chat: cambia el
        // contenido ya y el bot lo activa en silencio (`episode_switch`). Corre al cambiar de
        // episodio en el Chat y al volver al Chat con otro elegido en otra sección.
        .task(id: ChatSyncKey(inChat: seccion == .chat, selected: navigator.selected)) { syncChatEpisode() }
        .onChange(of: seccion) { _, nueva in
            if nueva == .evolucion { evolutionReload += 1 }
        }
        // El formulario de la ficha va en una hoja: en el hilo, el teclado y el composer tapaban
        // su botón Guardar. Con auto-form encendido la hoja pasa al siguiente grupo sin cerrarse.
        .sheet(isPresented: Binding(
            get: { modelo.formulario != nil },
            set: { if !$0 { modelo.cerrarFormulario() } }
        )) {
            if let formulario = modelo.formulario {
                FormularioBotView(
                    formulario: formulario,
                    ocupado: modelo.ocupado,
                    alEnviar: { datos in
                        Task { await modelo.enviarFormulario(formulario.id, datos: datos, api: sesion.api) }
                    },
                    alMandar: { mensaje in
                        Task { await modelo.enviar(mensaje, api: sesion.api) }
                    },
                    alCerrar: { modelo.cerrarFormulario() }
                )
                // Un formulario nuevo (o el mismo con otros valores) arranca de cero.
                .id(formulario)
                .presentationDetents([.medium, .large])
                .environment(sesion)
            }
        }
        .sheet(isPresented: $showAnswer) {
            if let episodio = modelo.episodioActivo {
                ResponderInterconsultaView(episodio: episodio, inicial: episodeRecord) { notified in
                    answerConfirmation = notified
                        ? "Quedó en la ficha y en la evolución, y se avisó al médico que envió el caso."
                        : "Quedó en la ficha y en la evolución."
                    await loadEpisodeRecord()
                    await modelo.releer(api: sesion.api)
                    await onListChanged()
                }
                .environment(sesion)
            }
        }
        .sheet(isPresented: $showDischarge) {
            if let episodio = modelo.episodioActivo {
                DarDeAltaView(episodio: episodio, paciente: fila.nombre) {
                    dischargeDone = true
                    await loadEpisodeRecord()
                    await onListChanged()
                }
                .presentationDetents([.medium, .large])
                .environment(sesion)
            }
        }
        .alert("Alta registrada", isPresented: $dischargeDone) {
            Button("Aceptar", role: .cancel) {}
        } message: {
            Text(PatientDischarge.confirmation)
        }
        .alert(reviewError?.title ?? "", isPresented: Binding(
            get: { reviewError != nil },
            set: { if !$0 { reviewError = nil } }
        )) {
            Button("Aceptar", role: .cancel) {}
        } message: {
            Text(reviewError?.message ?? "")
        }
        .alert("Interconsulta respondida", isPresented: Binding(
            get: { answerConfirmation != nil },
            set: { if !$0 { answerConfirmation = nil } }
        )) {
            Button("Aceptar", role: .cancel) {}
        } message: {
            Text(answerConfirmation ?? "")
        }
        .sheet(isPresented: $mostrarSecciones) {
            SeccionesView(marcadores: modelo.marcadores) { marcador in
                seccion = .chat
                Task { await modelo.abrirSeccion(marcador, api: sesion.api) }
            }
        }
        .sheet(isPresented: $mostrarDerivar) {
            DerivarView(
                yaDerivados: modelo.derivados,
                alDerivar: { comando in
                    guard await modelo.enviar(comando, api: sesion.api, accionExplicita: true) else {
                        return modelo.error ?? "No se pudo derivar."
                    }
                    mostrarDerivar = false
                    await modelo.releerDerivaciones(api: sesion.api)
                    alTerminar()
                    return nil
                }
            )
            .environment(sesion)
        }
    }

    private func selectEpisode(_ episode: String) {
        navigator.select(episode)
    }

    private func syncChatEpisode() {
        guard let episode = EpisodeNavigation.chatSwitch(
            selected: navigator.selected, shown: modelo.episodioALaVista, inChat: seccion == .chat
        ) else { return }
        // En una tarea del modelo, no de la vista: elegir otro episodio relanza esta
        // `.task(id:)`, y la cancelación cortaría el pedido a mitad.
        let api = sesion.api
        Task { await modelo.cambiarEpisodio(episode, api: api) }
    }

    private func loadEpisodeRecord() async {
        let episodio = modelo.episodioActivo
        episodeRecord = nil
        guard let episodio else { return }
        // Sin datos el botón queda deshabilitado con su motivo ("Cargando…").
        let registro = try? await sesion.api.entidad(episodio)
        if modelo.episodioActivo == episodio { episodeRecord = registro }
    }

    private var answerBlockReason: String? {
        Interconsulta.blockReason(
            episode: modelo.episodioActivo, episodeData: episodeRecord, userId: sesion.usuario?.id
        )
    }

    /// El flujo de revisión (PAPER §38.5, §38.6). El estado de la consulta sale del registro
    /// del episodio.
    private var reviewFlow: ReviewStatus.Flow {
        ReviewStatus.flow(
            episode: modelo.episodioActivo,
            viewingActive: navigator.current == nil || navigator.current == modelo.episodioActivo,
            episodeLoaded: episodeRecord != nil,
            episodeStatus: episodeRecord?["estado"],
            derivados: modelo.derivados,
            myReview: modelo.myReview,
            canClaim: modelo.canClaim,
            userId: sesion.usuario?.id
        )
    }

    /// «Lo revisaste el 19/11/26, 11:00».
    private var reviewedOnHint: String {
        guard let fecha = Fechas.iso(modelo.myReview.reviewedAt) else { return "Ya lo revisaste" }
        return "Lo revisaste el \(fecha.formatted(date: .numeric, time: .shortened))"
    }

    /// «🙋 Revisar» (PAPER §38.6): anota que empecé a revisar (`start_review`), sin
    /// confirmación ni cambiar el responsable, el estado o las derivaciones de otros. Relee la
    /// franja y la lista (entra en «Mis pacientes»). Aparece «☑️ Marcar revisado».
    private func startReview() async {
        guard let episodio = modelo.episodioActivo, reviewFlow.blockReason == nil, !reviewing else { return }
        reviewing = true
        defer { reviewing = false }
        do {
            try await sesion.api.startReview(episode: episodio)
        } catch {
            reviewError = ReviewError(title: "No se pudo empezar la revisión", message: error.localizedDescription)
            return
        }
        await modelo.releerDerivaciones(api: sesion.api)
        await onListChanged()
    }

    /// «☑️ Marcar revisado»: apaga mi «revisar» y deja la etiqueta «✓ Revisado». Relee la franja y la lista (sale de «revisar»).
    private func markReviewed() async {
        guard let episodio = modelo.episodioActivo, reviewFlow.blockReason == nil, !reviewing else { return }
        reviewing = true
        defer { reviewing = false }
        do {
            try await sesion.api.markReviewed(episode: episodio)
        } catch {
            reviewError = ReviewError(title: "No se pudo marcar como revisado", message: error.localizedDescription)
            return
        }
        await modelo.releerDerivaciones(api: sesion.api)
        await onListChanged()
    }

    private var dischargeBlockReason: String? {
        PatientDischarge.blockReason(episode: modelo.episodioActivo, episodeData: episodeRecord)
    }

    /// Lo que todavía no está se ve, gris y con la razón (CLAUDE.md: nunca ocultes un botón).
    private var enLaActual: Bool {
        let episodios = modelo.episodios
        return episodios.esActiva(indice: episodios.indice(de: modelo.pagina), activo: modelo.episodioActivo)
    }

    private var menuDeAcciones: some View {
        Menu {
            // Una ficha por motivo de consulta (PAPER §28.4): un control del mismo motivo es
            // «＋ Agregar evolución» en la sección Evolución.
            Button {
                seccion = .chat
                Task { await modelo.enviar("nuevo episodio", api: sesion.api, accionExplicita: true) }
            } label: {
                Label("＋ Nueva consulta", systemImage: "plus.bubble")
                Text("Para otro motivo de consulta; para un control, «＋ Agregar evolución»")
            }
            .disabled(modelo.ocupado)
            Section("Ficha") {
                Button {
                    seccion = .chat
                    mostrarSecciones = true
                } label: {
                    Label("Secciones de la ficha", systemImage: "list.bullet.rectangle")
                    if modelo.marcadores.isEmpty {
                        Text("Disponibles al abrir la consulta")
                    } else if !enLaActual {
                        Text("Solo en la consulta actual")
                    }
                }
                .disabled(modelo.ocupado || modelo.marcadores.isEmpty || !enLaActual)
                Button {
                    Task { await modelo.alternarAutoFormulario(api: sesion.api) }
                } label: {
                    Label(modelo.autoFormulario ? "Auto-form encendido" : "Auto-form apagado",
                          systemImage: modelo.autoFormulario ? "repeat.circle.fill" : "repeat.circle")
                    Text(modelo.autoFormulario ? "Pide la siguiente sección faltante" : "Solo muestra la sección que abras")
                }
                .disabled(modelo.ocupado || !enLaActual)
                Button("Evolución del paciente", systemImage: "chart.line.uptrend.xyaxis") { seccion = .evolucion }
            }
            Button {
                showAnswer = true
            } label: {
                Label("Responder interconsulta", systemImage: "checkmark.bubble")
                Text(answerBlockReason ?? "Queda en la ficha y le llega al médico que envió el caso")
            }
            .disabled(modelo.ocupado || answerBlockReason != nil)
            // Los mismos botones de la franja (PAPER §38.5).
            if reviewFlow.showReview {
                Button {
                    Task { await startReview() }
                } label: {
                    Text("🙋 Revisar")
                    Text(reviewFlow.blockReason ?? ReviewStatus.reviewHint)
                }
                .disabled(reviewing || modelo.ocupado || reviewFlow.blockReason != nil)
            }
            if reviewFlow.showMark {
                Button {
                    Task { await markReviewed() }
                } label: {
                    Text("☑️ Marcar revisado")
                    Text(reviewFlow.blockReason ?? ReviewStatus.markHint)
                }
                .disabled(reviewing || modelo.ocupado || reviewFlow.blockReason != nil)
            }
            Button {
                showDischarge = true
            } label: {
                Label("🏁 Dar de alta", systemImage: "flag.checkered")
                Text(dischargeBlockReason ?? "Cierra el caso; si vuelve, es una consulta nueva")
            }
            .disabled(modelo.ocupado || dischargeBlockReason != nil)
            Button("Derivar", systemImage: "arrowshape.turn.up.right") { mostrarDerivar = true }
                .disabled(modelo.ocupado)
        } label: {
            Label("Acciones", systemImage: "ellipsis.circle")
        }
    }
}

/// El fallo de «🙋 Revisar» o de «☑️ Marcar revisado».
private struct ReviewError: Equatable {
    let title: String
    let message: String
}

/// Lo que decide si hay que llevar el chat al episodio elegido en la barra.
private struct ChatSyncKey: Equatable {
    let inChat: Bool
    let selected: String?
}
