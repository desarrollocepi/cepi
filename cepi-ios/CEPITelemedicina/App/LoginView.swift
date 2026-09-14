import SwiftUI

struct LoginView: View {
    @Environment(Sesion.self) private var sesion
    @State private var email = ""
    @State private var password = ""
    @State private var enviando = false
    @State private var error: String?
    @FocusState private var foco: Campo?

    private enum Campo { case email, password }

    private var completo: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 12) {
                    Image("Logo")
                        .resizable()
                        .scaledToFit()
                        .frame(height: 88)
                        // El logo es blanco (en la web va sobre la banda marrón): sin su
                        // placa desaparece sobre el fondo claro.
                        .padding(12)
                        .background(Marca.placaLogo, in: RoundedRectangle(cornerRadius: 20))
                        .accessibilityLabel("CEPI Centro de la Piel")
                    Text("Telemedicina")
                        .font(.title2.weight(.semibold))
                }
                .padding(.top, 48)

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($foco, equals: .email)
                        .onSubmit { foco = .password }
                        .campoLogin()
                    SecureField("Contraseña", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .focused($foco, equals: .password)
                        .onSubmit { Task { await entrar() } }
                        .campoLogin()
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Button {
                    Task { await entrar() }
                } label: {
                    Group {
                        if enviando {
                            ProgressView()
                        } else {
                            Text("Ingresar")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(enviando || !completo)

                VStack(spacing: 6) {
                    Button {} label: {
                        Label("Continuar con Google", systemImage: "person.badge.key")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(true)
                    Text("El ingreso con Google llega en la fase 4: falta el client ID de iOS.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(24)
            .frame(maxWidth: 420)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        #if DEBUG
        .task { await entrarConCredencialesDeDesarrollo() }
        #endif
    }

    #if DEBUG
    /// Solo Debug: con `CEPI_DEV_EMAIL` y `CEPI_DEV_PASSWORD` en el entorno entra solo, por el
    /// mismo camino que el botón. Permite probar en el simulador sin teclear, como los
    /// browser-bots de la web. Para probar el cierre de sesión, lanzar sin esas variables.
    private func entrarConCredencialesDeDesarrollo() async {
        let entorno = ProcessInfo.processInfo.environment
        guard let correo = entorno["CEPI_DEV_EMAIL"], let clave = entorno["CEPI_DEV_PASSWORD"] else { return }
        email = correo
        password = clave
        await entrar()
    }
    #endif

    private func entrar() async {
        guard completo, !enviando else { return }
        enviando = true
        error = nil
        defer { enviando = false }
        do {
            try await sesion.entrar(email: email, password: password)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private extension View {
    func campoLogin() -> some View {
        padding(14)
            .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12))
    }
}
