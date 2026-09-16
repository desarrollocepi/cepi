import SwiftUI

/// Un formulario del bot (BotForm.vue), en una hoja sobre el hilo. Los envíos estructurados salen
/// por `alEnviar`; las acciones ("Omitir"), la plantilla de mensaje y la elección de un paciente,
/// por `alMandar`.
struct FormularioBotView: View {
    let formulario: FormularioBot
    let ocupado: Bool
    let alEnviar: ([String: JSONValor]) -> Void
    let alMandar: (String) -> Void
    let alCerrar: () -> Void

    @State private var valores: [String: JSONValor]

    init(
        formulario: FormularioBot,
        ocupado: Bool,
        alEnviar: @escaping ([String: JSONValor]) -> Void,
        alMandar: @escaping (String) -> Void,
        alCerrar: @escaping () -> Void
    ) {
        self.formulario = formulario
        self.ocupado = ocupado
        self.alEnviar = alEnviar
        self.alMandar = alMandar
        self.alCerrar = alCerrar
        _valores = State(initialValue: LogicaFormulario.valoresIniciales(formulario))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(Array(formulario.campos.enumerated()), id: \.offset) { _, campo in
                        vista(de: campo)
                    }
                    // "Omitir" abajo y "Guardar" arriba, lejos uno del otro.
                    if !formulario.acciones.isEmpty {
                        HStack {
                            ForEach(formulario.acciones, id: \.self) { accion in
                                Button(accion.label) { alMandar(accion.send) }
                                    .buttonStyle(.bordered)
                            }
                            Spacer()
                        }
                    }
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .disabled(ocupado)
            .overlay {
                if ocupado { ProgressView() }
            }
            .navigationTitle(formulario.titulo)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar", action: alCerrar)
                }
                // En la barra y no al pie: el teclado no lo tapa (en el hilo quedaba debajo).
                if LogicaFormulario.muestraBotonEnviar(formulario) {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(formulario.textoEnviar ?? "Enviar", action: enviar)
                            .disabled(ocupado || !LogicaFormulario.puedeEnviar(formulario, valores: valores))
                            .accessibilityIdentifier("formulario.enviar")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func vista(de campo: CampoFormulario) -> some View {
        switch campo.tipo {
        case .titulo:
            Text(campo.etiqueta)
                .font(.subheadline.weight(.bold))
                .padding(.top, 4)
        case .casilla:
            Toggle(campo.etiqueta, isOn: booleano(campo))
        case .opciones:
            conEtiqueta(campo) { opciones(campo) }
        case .areaTexto:
            conEtiqueta(campo) {
                TextField(campo.placeholder ?? "", text: texto(campo), axis: .vertical)
                    .lineLimit(2...6)
                    .estiloCampo()
            }
        case .fecha:
            conEtiqueta(campo) { CampoFecha(texto: texto(campo)) }
        case .busquedaEntidad:
            conEtiqueta(campo) { CampoEntidad(campo: campo, alElegir: alMandar) }
        case .busquedaCIE:
            conEtiqueta(campo) { CampoCIE10(campo: campo, texto: texto(campo)) }
        case .mapaCorporal:
            conEtiqueta(campo) { CampoMapaCorporal(csv: texto(campo)) }
        case .imagenes:
            conEtiqueta(campo) { CampoImagenes(csv: texto(campo), multiple: campo.multiple) }
        case .texto:
            conEtiqueta(campo) {
                TextField(campo.placeholder ?? "", text: texto(campo))
                    .estiloCampo()
                    .accessibilityIdentifier("campo.\(campo.clave ?? "")")
            }
        }
    }

    private func opciones(_ campo: CampoFormulario) -> some View {
        let clave = campo.clave ?? ""
        return FilaQueEnvuelve {
            ForEach(campo.opciones, id: \.self) { opcion in
                let elegida = LogicaFormulario.coincide(valores[clave], con: opcion)
                Button {
                    valores[clave] = opcion.valor
                    if LogicaFormulario.seEnviaAlElegir(formulario) { enviar() }
                } label: {
                    Text(opcion.etiqueta)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .foregroundStyle(elegida ? Color.white : Color.primary)
                        .background(elegida ? Marca.acento : Color(uiColor: .secondarySystemBackground), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(elegida ? .isSelected : [])
            }
        }
    }

    private func conEtiqueta<Contenido: View>(
        _ campo: CampoFormulario, @ViewBuilder _ contenido: () -> Contenido
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 2) {
                Text(campo.etiqueta)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if campo.requerido {
                    Text("*").foregroundStyle(.red)
                }
            }
            contenido()
        }
    }

    private func enviar() {
        if formulario.estructurado {
            alEnviar(LogicaFormulario.datosEstructurados(formulario, valores: valores))
        } else {
            let mensaje = LogicaFormulario.mensaje(formulario, valores: valores)
            if !mensaje.isEmpty { alMandar(mensaje) }
        }
    }

    private func texto(_ campo: CampoFormulario) -> Binding<String> {
        let clave = campo.clave ?? ""
        return Binding(
            get: { valores[clave]?.texto ?? "" },
            set: { valores[clave] = .texto($0) }
        )
    }

    private func booleano(_ campo: CampoFormulario) -> Binding<Bool> {
        let clave = campo.clave ?? ""
        return Binding(
            get: { valores[clave] == .booleano(true) },
            set: { valores[clave] = .booleano($0) }
        )
    }
}
