import SwiftUI

/// Lista de pacientes y, al elegir uno, su hilo. En iPhone es una pila; en iPad, lista y
/// detalle lado a lado. Equivale a ChatShell.vue + ChatList.vue.
struct PacientesView: View {
    @Environment(Sesion.self) private var sesion
    @Environment(\.scenePhase) private var fase
    @State private var modelo = PacientesModelo()
    @State private var seleccion: FilaPaciente.ID?
    @State private var busqueda = ""
    @State private var estadoElegido: EstadoFicha?
    @State private var creando = false
    @State private var confirmarBorrado = false
    @State private var aBorrar: FilaPaciente?
    @State private var errorOrganizacion: String?

    var body: some View {
        NavigationSplitView {
            lista
        } detail: {
            if let id = seleccion, let fila = modelo.fila(id) {
                // `.id`: otro paciente es otro hilo, con su estado desde cero.
                PacienteView(fila: fila) { seleccion = nil }
                    .id(fila.id)
            } else {
                ContentUnavailableView(
                    "Elige un paciente",
                    systemImage: "person.text.rectangle",
                    description: Text("Su hilo y su ficha se abren aquí.")
                )
            }
        }
        // Recarga al volver a primer plano, al cambiar de organización y cada 20 s mientras
        // está visible: una derivación nueva sube con "revisar" sin tocar nada (ChatList.vue).
        .task(id: Recarga(activa: fase == .active, organizacion: sesion.usuario?.orgActiva)) {
            modelo.usarOrganizacion(sesion.usuario?.orgActiva)
            guard fase == .active else { return }
            while !Task.isCancelled {
                await modelo.cargar(api: sesion.api)
                try? await Task.sleep(for: .seconds(20))
            }
        }
        // El paciente abierto es de la org anterior: se cierra al cambiar.
        .onChange(of: sesion.usuario?.orgActiva) { seleccion = nil }
        .eliminarCuenta(confirmar: $confirmarBorrado)
        .alert("¿Eliminar a \(aBorrar?.nombre ?? "")?", isPresented: Binding(
            get: { aBorrar != nil },
            set: { if !$0 { aBorrar = nil } }
        )) {
            Button("Eliminar", role: .destructive) {
                if let fila = aBorrar { Task { await borrar(fila) } }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("El paciente deja de aparecer en las listas. Su historia clínica se conserva, y si se lo crea de nuevo con la misma cédula vuelve con lo que tenía.")
        }
        .alert("No se pudo cambiar de organización", isPresented: Binding(
            get: { errorOrganizacion != nil },
            set: { if !$0 { errorOrganizacion = nil } }
        )) {
            Button("Aceptar", role: .cancel) {}
        } message: {
            Text(errorOrganizacion ?? "")
        }
        .sheet(isPresented: $creando) {
            NuevoPacienteView { registro in
                modelo.insertar(registro)
                seleccion = registro.id
                await modelo.cargar(api: sesion.api)
            }
        }
        #if DEBUG
        // Solo Debug: `CEPI_DEV_PACIENTE=<id>` abre ese hilo al entrar, para probar en el
        // simulador sin tocar la pantalla (como el ingreso automático del login).
        .onAppear {
            if seleccion == nil { seleccion = ProcessInfo.processInfo.environment["CEPI_DEV_PACIENTE"] }
        }
        #endif
    }

    private var lista: some View {
        let filas = modelo.filtradas(por: busqueda, estado: estadoElegido)
        return List(filas, selection: $seleccion) { fila in
            PacienteFila(
                fila: fila,
                revision: modelo.revision[fila.id],
                asignacion: modelo.asignaciones[fila.id],
                estado: modelo.estado(fila.id)
            )
            // Borrar un paciente es de supermédico (D-Aux-23). Quien no puede, no lo ve: es
            // la excepción por permisos de la regla de no ocultar botones.
            .swipeActions(edge: .trailing) {
                if puedeBorrarPacientes {
                    Button("Eliminar", systemImage: "trash", role: .destructive) { aBorrar = fila }
                }
            }
        }
        .overlay {
            if sesion.cambiandoOrganizacion {
                ProgressView("Cambiando de organización…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.background.opacity(0.85))
            } else if !modelo.cargado {
                if let error = modelo.error {
                    ContentUnavailableView {
                        Label("No se pudo cargar la lista", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Reintentar") { Task { await modelo.cargar(api: sesion.api) } }
                    }
                } else {
                    ProgressView("Cargando pacientes…")
                }
            } else if filas.isEmpty {
                if let estado = estadoElegido, busqueda.isEmpty {
                    ContentUnavailableView(
                        "Ningún paciente en «\(estado.etiqueta)»",
                        systemImage: "line.3.horizontal.decrease.circle",
                        description: Text("Elige otro estado o «Todos».")
                    )
                } else if busqueda.isEmpty {
                    ContentUnavailableView(
                        "No hay pacientes",
                        systemImage: "person.2",
                        description: Text("Crea el primero con el botón de alta.")
                    )
                } else {
                    ContentUnavailableView.search(text: busqueda)
                }
            }
        }
        // Debajo del buscador: por eso el buscador va fijo arriba y no escondido al desplazar.
        .safeAreaInset(edge: .top, spacing: 0) {
            FiltroEstados(
                elegido: $estadoElegido,
                conteo: modelo.conteoPorEstado(),
                total: modelo.filas.count
            )
            .disabled(!modelo.cargado)
        }
        .disabled(sesion.cambiandoOrganizacion)
        .searchable(
            text: $busqueda,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Buscar paciente o cédula"
        )
        .refreshable { await modelo.cargar(api: sesion.api) }
        .navigationTitle("Pacientes")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                MenuCuenta(confirmarBorrado: $confirmarBorrado, errorOrganizacion: $errorOrganizacion)
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Nuevo paciente", systemImage: "person.badge.plus") { creando = true }
            }
        }
    }
}

private extension PacientesView {
    /// El backend es quien manda; esto solo decide si se ofrece la acción.
    var puedeBorrarPacientes: Bool {
        let permisos = sesion.usuario?.permissions ?? []
        return permisos.contains("*:*:*:*")
            || permisos.contains("entity:\(CEPIAPI.definicionPaciente):record:delete")
    }

    func borrar(_ fila: FilaPaciente) async {
        aBorrar = nil
        if seleccion == fila.id { seleccion = nil }
        do {
            try await sesion.api.eliminarPaciente(fila.id)
            await modelo.cargar(api: sesion.api)
        } catch {
            modelo.mostrarError("No se pudo eliminar a \(fila.nombre): \(error.localizedDescription)")
        }
    }
}

/// Los estados de la ficha como filtro, debajo del buscador. Cada botón lleva su LED y cuántos
/// pacientes hay: es también la leyenda de los colores. Un estado sin pacientes se ve gris, no
/// se esconde (nunca ocultes un botón). Tocar el elegido lo suelta.
private struct FiltroEstados: View {
    @Binding var elegido: EstadoFicha?
    let conteo: [EstadoFicha: Int]
    let total: Int

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                boton("Todos · \(total)", led: nil, activo: elegido == nil, habilitado: true) {
                    elegido = nil
                }
                ForEach(EstadoFicha.allCases) { estado in
                    let cuantos = conteo[estado] ?? 0
                    boton(
                        "\(estado.etiqueta) · \(cuantos)",
                        led: estado,
                        activo: elegido == estado,
                        habilitado: cuantos > 0 || elegido == estado
                    ) {
                        elegido = elegido == estado ? nil : estado
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(.bar)
    }

    private func boton(
        _ titulo: String, led: EstadoFicha?, activo: Bool, habilitado: Bool, accion: @escaping () -> Void
    ) -> some View {
        Button(action: accion) {
            HStack(spacing: 6) {
                if let led { LedEstado(estado: led, tamano: 10) }
                Text(titulo)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .foregroundStyle(activo ? Color.white : Color.primary)
            .background(
                activo ? AnyShapeStyle(Marca.acento) : AnyShapeStyle(HierarchicalShapeStyle.quaternary),
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .disabled(!habilitado)
        .opacity(habilitado ? 1 : 0.45)
        .accessibilityAddTraits(activo ? .isSelected : [])
    }
}

private struct Recarga: Equatable {
    let activa: Bool
    let organizacion: String?
}
