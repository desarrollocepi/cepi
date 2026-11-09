import SwiftUI
import WebKit

/// La ficha de evolución del paciente (PAPER §28): fecha, médico, diagnóstico y tratamiento de
/// cada ficha, la más nueva primero. Es el mismo documento de la web (`evolucion.html`,
/// hermano de `ficha.html`), así se lee e imprime igual en las tres. La ficha que se está viendo
/// va resaltada; tocar otra la abre. Se pide cada vez que se abre: entre una vez y otra se pudo
/// guardar un diagnóstico.
///
/// Es la sección Evolución del paciente (PAPER §24.2.1 y §28.3): el menú del paciente y el
/// botón de la barra de la ficha llevan a ella, no abren una hoja. Las observaciones se editan
/// acá.
struct EvolucionView: View {
    let pacienteId: String
    /// La ficha abierta en el visor.
    let actual: String?
    /// Quien la contiene la sube cada vez que la sección vuelve a la vista: se vuelve a pedir.
    var recarga = 0
    let alElegir: (String) -> Void

    @Environment(Sesion.self) private var sesion
    @State private var controlador = ControladorEvolucion()
    @State private var datos: String?
    @State private var cargando = true
    @State private var error: String?

    var body: some View {
        WebEvolucion(controlador: controlador)
            .overlay {
                if cargando { ProgressView() }
            }
            .safeAreaInset(edge: .bottom) { barra }
            // Al aparecer, al volver a la sección y si cambia la ficha resaltada.
            .task(id: "\(recarga)|\(actual ?? "")") { await cargar() }
    }

    /// Actualizar e imprimir, como en la sección Evolución de la web.
    private var barra: some View {
        HStack {
            Button("Actualizar", systemImage: "arrow.clockwise") { Task { await cargar() } }
                .disabled(cargando)
            Spacer()
            Button("Imprimir", systemImage: "printer", action: imprimir)
                .disabled(cargando || error != nil)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func cargar() async {
        // Tocar cualquier fila lleva a la Ficha, también la resaltada.
        controlador.alElegir = { episodio in alElegir(episodio) }
        controlador.alCargar = { Task { await llenar() } }
        controlador.alGuardarObservaciones = { episodio, texto in
            Task { await guardarObservaciones(episodio: episodio, texto: texto) }
        }
        // El documento se carga una vez; al recargar solo se vuelven a pedir los datos.
        if !controlador.pedido {
            controlador.cargar(Config.webBase.appending(path: "evolucion.html"))
        }
        cargando = true
        error = nil
        datos = nil
        async let filas = sesion.api.evolucion(paciente: pacienteId)
        async let registro = sesion.api.entidad(pacienteId)
        do {
            datos = DatosEvolucion.javascript(
                paciente: (try? await registro)?.data ?? [:],
                filas: try await filas,
                actual: actual,
                editable: true,
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

    /// El documento queda en «Guardando…» hasta que se le responde por una de las dos funciones.
    private func guardarObservaciones(episodio: String, texto: String) async {
        let id = DatosEvolucion.cadena(episodio)
        do {
            try await sesion.api.saveObservations(episodio: episodio, paciente: pacienteId, texto: texto)
            await controlador.ejecutar("window.observacionesGuardadas && window.observacionesGuardadas(\(id), \(DatosEvolucion.cadena(texto)))")
        } catch {
            let mensaje = "No se pudieron guardar las observaciones: \(error.localizedDescription)"
            await controlador.ejecutar("window.errorObservaciones && window.errorObservaciones(\(id), \(DatosEvolucion.cadena(mensaje)))")
        }
    }

    private func imprimir() {
        let impresion = UIPrintInteractionController.shared
        impresion.printFormatter = controlador.webView.viewPrintFormatter()
        impresion.present(animated: true)
    }
}

/// El WKWebView de `evolucion.html`. Tocar una fila llega por el mensaje `abrirFicha`; guardar
/// observaciones, por `guardarObservaciones`.
@MainActor
final class ControladorEvolucion: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let webView: WKWebView
    var alCargar: (@MainActor () -> Void)?
    var alElegir: (@MainActor (String) -> Void)?
    var alGuardarObservaciones: (@MainActor (String, String) -> Void)?
    private(set) var listo = false
    /// Ya se pidió el documento (aunque no haya terminado de cargar).
    private(set) var pedido = false

    override init() {
        let configuracion = WKWebViewConfiguration()
        let usuario = WKUserContentController()
        // El documento llama a window.onAbrirFicha(id) si existe.
        usuario.addUserScript(WKUserScript(
            source: "window.onAbrirFicha = function (id) { window.webkit.messageHandlers.abrirFicha.postMessage(String(id)); };",
            injectionTime: .atDocumentEnd, forMainFrameOnly: true,
        ))
        // Al inicio del documento, para que exista cuando fillEvolucion pinte las filas.
        usuario.addUserScript(WKUserScript(
            source: """
            window.onGuardarObservaciones = function (id, texto) {
              window.webkit.messageHandlers.guardarObservaciones.postMessage({ id: String(id), texto: String(texto) });
            };
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true,
        ))
        configuracion.userContentController = usuario
        webView = WKWebView(frame: .zero, configuration: configuracion)
        super.init()
        usuario.add(self, name: "abrirFicha")
        usuario.add(self, name: "guardarObservaciones")
        webView.navigationDelegate = self
    }

    func cargar(_ url: URL) {
        listo = false
        pedido = true
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        listo = true
        alCargar?()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "guardarObservaciones":
            guard let cuerpo = message.body as? [String: Any],
                  let episodio = cuerpo["id"] as? String,
                  let texto = cuerpo["texto"] as? String else { return }
            alGuardarObservaciones?(episodio, texto)
        default:
            if let episodio = message.body as? String { alElegir?(episodio) }
        }
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
    /// `editable`: cada fila con «Editar» en Observaciones (lo pide la sección Evolución).
    static func objeto(
        paciente: [String: JSONValor], filas: [FilaEvolucion], actual: String?, editable: Bool = false, hoy: Date = .now
    ) -> [String: JSONValor] {
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
                "especialista": fila.especialista.map(JSONValor.texto) ?? .nulo,
                "diagnostico": fila.diagnostico.map(JSONValor.texto) ?? .nulo,
                "diagnostico_histopatologico": fila.diagnosticoHistopatologico.map(JSONValor.texto) ?? .nulo,
                "tratamiento": fila.tratamiento.map(JSONValor.texto) ?? .nulo,
                "observaciones": fila.observaciones.map(JSONValor.texto) ?? .nulo,
            ])
        }
        return [
            "paciente": .objeto(datosPaciente),
            "filas": .lista(lista),
            "actual": actual.map(JSONValor.texto) ?? .nulo,
            "editable": .booleano(editable),
        ]
    }

    static func javascript(paciente: [String: JSONValor], filas: [FilaEvolucion], actual: String?, editable: Bool = false) -> String {
        DatosFicha.javascript(objeto(paciente: paciente, filas: filas, actual: actual, editable: editable))
    }

    /// Una cadena de JavaScript con el texto escapado.
    static func cadena(_ texto: String) -> String {
        DatosFicha.javascript(["m": .texto(texto)]) + ".m"
    }
}
