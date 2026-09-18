import SwiftUI

/// Lista de pacientes y, al elegir uno, su hilo. En iPhone es una pila; en iPad, lista y
/// detalle lado a lado. Equivale a ChatShell.vue + ChatList.vue.
struct PacientesView: View {
    @Environment(Sesion.self) private var sesion
    @Environment(\.scenePhase) private var fase
    @State private var modelo = PacientesModelo()
    @State private var seleccion: FilaPaciente.ID?
    @State private var busqueda = ""
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
        let filas = modelo.filtradas(por: busqueda)
        return List(filas, selection: $seleccion) { fila in
            PacienteFila(
                fila: fila,
                revision: modelo.revision[fila.id],
                asignacion: modelo.asignaciones[fila.id]
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
                if busqueda.isEmpty {
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
        .disabled(sesion.cambiandoOrganizacion)
        .searchable(text: $busqueda, prompt: "Buscar paciente o cédula")
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

private struct Recarga: Equatable {
    let activa: Bool
    let organizacion: String?
}
