import SwiftUI
import WebKit

/// La ficha de evolución del paciente (PAPER §28): fecha, médico, diagnóstico y tratamiento de
/// cada ficha, la más nueva primero. Es el mismo documento de la web (`evolucion.html`,
/// hermano de `ficha.html`), así se lee e imprime igual en las tres. La ficha que se está viendo
/// va resaltada; tocar otra la abre. Se pide cada vez que se abre: entre una vez y otra se pudo
/// guardar un diagnóstico.
struct EvolucionView: View {
    let pacienteId: String
    /// La ficha abierta en el visor.
    let actual: String?
    let alElegir: (String) -> Void

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var controlador = ControladorEvolucion()
    @State private var datos: String?
    @State private var cargando = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            WebEvolucion(controlador: controlador)
                .overlay {
                    if cargando { ProgressView() }
                }
                .navigationTitle("Ficha de evolución")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cerrar") { cerrar() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button("Imprimir", systemImage: "printer", action: imprimir)
                            .disabled(cargando || error != nil)
                    }
                }
        }
        .task { await cargar() }
    }

    private func cargar() async {
        controlador.alElegir = { episodio in
            guard episodio != actual else { return }
            alElegir(episodio)
            cerrar()
        }
        controlador.alCargar = { Task { await llenar() } }
        controlador.cargar(Config.webBase.appending(path: "evolucion.html"))
        async let filas = sesion.api.evolucion(paciente: pacienteId)
        async let registro = sesion.api.entidad(pacienteId)
        do {
            datos = DatosEvolucion.javascript(
                paciente: (try? await registro)?.data ?? [:],
                filas: try await filas,
                actual: actual,
            )
        } catch {
            self.error = "No se pudo cargar la evolución: \(error.localizedDescription)"
        }
        await llenar()
    }

    /// Los datos y el documento llegan en cualquier orden: se llena cuando están los dos.
    private func llenar() async {
        guard controlador.listo else { return }
        if let error {
            await controlador.ejecutar("window.errorEvolucion && window.errorEvolucion(\(DatosEvolucion.cadena(error)))")
        } else if let datos {
            await controlador.ejecutar("window.fillEvolucion && window.fillEvolucion(\(datos))")
        } else {
            return
        }
        cargando = false
    }

    private func imprimir() {
        let impresion = UIPrintInteractionController.shared
        impresion.printFormatter = controlador.webView.viewPrintFormatter()
        impresion.present(animated: true)
    }
}

/// El WKWebView de `evolucion.html`. Tocar una fila llega por el mensaje `abrirFicha`.
@MainActor
final class ControladorEvolucion: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let webView: WKWebView
    var alCargar: (@MainActor () -> Void)?
    var alElegir: (@MainActor (String) -> Void)?
    private(set) var listo = false

    override init() {
        let configuracion = WKWebViewConfiguration()
        let usuario = WKUserContentController()
        // El documento llama a window.onAbrirFicha(id) si existe.
        usuario.addUserScript(WKUserScript(
            source: "window.onAbrirFicha = function (id) { window.webkit.messageHandlers.abrirFicha.postMessage(String(id)); };",
            injectionTime: .atDocumentEnd, forMainFrameOnly: true,
        ))
        configuracion.userContentController = usuario
        webView = WKWebView(frame: .zero, configuration: configuracion)
        super.init()
        usuario.add(self, name: "abrirFicha")
        webView.navigationDelegate = self
    }

    func cargar(_ url: URL) {
        listo = false
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        listo = true
        alCargar?()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let episodio = message.body as? String { alElegir?(episodio) }
    }

    func ejecutar(_ codigo: String) async {
        await withCheckedContinuation { continuacion in
            webView.evaluateJavaScript(codigo + "; ''") { _, _ in continuacion.resume() }
        }
    }
}

private struct WebEvolucion: UIViewRepresentable {
    let controlador: ControladorEvolucion

    func makeUIView(context: Context) -> WKWebView { controlador.webView }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Lo que se le pasa a `fillEvolucion`, como en `VisorEvolucion.vue` de la web. Sin UI, para
/// poder probarlo.
enum DatosEvolucion {
    static func objeto(paciente: [String: JSONValor], filas: [FilaEvolucion], actual: String?, hoy: Date = .now) -> [String: JSONValor] {
        let combinado = DatosFicha.combinar(paciente: paciente, episodio: [:], hoy: hoy)
        let datosPaciente: [String: JSONValor] = [
            "nombre": combinado["nombre"] ?? .texto(""),
            "cedula": paciente["cedula"] ?? .texto(""),
            "edad": combinado["edad"] ?? .nulo,
        ]
        let lista: [JSONValor] = filas.map { fila in
            .objeto([
                "episode_id": .texto(fila.episodio),
                "fecha": fila.fecha.map(JSONValor.texto) ?? .nulo,
                "medico": fila.medico.map(JSONValor.texto) ?? .nulo,
                "diagnostico": fila.diagnostico.map(JSONValor.texto) ?? .nulo,
                "tratamiento": fila.tratamiento.map(JSONValor.texto) ?? .nulo,
            ])
        }
        return [
            "paciente": .objeto(datosPaciente),
            "filas": .lista(lista),
            "actual": actual.map(JSONValor.texto) ?? .nulo,
        ]
    }

    static func javascript(paciente: [String: JSONValor], filas: [FilaEvolucion], actual: String?) -> String {
        DatosFicha.javascript(objeto(paciente: paciente, filas: filas, actual: actual))
    }

    /// Una cadena de JavaScript con el texto escapado.
    static func cadena(_ texto: String) -> String {
        DatosFicha.javascript(["m": .texto(texto)]) + ".m"
    }
}
