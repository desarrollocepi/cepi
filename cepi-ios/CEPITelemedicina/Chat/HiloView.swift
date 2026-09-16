import PhotosUI
import SwiftUI

/// El hilo de un paciente: sus consultas, los mensajes de todos, la ficha que se llena por
/// secciones y el composer. Equivale a IntakeChat.vue.
struct HiloView: View {
    let fila: FilaPaciente
    /// Cierra el hilo (tras derivar, el médico pasa al siguiente paciente).
    let alTerminar: () -> Void

    @Environment(Sesion.self) private var sesion
    @State private var modelo: HiloModelo
    @State private var borrador = ""
    @State private var fotoElegida: PhotosPickerItem?
    @State private var camaraAbierta = false
    @State private var imagenAbierta: ImagenAbierta?
    @State private var mostrarSecciones = false
    @State private var mostrarDerivar = false
    @State private var mostrarFicha = false

    private static let fin = "fin-del-hilo"

    init(fila: FilaPaciente, alTerminar: @escaping () -> Void = {}) {
        self.fila = fila
        self.alTerminar = alTerminar
        _modelo = State(initialValue: HiloModelo(pacienteId: fila.id))
    }

    var body: some View {
        let episodios = modelo.episodios
        let indice = episodios.indice(de: modelo.pagina)
        let visibles = episodios.visibles(modelo.mensajes, indice: indice)
        let enLaActual = episodios.esActiva(indice: indice, activo: modelo.episodioActivo)

        VStack(spacing: 0) {
            barraDeConsultas(episodios, indice: indice, enLaActual: enLaActual)
            feed(visibles, enLaActual: enLaActual)
        }
        .safeAreaInset(edge: .bottom) {
            if enLaActual {
                Composer(
                    texto: $borrador,
                    ocupado: modelo.ocupado,
                    subiendo: modelo.subiendo,
                    adjunto: modelo.adjunto,
                    fotoElegida: $fotoElegida,
                    alTomarFoto: { camaraAbierta = true },
                    alQuitarAdjunto: { modelo.quitarAdjunto() },
                    alEnviar: enviarBorrador
                )
            } else {
                HStack {
                    Label("Consulta anterior — solo lectura", systemImage: "eye")
                        .font(.footnote.weight(.medium))
                    Spacer()
                    Button("Volver a la actual") { modelo.volverALaActual() }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
                .padding(12)
                .background(Color.yellow.opacity(0.18))
            }
        }
        .navigationTitle(fila.nombre)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                menuDeAcciones
            }
        }
        .task { await modelo.abrir(api: sesion.api) }
        .onChange(of: fotoElegida) { _, item in
            guard let item else { return }
            fotoElegida = nil
            Task {
                guard let datos = try? await item.loadTransferable(type: Data.self),
                      let jpeg = await FotoClinica.jpeg(desde: datos) else {
                    modelo.error = "No se pudo leer la foto elegida."
                    return
                }
                await modelo.subir(jpeg, nombre: FotoClinica.nombreNuevo(), api: sesion.api)
            }
        }
        .fullScreenCover(isPresented: $camaraAbierta) {
            CamaraView { imagen in
                Task {
                    guard let datos = imagen.jpegData(compressionQuality: 0.95),
                          let jpeg = await FotoClinica.jpeg(desde: datos) else { return }
                    await modelo.subir(jpeg, nombre: FotoClinica.nombreNuevo(), api: sesion.api)
                }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(item: $imagenAbierta) { imagen in
            VisorImagen(id: imagen.id)
                .environment(sesion)
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
        .sheet(isPresented: $mostrarSecciones) {
            SeccionesView(marcadores: modelo.marcadores) { marcador in
                Task { await modelo.abrirSeccion(marcador, api: sesion.api) }
            }
        }
        .sheet(isPresented: $mostrarDerivar) {
            DerivarView(
                alDerivar: { comando in
                    guard await modelo.enviar(comando, api: sesion.api) else {
                        return modelo.error ?? "No se pudo derivar."
                    }
                    mostrarDerivar = false
                    alTerminar()
                    return nil
                },
                responsable: { await modelo.responsableDelCaso(api: sesion.api) }
            )
            .environment(sesion)
        }
        .fullScreenCover(isPresented: $mostrarFicha) {
            VisorFicha(pacienteId: fila.id, nombre: fila.nombre, episodioActivo: modelo.episodioActivo) { datos, episodio in
                await modelo.enviarFormulario("ficha_save", datos: datos, episodio: episodio, api: sesion.api)
            }
            .environment(sesion)
        }
    }

    private func barraDeConsultas(_ episodios: Episodios, indice: Int, enLaActual: Bool) -> some View {
        HStack(spacing: 10) {
            Button { modelo.irAnterior() } label: {
                Image(systemName: "chevron.left")
            }
            .disabled(modelo.ocupado || indice <= 0)
            .accessibilityLabel("Consulta anterior")

            Text(episodios.etiqueta(indice: indice, mensajes: modelo.mensajes))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Button { modelo.irSiguiente() } label: {
                Image(systemName: "chevron.right")
            }
            .disabled(modelo.ocupado || indice >= episodios.orden.count - 1)
            .accessibilityLabel("Consulta siguiente")

            Button("Actual", systemImage: "arrow.uturn.forward") { modelo.volverALaActual() }
                .disabled(modelo.ocupado || enLaActual)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }

    private func feed(_ visibles: [MensajeHilo], enLaActual: Bool) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                // VStack y no LazyVStack: el lazy estima las alturas de lo que todavía no midió,
                // y "ir al final" quedaba corto, con el último mensaje fuera de la pantalla
                // (medido con un UI test). Una página es una sola consulta: pocos mensajes, y las
                // imágenes tienen tamaño fijo.
                VStack(alignment: .leading, spacing: 10) {
                    if visibles.isEmpty && !modelo.ocupado {
                        Text("Escribe o pega un texto con los datos del paciente y la IA los carga en la ficha. También puedes conversar normalmente; antes de guardar se pide confirmación.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    }
                    ForEach(visibles.indices, id: \.self) { indice in
                        BurbujaMensaje(
                            mensaje: visibles[indice],
                            autor: Episodios.autor(en: visibles, indice: indice)
                        ) { id in
                            imagenAbierta = ImagenAbierta(id: id)
                        }
                    }
                    if modelo.ocupado {
                        Text("escribiendo…")
                            .italic()
                            .foregroundStyle(.secondary)
                    }
                    if !modelo.respuestasRapidas.isEmpty && !modelo.ocupado {
                        botonesDeRespuesta
                    }
                    if let pendiente = modelo.pendiente {
                        tarjetaPendiente(pendiente)
                    }
                    if let error = modelo.error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(Self.fin)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .pegadoAlFinal()
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await modelo.releer(api: sesion.api) }
            .onChange(of: modelo.mensajes.count) { bajar(proxy) }
            .onChange(of: modelo.ocupado) { bajar(proxy) }
            .onChange(of: modelo.pagina) { bajar(proxy) }
        }
    }

    private var botonesDeRespuesta: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(modelo.respuestasRapidas, id: \.self) { respuesta in
                    Button(respuesta.label) {
                        Task { await modelo.enviar(respuesta.send, api: sesion.api) }
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                }
            }
        }
    }

    private func tarjetaPendiente(_ pendiente: AccionPendiente) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(pendiente.summary)
                .font(.callout)
            HStack {
                Button("Confirmar", systemImage: "checkmark") {
                    Task { await modelo.enviar("sí", api: sesion.api) }
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                Button("Cancelar", systemImage: "xmark") {
                    Task { await modelo.enviar("no", api: sesion.api) }
                }
                .buttonStyle(.bordered)
            }
            .disabled(modelo.ocupado)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yellow.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.yellow, lineWidth: 2))
    }

    /// Lo que todavía no está se ve, gris y con la fase en la que llega (CLAUDE.md: nunca
    /// ocultes un botón).
    private var enLaActualMenu: Bool {
        let episodios = modelo.episodios
        return episodios.esActiva(indice: episodios.indice(de: modelo.pagina), activo: modelo.episodioActivo)
    }

    private var menuDeAcciones: some View {
        Menu {
            Button("Nueva consulta", systemImage: "plus.bubble") {
                Task { await modelo.enviar("nuevo episodio", api: sesion.api) }
            }
            .disabled(modelo.ocupado)
            Section("Ficha") {
                Button { mostrarSecciones = true } label: {
                    Label("Secciones de la ficha", systemImage: "list.bullet.rectangle")
                    if modelo.marcadores.isEmpty {
                        Text("Disponibles al abrir la consulta")
                    } else if !enLaActualMenu {
                        Text("Solo en la consulta actual")
                    }
                }
                .disabled(modelo.ocupado || modelo.marcadores.isEmpty || !enLaActualMenu)
                Button {
                    Task { await modelo.alternarAutoFormulario(api: sesion.api) }
                } label: {
                    Label(modelo.autoFormulario ? "Auto-form encendido" : "Auto-form apagado",
                          systemImage: modelo.autoFormulario ? "repeat.circle.fill" : "repeat.circle")
                    Text(modelo.autoFormulario ? "Pide la siguiente sección faltante" : "Solo muestra la sección que abras")
                }
                .disabled(modelo.ocupado || !enLaActualMenu)
                Button("Ver ficha", systemImage: "doc.text.magnifyingglass") { mostrarFicha = true }
                    .disabled(modelo.ocupado)
            }
            Button("Derivar", systemImage: "arrowshape.turn.up.right") { mostrarDerivar = true }
                .disabled(modelo.ocupado)
        } label: {
            Label("Acciones", systemImage: "ellipsis.circle")
        }
    }

    private func enviarBorrador() {
        let texto = borrador
        borrador = ""
        Task { await modelo.enviar(texto, api: sesion.api) }
    }

    private func bajar(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(Self.fin, anchor: .bottom)
        }
    }
}

struct ImagenAbierta: Identifiable {
    let id: String
}

private extension View {
    /// El hilo arranca en el último mensaje y, desde iOS 18, sigue ahí cuando el contenido cambia
    /// de tamaño (texto que se reacomoda, una imagen que termina de cargar).
    @ViewBuilder
    func pegadoAlFinal() -> some View {
        if #available(iOS 18.0, *) {
            defaultScrollAnchor(.bottom).defaultScrollAnchor(.bottom, for: .sizeChanges)
        } else {
            defaultScrollAnchor(.bottom)
        }
    }
}
