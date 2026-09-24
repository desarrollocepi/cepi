import SwiftUI

/// Un paciente abierto: tres secciones que se pasan deslizando (PAPER §24.2.1, D-Aux-22).
///
///   Chat · Ficha · Imágenes
///
/// El modelo del hilo vive acá y no en el chat: la ficha guarda con él (`ficha_save`) y las
/// acciones (nueva consulta, secciones, derivar) valen desde cualquier sección.
struct PacienteView: View {
    let fila: FilaPaciente
    /// Cierra el paciente (tras derivar, el médico pasa al siguiente).
    let alTerminar: () -> Void

    @Environment(Sesion.self) private var sesion
    @State private var modelo: HiloModelo
    @State private var seccion: Seccion = .chat
    @State private var mostrarSecciones = false
    @State private var mostrarDerivar = false

    enum Seccion: String, CaseIterable, Identifiable {
        case chat, ficha, imagenes

        var id: Self { self }
        var titulo: String {
            switch self {
            case .chat: "Chat"
            case .ficha: "Ficha"
            case .imagenes: "Imágenes"
            }
        }
    }

    init(fila: FilaPaciente, alTerminar: @escaping () -> Void = {}) {
        self.fila = fila
        self.alTerminar = alTerminar
        _modelo = State(initialValue: HiloModelo(pacienteId: fila.id))
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Sección", selection: $seccion) {
                ForEach(Seccion.allCases) { Text($0.titulo).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)

            // A quién está derivada la consulta, mientras haya alguien pendiente. Se toca y
            // abre Derivar para sumar o cambiar destinos.
            if !modelo.derivados.isEmpty {
                Button {
                    mostrarDerivar = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.turn.up.right")
                        Text("Derivado a \(modelo.derivados.map(\.comoSeLlama).joined(separator: ", "))")
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(Marca.revisar.opacity(0.18))
                    .foregroundStyle(Marca.revisar)
                }
                .buttonStyle(.plain)
            }

            TabView(selection: $seccion) {
                HiloView(fila: fila, modelo: modelo)
                    .tag(Seccion.chat)

                VisorFicha(
                    pacienteId: fila.id,
                    nombre: fila.nombre,
                    episodioActivo: modelo.episodioActivo,
                    embebido: true
                ) { datos, episodio in
                    await modelo.enviarFormulario("ficha_save", datos: datos, episodio: episodio, api: sesion.api)
                }
                .tag(Seccion.ficha)

                ImagenesPacienteView(paciente: fila)
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
                seccion = .chat
                Task { await modelo.abrirSeccion(marcador, api: sesion.api) }
            }
        }
        .sheet(isPresented: $mostrarDerivar) {
            DerivarView(
                yaDerivados: modelo.derivados,
                alDerivar: { comando in
                    guard await modelo.enviar(comando, api: sesion.api) else {
                        return modelo.error ?? "No se pudo derivar."
                    }
                    mostrarDerivar = false
                    await modelo.releerDerivaciones(api: sesion.api)
                    alTerminar()
                    return nil
                },
                responsable: { await modelo.responsableDelCaso(api: sesion.api) }
            )
            .environment(sesion)
        }
    }

    /// Lo que todavía no está se ve, gris y con la razón (CLAUDE.md: nunca ocultes un botón).
    private var enLaActual: Bool {
        let episodios = modelo.episodios
        return episodios.esActiva(indice: episodios.indice(de: modelo.pagina), activo: modelo.episodioActivo)
    }

    private var menuDeAcciones: some View {
        Menu {
            Button("Nueva consulta", systemImage: "plus.bubble") {
                seccion = .chat
                Task { await modelo.enviar("nuevo episodio", api: sesion.api) }
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
            }
            Button("Derivar", systemImage: "arrowshape.turn.up.right") { mostrarDerivar = true }
                .disabled(modelo.ocupado)
        } label: {
            Label("Acciones", systemImage: "ellipsis.circle")
        }
    }
}
