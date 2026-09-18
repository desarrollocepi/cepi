import SwiftUI
import WebKit

/// Maneja el WKWebView de `ficha.html`: cargar, esperar a que termine y hablar con su API
/// (`fillFicha`, `markChanges`, `readFicha`).
@MainActor
final class ControladorFicha: NSObject, WKNavigationDelegate {
    let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    var alCargar: (@MainActor () -> Void)?

    override init() {
        super.init()
        webView.navigationDelegate = self
    }

    func cargar(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        alCargar?()
    }

    /// Evalúa JavaScript y devuelve el resultado si es texto.
    func texto(_ codigo: String) async -> String? {
        await withCheckedContinuation { continuacion in
            webView.evaluateJavaScript(codigo) { resultado, _ in
                continuacion.resume(returning: resultado as? String)
            }
        }
    }

    /// Evalúa JavaScript sin esperar resultado (termina en `''` para no devolver `undefined`).
    func ejecutar(_ codigo: String) async {
        _ = await texto(codigo + "; ''")
    }

    func leerFicha() async -> String? {
        await texto("JSON.stringify(window.readFicha ? window.readFicha() : {})")
    }
}

private struct WebFicha: UIViewRepresentable {
    let controlador: ControladorFicha

    func makeUIView(context: Context) -> WKWebView { controlador.webView }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// La ficha clínica como documento: la hoja imprimible de la web, editable, paginada por
/// consulta y con lo que cambió respecto de la anterior en rojo (PAPER §24.2).
struct VisorFicha: View {
    let pacienteId: String
    let nombre: String
    let episodioActivo: String?
    /// Como sección del paciente (PAPER §24.2.1) va sin barra propia ni botón Cerrar: eso lo
    /// pone quien la contiene. Fuera de ahí sigue abriéndose como pantalla completa.
    var embebido = false
    /// Guarda lo editado (`ficha_save`); devuelve si el bot lo procesó.
    let alGuardar: ([String: JSONValor], String?) async -> Bool

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var controlador = ControladorFicha()
    @State private var episodios: [Registro] = []
    @State private var paciente: [String: JSONValor] = [:]
    @State private var indice = 0
    @State private var cargando = true
    @State private var guardando = false
    @State private var inicial: String?
    @State private var confirmarCierre = false
    @State private var error: String?

    var body: some View {
        if embebido {
            contenido
                .safeAreaInset(edge: .bottom) { barraEmbebida }
                .task { await cargar() }
                .onChange(of: episodioActivo) { _, _ in Task { await cargar() } }
        } else {
            NavigationStack {
                contenido
                    .navigationTitle("Ficha — \(nombre)")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cerrar") { Task { await intentarCerrar() } }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Guardar") { Task { await guardar() } }
                                .disabled(cargando || guardando || episodios.isEmpty)
                        }
                        ToolbarItem(placement: .bottomBar) {
                            Button("Imprimir", systemImage: "printer", action: imprimir)
                                .disabled(cargando)
                        }
                    }
                    .confirmationDialog("Hay cambios sin guardar en la ficha.", isPresented: $confirmarCierre, titleVisibility: .visible) {
                        Button("Descartar cambios", role: .destructive) { cerrar() }
                        Button("Seguir editando", role: .cancel) {}
                    }
                    .task { await cargar() }
            }
        }
    }

    /// Guardar e imprimir donde se ven siempre, sin robarle la barra al paciente.
    private var barraEmbebida: some View {
        HStack {
            Button("Imprimir", systemImage: "printer", action: imprimir)
                .disabled(cargando)
            Spacer()
            Button("Guardar") { Task { await guardar() } }
                .buttonStyle(.borderedProminent)
                .disabled(cargando || guardando || episodios.isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private var contenido: some View {
        VStack(spacing: 0) {
            barraDeConsultas
            WebFicha(controlador: controlador)
                .overlay {
                    if cargando { ProgressView() }
                }
            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(8)
            }
        }
    }

    private var barraDeConsultas: some View {
        HStack {
            Button("Anterior", systemImage: "chevron.left") { indice += 1 }
                .disabled(cargando || indice >= episodios.count - 1)
            Spacer()
            Text(etiqueta)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer()
            Button { indice -= 1 } label: {
                HStack(spacing: 4) {
                    Text("Siguiente")
                    Image(systemName: "chevron.right")
                }
            }
            .disabled(cargando || indice <= 0)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(8)
        .background(.bar)
    }

    private var etiqueta: String {
        guard episodios.indices.contains(indice) else { return cargando ? "" : "Sin consultas registradas" }
        let fecha = episodios[indice]["fecha"] ?? "s/f"
        if episodios.count == 1 { return "\(fecha) · única consulta registrada" }
        return "\(fecha) · episodio \(episodios.count - indice) de \(episodios.count)"
    }

    private func cargar() async {
        controlador.alCargar = { Task { await rellenar() } }
        async let lista = sesion.api.episodios(paciente: pacienteId)
        async let registro = sesion.api.entidad(pacienteId)
        do {
            episodios = try await lista
        } catch {
            self.error = "No se pudieron cargar las consultas: \(error.localizedDescription)"
        }
        paciente = (try? await registro)?.data ?? [:]
        let deLaActual = episodios.firstIndex { $0.id == episodioActivo } ?? 0
        if deLaActual == indice {
            recargarPagina()
        } else {
            indice = deLaActual
        }
    }

    /// Cada consulta en una página limpia, como la web que vuelve a montar el iframe.
    private func recargarPagina() {
        cargando = true
        inicial = nil
        controlador.cargar(Config.webBase.appending(path: "ficha.html"))
    }

    private func rellenar() async {
        let episodio = episodios.indices.contains(indice) ? episodios[indice].data : [:]
        let anterior = episodios.indices.contains(indice + 1) ? episodios[indice + 1].data : nil
        let datos = DatosFicha.combinar(paciente: paciente, episodio: episodio)
        let cambios = DatosFicha.cambios(actual: episodio, anterior: anterior)
        await controlador.ejecutar("window.fillFicha && window.fillFicha(\(DatosFicha.javascript(datos)))")
        await controlador.ejecutar("window.markChanges && window.markChanges(\(DatosFicha.javascript(cambios)))")
        // Foto de lo cargado, para avisar si se cierra con cambios sin guardar.
        inicial = await controlador.leerFicha()
        cargando = false
    }

    private func guardar() async {
        guard let json = await controlador.leerFicha(),
              let datos = try? JSONDecoder().decode([String: JSONValor].self, from: Data(json.utf8)) else {
            error = "No se pudo leer la ficha."
            return
        }
        guardando = true
        defer { guardando = false }
        let episodio = episodios.indices.contains(indice) ? episodios[indice].id : nil
        if await alGuardar(datos, episodio) {
            cerrar()
        } else {
            error = "No se pudo guardar la ficha."
        }
    }

    private func intentarCerrar() async {
        let actual = await controlador.leerFicha()
        if let actual, let inicial, actual != inicial {
            confirmarCierre = true
        } else {
            cerrar()
        }
    }

    private func imprimir() {
        let impresion = UIPrintInteractionController.shared
        impresion.printFormatter = controlador.webView.viewPrintFormatter()
        impresion.present(animated: true)
    }
}
