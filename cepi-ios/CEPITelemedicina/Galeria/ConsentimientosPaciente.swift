import Observation
import PhotosUI
import SwiftUI

/// Los consentimientos de un paciente (PAPER §31): qué fotos hay de cada tipo y la subida de
/// una nueva. Espejo de ConsentimientosPaciente.vue.
@MainActor
@Observable
final class ConsentsModel {
    /// Lo que dice el recuadro después de subir: confirmación o motivo del fallo.
    struct Notice: Equatable {
        let text: String
        let isError: Bool
    }

    let patient: String

    private(set) var list = ConsentList()
    private(set) var loaded = false
    private(set) var error: String?
    private(set) var uploading: ConsentType?
    private(set) var notices: [ConsentType: Notice] = [:]

    init(patient: String) {
        self.patient = patient
    }

    /// Por qué no se puede subir ahora a este recuadro; `nil` = se puede. El botón se
    /// deshabilita con este texto a la vista, nunca se oculta.
    func uploadBlockReason(_ type: ConsentType) -> String? {
        if let uploading {
            return uploading == type ? "Subiendo…" : "Termina primero la otra subida"
        }
        if !loaded {
            return error == nil ? "Espera a que carguen los consentimientos" : "Primero hay que cargar los consentimientos"
        }
        return nil
    }

    func load(api: CEPIAPI) async {
        do {
            list = try await api.consents(patient: patient)
            error = nil
            loaded = true
        } catch {
            guard !Task.isCancelled else { return }
            if !loaded { self.error = "No se pudieron cargar los consentimientos: \(error.localizedDescription)" }
        }
    }

    /// Sube cada imagen (ya convertida a JPEG sin metadatos), registra los adjuntos como
    /// consentimiento del tipo elegido y recarga la lista.
    func upload(_ images: [Data], type: ConsentType, api: CEPIAPI) async {
        guard uploadBlockReason(type) == nil, !images.isEmpty else { return }
        uploading = type
        notices[type] = nil
        defer { uploading = nil }
        do {
            var ids: [String] = []
            for datos in images {
                guard let jpeg = await FotoClinica.jpeg(desde: datos) else {
                    throw APIError(status: -1, mensaje: "no se pudo leer la foto")
                }
                ids.append(try await api.subirImagen(jpeg, nombre: FotoClinica.nombreNuevo()).id)
            }
            let result = try await api.saveConsents(patient: patient, type: type, attachmentIds: ids)
            if result.ids.isEmpty {
                notices[type] = Notice(text: "No se pudo guardar: \(result.errors.first ?? "error")", isError: true)
            } else if !result.errors.isEmpty {
                notices[type] = Notice(
                    text: "Se guardaron \(result.ids.count) de \(ids.count) fotos: \(result.errors[0])", isError: true
                )
            } else {
                notices[type] = Notice(
                    text: result.ids.count == 1 ? "Foto guardada" : "\(result.ids.count) fotos guardadas", isError: false
                )
            }
        } catch {
            notices[type] = Notice(text: "No se pudo guardar: \(error.localizedDescription)", isError: true)
        }
        await load(api: api)
    }
}

/// Los dos recuadros de consentimientos, arriba de las fotos clínicas en la sección Imágenes
/// del paciente (PAPER §31.3). No se mezclan con la Galería de la organización.
struct PatientConsentsView: View {
    let model: ConsentsModel

    @Environment(Sesion.self) private var sesion
    @State private var opened: ConsentPhoto?

    var body: some View {
        VStack(spacing: 10) {
            ForEach(ConsentType.allCases) { type in
                ConsentBox(type: type, model: model) { opened = $0 }
            }
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
        .fullScreenCover(item: $opened) { photo in
            if let attachmentId = photo.attachmentId {
                VisorImagen(id: attachmentId)
                    .environment(sesion)
            }
        }
    }
}

/// Un recuadro: título, quién firma, sus fotos y el botón «📷 Subir foto».
private struct ConsentBox: View {
    let type: ConsentType
    let model: ConsentsModel
    let onOpen: (ConsentPhoto) -> Void

    @Environment(Sesion.self) private var sesion
    @State private var pickedItems: [PhotosPickerItem] = []
    @State private var pickerShown = false
    @State private var cameraShown = false

    private let columns = [GridItem(.adaptive(minimum: 90), spacing: 6)]

    var body: some View {
        let blockReason = model.uploadBlockReason(type)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(type.title).font(.subheadline.weight(.bold))
                    Text(type.signer).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                uploadMenu(disabled: blockReason != nil)
            }

            if let blockReason, model.uploading != type {
                Text(blockReason).font(.caption2).foregroundStyle(.secondary)
            }

            content

            if let notice = model.notices[type] {
                Text(notice.text)
                    .font(.caption)
                    .foregroundStyle(notice.isError ? .red : .green)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator))
        .accessibilityIdentifier("consentimiento.\(type.rawValue)")
        .photosPicker(isPresented: $pickerShown, selection: $pickedItems, matching: .images)
        .onChange(of: pickedItems) { _, items in
            guard !items.isEmpty else { return }
            pickedItems = []
            Task {
                var images: [Data] = []
                for item in items {
                    if let datos = try? await item.loadTransferable(type: Data.self) { images.append(datos) }
                }
                await model.upload(images, type: type, api: sesion.api)
            }
        }
        .fullScreenCover(isPresented: $cameraShown) {
            CamaraView { imagen in
                guard let datos = imagen.jpegData(compressionQuality: 0.95) else { return }
                Task { await model.upload([datos], type: type, api: sesion.api) }
            }
            .ignoresSafeArea()
        }
    }

    /// Siempre visible: mientras carga o mientras sube otra queda gris, con el motivo debajo.
    private func uploadMenu(disabled: Bool) -> some View {
        let label = model.uploading == type ? "Subiendo…" : "📷 Subir foto"
        return Menu {
            Button { cameraShown = true } label: {
                Label(CamaraView.disponible ? "Tomar foto" : "Tomar foto (este dispositivo no tiene cámara)",
                      systemImage: "camera")
            }
            .disabled(!CamaraView.disponible)
            Button { pickerShown = true } label: {
                Label("Elegir de la fototeca", systemImage: "photo.on.rectangle")
            }
        } label: {
            Text(label)
                .font(.footnote.weight(.semibold))
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
        .disabled(disabled)
        .accessibilityLabel("Subir foto del \(type.title.lowercased())")
    }

    @ViewBuilder
    private var content: some View {
        let photos = model.list.photos(type)
        if !model.loaded {
            if let error = model.error {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.red)
                    Button("Reintentar") { Task { await model.load(api: sesion.api) } }
                        .font(.caption)
                }
            } else {
                Text("Cargando…").font(.caption).foregroundStyle(.secondary)
            }
        } else if photos.isEmpty {
            Text("Todavía no hay foto").font(.caption).foregroundStyle(.secondary)
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 6) {
                ForEach(photos) { photo in
                    Button { onOpen(photo) } label: { thumbnail(photo) }
                        .buttonStyle(.plain)
                        .disabled(photo.attachmentId == nil)
                        .accessibilityHint(photo.attachmentId == nil ? "Registro anterior sin foto guardada" : "")
                }
            }
        }
    }

    private func thumbnail(_ photo: ConsentPhoto) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Group {
                if let attachmentId = photo.attachmentId {
                    ImagenAutenticada(id: attachmentId, ladoMaximo: 360)
                } else {
                    Text("Sin foto").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .frame(height: 90)
            .frame(maxWidth: .infinity)
            .clipped()
            .background(.fill.tertiary)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            Text(Self.dateText(photo.date))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    static func dateText(_ date: String?) -> String {
        guard let date else { return "" }
        return Fechas.dia(date)
            .map { $0.formatted(.dateTime.day(.twoDigits).month(.abbreviated).year().locale(Locale(identifier: "es"))) }
            ?? String(date.prefix(10))
    }
}
