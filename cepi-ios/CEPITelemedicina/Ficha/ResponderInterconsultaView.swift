import SwiftUI

/// Reglas de «Responder interconsulta» (PAPER §30), las mismas que `responderMotivo` en
/// `IntakeChat.vue` y que el 409 de cepi-bot (`interconsulta.ts`). Sin UI, para probarlas.
enum Interconsulta {
    /// Estados en los que el caso espera a un especialista.
    static let pendingStates: Set<String> = ["enviada", "en_triage", "derivada", "en_revisión_solicitada"]

    /// Por qué hoy no se puede responder, o `nil` si se puede. El botón nunca se esconde: se
    /// deshabilita con este texto a la vista.
    static func blockReason(episode: String?, episodeData: Registro?, userId: String?) -> String? {
        guard episode != nil else { return "Este paciente no tiene una consulta abierta" }
        guard let datos = episodeData else { return "Cargando el estado de la consulta…" }
        let estado = datos["estado"]
        if estado == "respondida" { return "Esta interconsulta ya fue respondida" }
        // El responsable de turno del caso nuevo responde aunque no se haya enviado (PAPER §32.2.1).
        let isResponsible = userId != nil && datos["responsable_actual_id"] == userId && estado != "cerrado"
        guard isResponsible || estado.map(pendingStates.contains) == true else {
            return "Esta consulta no tiene una interconsulta pendiente"
        }
        if let userId, (datos["medico_primario_id"] ?? datos["medico_id"]) == userId {
            return "Tú ingresaste este caso: lo responde el especialista responsable"
        }
        return nil
    }
}

/// El formulario «Responder interconsulta» (PAPER §30.2): precargado con lo que la ficha ya
/// tiene; un campo vacío no borra. Se guarda en la ficha y le llega al médico que envió el caso.
struct ResponderInterconsultaView: View {
    let episodio: String
    /// El episodio tal como está ahora, para precargar.
    let inicial: Registro?
    /// Tras guardar: `notified` dice si se avisó al médico que envió el caso.
    let alResponder: (_ notified: Bool) async -> Void

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var diagnostico = ""
    @State private var tratamiento = ""
    @State private var recomendacion = ""
    @State private var observaciones = ""
    /// PAPER §34: opcional; precargada con la del episodio si ya tiene.
    @State private var prioridad: ClinicalPriority?
    @State private var guardando = false
    @State private var error: String?
    @State private var precargado = false

    private var sinRespuesta: Bool {
        recomendacion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ej.: D22.5 — Nevus atípico", text: $diagnostico)
                } header: {
                    Text("Diagnóstico clínico")
                } footer: {
                    Text("Se guarda en la ficha de esta consulta y le llega al médico que envió el caso.")
                }
                Section("Prioridad clínica") {
                    ForEach(ClinicalPriority.allCases) { opcion in
                        Button {
                            prioridad = opcion
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: prioridad == opcion ? "largecircle.fill.circle" : "circle")
                                    .foregroundStyle(prioridad == opcion ? opcion.color : .secondary)
                                    .padding(.top, 2)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(opcion.rawValue)
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(opcion.color)
                                    Text(opcion.guide)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(prioridad == opcion ? .isSelected : [])
                    }
                }
                Section("Tratamiento") {
                    TextField("Tratamiento", text: $tratamiento, axis: .vertical)
                        .lineLimit(2...5)
                }
                Section {
                    TextField("Qué debe hacer el médico que envió el caso", text: $recomendacion, axis: .vertical)
                        .lineLimit(4...10)
                } header: {
                    Text("Respuesta e indicaciones (obligatoria)")
                } footer: {
                    if sinRespuesta {
                        Text("Escribe la respuesta para el médico que envió el caso.")
                    }
                }
                Section("Observaciones") {
                    TextField("Resumen de lo más importante (sale en la evolución)", text: $observaciones, axis: .vertical)
                        .lineLimit(2...5)
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .disabled(guardando)
            .navigationTitle("Responder interconsulta")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { cerrar() }
                        .disabled(guardando)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if guardando {
                        ProgressView()
                    } else {
                        Button("Responder") { Task { await responder() } }
                            .disabled(sinRespuesta)
                    }
                }
            }
            .interactiveDismissDisabled(guardando)
        }
        .onAppear {
            guard !precargado else { return }
            precargado = true
            diagnostico = inicial?["diagnostico"] ?? ""
            tratamiento = inicial?["tratamiento_resumen"] ?? ""
            observaciones = inicial?["observaciones"] ?? ""
            prioridad = inicial?["prioridad"].flatMap(ClinicalPriority.init(rawValue:))
        }
    }

    private func responder() async {
        guard !sinRespuesta else { return }
        guardando = true
        error = nil
        defer { guardando = false }
        do {
            let resultado = try await sesion.api.answerInterconsulta(InterconsultaAnswer(
                episodio: episodio, recomendacion: recomendacion,
                diagnostico: diagnostico, tratamiento: tratamiento, observaciones: observaciones,
                prioridad: prioridad,
            ))
            cerrar()
            await alResponder(resultado.notified ?? false)
        } catch {
            // 400/409 traen el motivo en español: se muestra tal cual.
            self.error = error.localizedDescription
        }
    }
}
