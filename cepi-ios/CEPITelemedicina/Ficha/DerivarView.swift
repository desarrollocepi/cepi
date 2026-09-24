import SwiftUI

/// Derivar el episodio a círculos y/o personas — varios a la vez — o al responsable del caso.
/// Se marcan los destinos y un botón los manda en una sola derivación:
/// `derivar a <slug>, <uuid>, … [motivo]`. A quien ya está derivado se le muestra la marca y
/// no se lo puede volver a elegir.
struct DerivarView: View {
    /// A quién está derivado el caso ahora (para marcarlo y no duplicarlo).
    var yaDerivados: [Derivado] = []
    /// Envía el comando; devuelve el error, o `nil` si el bot lo procesó.
    let alDerivar: (String) async -> String?
    let responsable: () async -> String?

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var grupos: [GrupoDerivacion] = []
    @State private var miembros: [String: [MiembroGrupo]] = [:]
    @State private var expandido: String?
    /// Destinos marcados: `circulo:<slug>` o `persona:<uuid>`.
    @State private var seleccion: Set<String> = []
    @State private var motivo = ""
    @State private var cargando = true
    @State private var enviando = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Motivo de la derivación (opcional)", text: $motivo, axis: .vertical)
                } footer: {
                    Text(yaDerivados.isEmpty
                         ? "Marca uno o varios destinos y toca Derivar."
                         : "Ahora está derivado a \(yaDerivados.map(\.comoSeLlama).joined(separator: ", ")). Marca más destinos para sumar.")
                }

                Section {
                    Button("Al responsable del caso", systemImage: "star") {
                        Task { await alResponsable() }
                    }
                }

                Section("Círculos y especialidades") {
                    if cargando {
                        ProgressView()
                    } else if grupos.isEmpty {
                        Text("Ningún círculo tiene miembros en esta organización.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(grupos) { grupo in
                        filaGrupo(grupo)
                    }
                }

                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .disabled(enviando)
            .navigationTitle("Derivar episodio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { cerrar() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(seleccion.isEmpty ? "Derivar" : "Derivar (\(seleccion.count))") {
                        Task { await derivarSeleccion() }
                    }
                    .disabled(seleccion.isEmpty || enviando)
                }
            }
            .task { await cargarGrupos() }
            .task(id: expandido) { await cargarMiembros() }
        }
    }

    @ViewBuilder
    private func filaGrupo(_ grupo: GrupoDerivacion) -> some View {
        let todaLaRed = grupo.tipo == "all"
        let token = "circulo:\(grupo.slug)"
        Button {
            alternar(token)
        } label: {
            HStack {
                Image(systemName: seleccion.contains(token) ? "checkmark.square.fill" : "square")
                    .foregroundStyle(seleccion.contains(token) ? Marca.acento : .secondary)
                Label(grupo.nombre, systemImage: todaLaRed ? "globe" : "circle.circle")
                Spacer()
                Text(todaLaRed ? "toda la red" : (grupo.tipo ?? ""))
                    .font(.caption2)
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                Text("\(grupo.miembros)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        // Todos los destinos se abren para elegir a alguien, "toda la red" incluida: ahí
        // está quien no pertenece a ningún círculo.
        DisclosureGroup(
            isExpanded: Binding(
                get: { expandido == grupo.slug },
                set: { expandido = $0 ? grupo.slug : nil }
            )
        ) {
            let personas = miembros[grupo.slug] ?? []
            if personas.isEmpty {
                Text("(sin miembros)").foregroundStyle(.secondary)
            }
            ForEach(personas) { persona in
                let token = "persona:\(persona.usuario)"
                let ya = yaDerivados.contains { $0.usuario == persona.usuario }
                Button {
                    alternar(token)
                } label: {
                    HStack {
                        Image(systemName: ya ? "checkmark.circle.fill"
                                            : (seleccion.contains(token) ? "checkmark.square.fill" : "square"))
                            .foregroundStyle(ya ? Color.green : (seleccion.contains(token) ? Marca.acento : .secondary))
                        Label(persona.nombre ?? persona.email ?? "Profesional", systemImage: "person")
                        Spacer()
                        if ya {
                            Text("ya derivado").font(.caption2).foregroundStyle(.secondary)
                        } else if let rol = persona.rol {
                            Text(rol).font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
                        }
                    }
                }
                .disabled(ya)
            }
        } label: {
            Text(todaLaRed ? "Personas de la organización" : "Personas de \(grupo.nombre)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func cargarGrupos() async {
        defer { cargando = false }
        do {
            // Sin el turno de guardia: eso es "enviar caso", no derivar. "Toda la red" primero.
            // Un círculo sin nadie de esta organización no se ofrece: derivar ahí no llega a
            // nadie y el backend lo rechaza. Es la excepción a "nunca ocultes un botón".
            grupos = try await sesion.api.grupos()
                .filter { $0.tipo != "roster" && $0.miembros > 0 }
                .sorted { ($0.tipo == "all" ? 0 : 1) < ($1.tipo == "all" ? 0 : 1) }
        } catch {
            self.error = "No se pudieron cargar los destinos: \(error.localizedDescription)"
        }
    }

    private func cargarMiembros() async {
        guard let slug = expandido, miembros[slug] == nil else { return }
        miembros[slug] = (try? await sesion.api.miembros(grupo: slug)) ?? []
    }

    private func alResponsable() async {
        guard let usuario = await responsable() else {
            error = "El episodio no tiene responsable ni creador definido."
            return
        }
        await derivar("escalar a \(usuario)")
    }

    private func alternar(_ token: String) {
        if seleccion.contains(token) { seleccion.remove(token) } else { seleccion.insert(token) }
    }

    /// Todo lo marcado en una sola derivación: el bot acepta la lista separada por comas.
    private func derivarSeleccion() async {
        let destinos = seleccion.map { String($0.split(separator: ":", maxSplits: 1)[1]) }.sorted()
        guard !destinos.isEmpty else { return }
        await derivar("derivar a \(destinos.joined(separator: ", "))")
    }

    private func derivar(_ comando: String) async {
        enviando = true
        defer { enviando = false }
        let detalle = motivo.trimmingCharacters(in: .whitespacesAndNewlines)
        error = await alDerivar(detalle.isEmpty ? comando : "\(comando) \(detalle)")
    }
}
