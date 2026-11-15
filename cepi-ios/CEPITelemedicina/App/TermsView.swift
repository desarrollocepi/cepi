import SwiftUI
import WebKit

/// Términos de uso (LOPDP, PAPER §37). El texto es `terminos.html` de la web y la versión
/// vigente, `terminos.json`: los mismos que leen la PWA y Android. Esta constante solo se usa
/// si `terminos.json` no responde (sin red).
let fallbackTermsVersion = "2026-11-15"

/// Lee `{ "version": … }` de `terminos.json`; nil si no responde o no trae versión.
func fetchCurrentTermsVersion(web: URL, red: URLSession = .shared) async -> String? {
    var pedido = URLRequest(url: web.appending(path: "terminos.json"))
    pedido.cachePolicy = .reloadIgnoringLocalCacheData
    pedido.timeoutInterval = 10
    guard let (datos, respuesta) = try? await red.data(for: pedido),
          (respuesta as? HTTPURLResponse)?.statusCode == 200,
          let json = try? JSONSerialization.jsonObject(with: datos) as? [String: Any],
          let version = json["version"] as? String, !version.isEmpty
    else { return nil }
    return version
}

/// Puerta tras el login, equivalente a `TermsModal.vue`: sin aceptar la versión vigente no se
/// ve nada de la app. «No acepto» cierra la sesión.
struct TermsView: View {
    @Environment(Sesion.self) private var sesion
    @State private var read = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Términos y condiciones de uso").font(.title2.bold())
            Text(intro).font(.footnote).foregroundStyle(.secondary)
            WebTerms(url: Config.webBase.appending(path: "terminos.html"))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
            Toggle("Leí y acepto los términos y condiciones y la Política de Privacidad.", isOn: $read)
                .font(.subheadline)
                .disabled(saving)
                .accessibilityIdentifier("terminos.leido")
            if let error {
                Text("No se pudo guardar tu aceptación: \(error)").font(.footnote).foregroundStyle(.red)
            }
            if !read {
                Text("Activa «Leí y acepto» para aceptar.").font(.footnote).foregroundStyle(.secondary)
            }
            HStack {
                Button("No acepto", role: .destructive) { Task { await sesion.salir() } }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    .disabled(saving)
                Button(saving ? "Guardando…" : "Acepto") { accept() }
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity)
                    .disabled(!read || saving)
            }
        }
        .padding()
    }

    private var intro: String {
        var texto = "Antes de seguir, lee y acepta cómo se tratan tus datos personales y los de los pacientes, según la Ley Orgánica de Protección de Datos Personales del Ecuador."
        if sesion.usuario?.termsVersion != nil { texto += " Los términos cambiaron desde que los aceptaste." }
        return texto
    }

    private func accept() {
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do { try await sesion.acceptTerms() }
            catch { self.error = error.localizedDescription }
        }
    }
}

/// El texto de `terminos.html`. Los enlaces a la propia web (la política de privacidad) se
/// abren adentro; un correo u otro sitio, afuera.
private struct WebTerms: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinador { Coordinador(host: url.host) }

    func makeUIView(context: Context) -> WKWebView {
        let vista = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        vista.navigationDelegate = context.coordinator
        vista.load(URLRequest(url: url))
        return vista
    }

    func updateUIView(_ vista: WKWebView, context: Context) {}

    final class Coordinador: NSObject, WKNavigationDelegate {
        let host: String?
        init(host: String?) { self.host = host }

        func webView(
            _ webView: WKWebView, decidePolicyFor accion: WKNavigationAction,
            decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
        ) {
            guard let destino = accion.request.url else {
                decisionHandler(.allow)
                return
            }
            if destino.host == host {
                // `target="_blank"` no abre ventana nueva en un WKWebView: se carga en la misma.
                if accion.targetFrame == nil { webView.load(accion.request); decisionHandler(.cancel) }
                else { decisionHandler(.allow) }
                return
            }
            UIApplication.shared.open(destino)
            decisionHandler(.cancel)
        }
    }
}
