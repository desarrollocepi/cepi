package ec.cepi.telemedicina.ficha

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ec.cepi.telemedicina.R
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CampoFormulario
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.FichaGroup
import ec.cepi.telemedicina.api.FormularioBot
import ec.cepi.telemedicina.api.FullFicha
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.TipoCampo
import ec.cepi.telemedicina.api.texto
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import okhttp3.HttpUrl
import kotlin.math.roundToInt

/**
 * Las reglas de `FichaCompleta.vue`, sin UI, para poder probarlas: progreso, «Solo lo que
 * falta», qué grupos se editan acá, lo cargado de cada grupo y qué cambió desde la consulta
 * anterior.
 */
object FullFichaLogic {
    /**
     * Los grupos de fotos (4.7, 8.1, 8.2) no escriben campos: crean registros `clinical_image` /
     * `consent` al subir la foto. Desde la ficha no tendrían dónde guardar.
     */
    val IMAGE_GROUPS = setOf("g_4_7", "g_8", "g_8_2")

    /** Los mismos de la web: datos de la cita o derivados, que cambian siempre. */
    val NOT_COMPARED = setOf(
        "id", "fecha", "medico_id", "patient_id", "estado", "tipo", "created_at", "updated_at",
        "ficha_num", "examinador_nombre", "gravedad_total", "location", "drpro_cita_id", "tipo_cita",
        "ficha_completitud", "ficha_faltantes", "ficha_calculada_at", "ficha_grupos_con_dato",
        "diagnostico_fuente", "drpro_raw", "drpro_raw_hash",
    )

    /** Una categoría (§) con sus grupos; `visible` respeta «Solo lo que falta». */
    data class Category(val name: String, val groups: List<FichaGroup>, val visible: List<FichaGroup>) {
        val done: Int get() = groups.count { it.done }
    }

    /** Un campo con dato, legible. `previous` != null: cambió desde la consulta anterior. */
    data class FieldValue(val key: String, val label: String, val text: String, val previous: Change? = null)

    /** El valor que tenía en la consulta anterior. */
    data class Change(val before: JsonElement?)

    fun percent(ficha: FullFicha): Int =
        if (ficha.total > 0) (ficha.done * 100.0 / ficha.total).roundToInt() else 0

    fun progressText(ficha: FullFicha): String = "${ficha.done} de ${ficha.total} grupos con dato"

    /**
     * Los grupos llegan planos y en orden; la categoría los agrupa. Con «Solo lo que falta» salen
     * solo los grupos sin dato, y una categoría completa desaparece.
     */
    fun categories(groups: List<FichaGroup>, onlyMissing: Boolean): List<Category> {
        val byName = LinkedHashMap<String, MutableList<FichaGroup>>()
        for (group in groups) byName.getOrPut(group.category.ifBlank { "Otros" }) { mutableListOf() } += group
        val all = byName.map { (name, list) -> Category(name, list, if (onlyMissing) list.filter { !it.done } else list) }
        return if (onlyMissing) all.filter { it.visible.isNotEmpty() } else all
    }

    /**
     * Por qué no se puede editar el grupo desde la ficha; `null` si se puede. Nunca se esconde el
     * botón: sale deshabilitado con esto a la vista (CLAUDE.md).
     */
    fun editDisabledReason(group: FichaGroup, episodeId: String?): String? = when {
        group.id in IMAGE_GROUPS -> "Las fotos se suben en Imágenes o en el chat"
        group.form == null -> "Este grupo no tiene formulario"
        group.target == "episode" && episodeId == null -> "Primero abre una consulta"
        else -> null
    }

    fun buttonText(group: FichaGroup): String = if (group.done) "Editar" else "Completar"

    /**
     * El formulario del chat sin sus acciones: «Omitir» emite un evento de conversación que acá
     * nadie escucha, y sería un botón que no hace nada.
     */
    fun editableForm(group: FichaGroup): FormularioBot? = group.form?.copy(acciones = emptyList())

    /**
     * Los campos del grupo con valor, como los pinta la web. El `heading` (la guía de prioridad)
     * no tiene clave: se muestra en el formulario, no como dato. Solo se comparan los grupos del
     * episodio: los del paciente los comparten todas sus consultas.
     */
    fun values(group: FichaGroup, previousEpisode: Map<String, JsonElement>?): List<FieldValue> {
        val form = group.form ?: return emptyList()
        return form.campos.mapNotNull { field ->
            val key = field.clave ?: return@mapNotNull null
            val value = form.valores[key]
            if (empty(value)) return@mapNotNull null
            FieldValue(key, field.etiqueta.ifBlank { key }, text(value!!, field), change(key, value, group.target, previousEpisode))
        }
    }

    /** Cuántos campos cambiaron desde la consulta anterior: los mismos que se marcan abajo. */
    fun changeCount(groups: List<FichaGroup>, previousEpisode: Map<String, JsonElement>?): Int =
        if (previousEpisode == null) 0 else groups.sumOf { group -> values(group, previousEpisode).count { it.previous != null } }

    private fun change(key: String, value: JsonElement, target: String, previous: Map<String, JsonElement>?): Change? {
        if (target != "episode" || previous == null || key in NOT_COMPARED || ':' in key) return null
        val before = previous[key]
        return if (DatosFicha.normalizado(value) == DatosFicha.normalizado(before)) null else Change(before)
    }

    /** El texto de «valor anterior», con la redacción de la web. */
    fun previousText(before: JsonElement?): String {
        if (empty(before) || before == JsonPrimitive(false)) return "(vacío)"
        if (before == JsonPrimitive(true)) return "Sí"
        return (before as? JsonPrimitive)?.texto() ?: before.toString()
    }

    /** Los valores guardados son textos, booleanos, listas de regiones o el JSON del mapa corporal. */
    fun text(value: JsonElement, field: CampoFormulario?): String {
        if (value is JsonArray) {
            return value.joinToString(", ") { item ->
                when (item) {
                    is JsonObject -> (item["label"] ?: item["value"])?.let { (it as? JsonPrimitive)?.content } ?: item.toString()
                    else -> (item as? JsonPrimitive)?.texto() ?: item.toString()
                }
            }
        }
        if (value is JsonObject) return value.toString()
        val primitive = value as? JsonPrimitive ?: return value.toString()
        if (!primitive.isString) primitive.booleanOrNull?.let { return if (it) "Sí" else "No" }
        val option = field?.opciones?.firstOrNull { LogicaFormulario.coincide(primitive, it) }
        if (option != null) return option.etiqueta
        return primitive.texto().orEmpty()
    }

    fun empty(value: JsonElement?): Boolean =
        value == null || value is JsonNull || (value is JsonPrimitive && value.isString && value.content.isEmpty())

    /** El aviso tras guardar: con el % de la ficha si el servidor lo pudo calcular. */
    fun savedNotice(completeness: Double?): String =
        completeness?.let { "Guardado · ${it.roundToInt()}% de la ficha" } ?: "Guardado"

    /** La respuesta del especialista a la interconsulta (texto y fecha), si la hay. */
    fun specialistAnswer(episode: Map<String, JsonElement>?): Pair<String, String?>? {
        val text = episode?.get("recomendacion")?.texto()?.trim().orEmpty()
        if (text.isEmpty()) return null
        return text to episode?.get("recomendacion_at")?.texto()?.takeIf { it.isNotBlank() }
    }

    /** El título de la barra de consultas: las consultas van de la más nueva a la más vieja. */
    fun navTitle(episodes: List<Registro>, index: Int): String =
        if (episodes.isEmpty()) "Episodio" else "Episodio ${episodes.size - index} de ${episodes.size}"

    /** La línea de abajo del título, como `ficha-nav-pos` en la web. */
    fun navDetail(episodes: List<Registro>, index: Int, loadingEpisodes: Boolean, changes: Int): String {
        val previous = episodes.getOrNull(index + 1)
        val previousDate = previous?.get("fecha")?.take(10).orEmpty()
        return when {
            episodes.isEmpty() && loadingEpisodes -> "buscando los otros episodios…"
            episodes.isEmpty() -> "sin consultas registradas"
            episodes.size == 1 -> "único episodio registrado de este paciente"
            previous != null && changes > 0 ->
                "$changes ${if (changes == 1) "campo cambió" else "campos cambiaron"} desde el del $previousDate"
            previous != null -> "sin cambios respecto del $previousDate"
            else -> "es el primer episodio del paciente"
        }
    }
}

/**
 * La ficha del paciente, editable y adaptable (PAPER §24.2.1), como la pestaña Ficha de la web
 * (`FichaCompleta.vue`): progreso, «Solo lo que falta», navegación entre consultas, la respuesta
 * del especialista y cada grupo con lo que tiene cargado. «Completar» / «Editar» abre el mismo
 * formulario del chat (`FormularioHoja`) y guarda con `POST /api/bot/ficha/grupo`, sin sí/no:
 * es una acción explícita. El documento imprimible (`ficha.html`) queda detrás de «Imprimir».
 *
 * `mostrada`: la sección ya se vio una vez (antes no se carga nada). `visible`: está a la vista;
 * cada vez que vuelve se relee la ficha, porque desde el chat se pudo guardar algo.
 */
@Composable
fun FichaPage(
    pacienteId: String,
    nombre: String,
    episodioActivo: String?,
    api: CepiApi,
    web: HttpUrl,
    mostrada: Boolean,
    visible: Boolean,
    /** Guardar desde el documento imprimible (el visor de `ficha.html`). */
    alGuardarDocumento: suspend (JsonObject, String?) -> Boolean,
    /** Otra ficha que se pidió abrir (una tarjeta de Evolución). */
    episodioPedido: EpisodeRequest? = null,
    onShowEvolution: () -> Unit = {},
    /** La ficha que queda a la vista, para que Evolución la resalte. */
    onEpisodeShown: (String?) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    var episodes by remember { mutableStateOf(emptyList<Registro>()) }
    var loadingEpisodes by remember { mutableStateOf(true) }
    var index by remember { mutableIntStateOf(0) }
    var ficha by remember { mutableStateOf<FullFicha?>(null) }
    var episodeData by remember { mutableStateOf<Map<String, JsonElement>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var onlyMissing by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<FichaGroup?>(null) }
    var saving by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var printing by remember { mutableStateOf(false) }
    var reloadTick by remember { mutableIntStateOf(0) }

    val episodeId = episodes.getOrNull(index)?.id

    LaunchedEffect(mostrada, episodioActivo) {
        if (!mostrada) return@LaunchedEffect
        loadingEpisodes = true
        episodes = try {
            api.episodios(pacienteId)
        } catch (e: ApiError) {
            error = "No se pudieron listar las consultas: ${e.mensaje}"
            emptyList()
        }
        index = episodes.indexOfFirst { it.id == episodioActivo }.coerceAtLeast(0)
        loadingEpisodes = false
    }
    LaunchedEffect(episodioPedido, episodes) {
        val target = episodes.indexOfFirst { it.id == episodioPedido?.episodeId }
        if (target >= 0) index = target
    }
    LaunchedEffect(episodeId) { onEpisodeShown(episodeId) }

    // Recargar NO vacía la ficha (como la web): se queda lo que había y arriba sale la barra.
    LaunchedEffect(mostrada, loadingEpisodes, episodeId, visible, reloadTick) {
        if (!mostrada || loadingEpisodes || !visible) return@LaunchedEffect
        loading = true
        try {
            ficha = api.fullFicha(episodeId, pacienteId)
            episodeData = episodeId?.let { id -> runCatching { api.entidad(id).data }.getOrNull() }
            error = null
        } catch (e: ApiError) {
            error = "No se pudo cargar la ficha: ${e.mensaje}"
        } finally {
            loading = false
        }
    }

    val previousEpisode = episodes.getOrNull(index + 1)?.data
    val groups = ficha?.groups.orEmpty()
    val changes = FullFichaLogic.changeCount(groups, previousEpisode)

    Column(Modifier.fillMaxSize()) {
        // La barra de consultas sale siempre, aunque haya una sola (CLAUDE.md).
        Surface(tonalElevation = 2.dp) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                // Más nueva a más vieja: la anterior es la siguiente de la lista.
                TextButton(onClick = { index++ }, enabled = !loading && index < episodes.size - 1) { Text("‹ Anterior") }
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                    Text(FullFichaLogic.navTitle(episodes, index), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    episodes.getOrNull(index)?.get("fecha")?.take(10)?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(
                        FullFichaLogic.navDetail(episodes, index, loadingEpisodes, changes),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (changes > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = if (changes > 0) FontWeight.Bold else null,
                        maxLines = 2,
                    )
                }
                TextButton(onClick = { index-- }, enabled = !loading && index > 0) { Text("Siguiente ›") }
            }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())

        val current = ficha
        Column(Modifier.weight(1f)) {
            when {
                current == null && error != null -> Estado(error!!, esError = true)
                current == null -> Estado(if (mostrada) "Cargando ficha…" else "")
                current.groups.isEmpty() -> Estado("Esta ficha no tiene grupos.")
                else -> FichaContent(
                    ficha = current,
                    episodeId = episodeId,
                    answer = FullFichaLogic.specialistAnswer(episodeData),
                    previousEpisode = previousEpisode,
                    onlyMissing = onlyMissing,
                    onOnlyMissing = { onlyMissing = it },
                    notice = notice ?: error?.let { it to true },
                    enabled = !loading && !saving,
                    onEdit = {
                        notice = null
                        editing = it
                    },
                )
            }
        }

        Surface(tonalElevation = 3.dp) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                TextButton(onClick = { printing = true }, enabled = mostrada && !loadingEpisodes) {
                    Icon(painterResource(R.drawable.ic_imprimir), contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(6.dp))
                    Text("Imprimir")
                }
                TextButton(onClick = onShowEvolution) { Text("Evolución") }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { reloadTick++ }, enabled = mostrada && !loading) { Text("Actualizar") }
            }
        }
    }

    val group = editing
    val form = group?.let(FullFichaLogic::editableForm)
    if (group != null && form != null) {
        FormularioHoja(
            formulario = form,
            ocupado = saving,
            api = api,
            alEnviar = { data ->
                scope.launch {
                    saving = true
                    try {
                        val result = api.saveFichaGroup(group.id, data, episodeId, pacienteId)
                        editing = null
                        notice = FullFichaLogic.savedNotice(result.completeness) to false
                        // Se relee la ficha entera: guardar mueve campos derivados y el progreso.
                        reloadTick++
                    } catch (e: ApiError) {
                        notice = "No se pudo guardar: ${e.mensaje}" to true
                        editing = null
                    } finally {
                        saving = false
                    }
                }
            },
            // Los formularios de la ficha no mandan mensajes: no tienen acciones ni búsquedas.
            alMandar = {},
            alCerrar = { if (!saving) editing = null },
        )
    }

    if (printing) {
        PrintDialog(titulo = "Ficha — $nombre", onClose = {
            printing = false
            reloadTick++
        }) {
            VisorFicha(
                pacienteId = pacienteId,
                nombre = nombre,
                episodioActivo = episodeId ?: episodioActivo,
                api = api,
                web = web,
                mostrada = true,
                visible = true,
                alGuardar = alGuardarDocumento,
                onShowEvolution = {
                    printing = false
                    onShowEvolution()
                },
            )
        }
    }
}

@Composable
private fun FichaContent(
    ficha: FullFicha,
    episodeId: String?,
    answer: Pair<String, String?>?,
    previousEpisode: Map<String, JsonElement>?,
    onlyMissing: Boolean,
    onOnlyMissing: (Boolean) -> Unit,
    notice: Pair<String, Boolean>?,
    enabled: Boolean,
    onEdit: (FichaGroup) -> Unit,
) {
    val categories = FullFichaLogic.categories(ficha.groups, onlyMissing)
    LazyColumn(
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        if (answer != null) {
            item(key = "respuesta") { SpecialistAnswer(answer.first, answer.second) }
        }
        item(key = "progreso") {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                LinearProgressIndicator(
                    progress = { FullFichaLogic.percent(ficha) / 100f },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        FullFichaLogic.progressText(ficha),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    Text("Solo lo que falta", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.size(8.dp))
                    Switch(checked = onlyMissing, onCheckedChange = onOnlyMissing)
                }
                notice?.let { (text, isError) ->
                    Text(
                        text,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
        if (categories.isEmpty()) {
            item(key = "completa") { Estado("Todos los grupos tienen dato.") }
        }
        categories.forEach { category ->
            item(key = "cat-${category.name}") {
                Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 10.dp)) {
                    Text(
                        category.name.uppercase(),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.size(8.dp))
                    Text("${category.done}/${category.groups.size}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline)
                }
            }
            items(category.visible, key = { it.id }) { group ->
                GroupCard(group, FullFichaLogic.values(group, previousEpisode), FullFichaLogic.editDisabledReason(group, episodeId), enabled) {
                    onEdit(group)
                }
            }
        }
    }
}

@Composable
private fun SpecialistAnswer(text: String, date: String?) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF0FDF4), contentColor = Color(0xFF14532D)),
        border = BorderStroke(1.dp, Color(0xFFBBF7D0)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("Respuesta del especialista", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                date?.let {
                    Spacer(Modifier.size(8.dp))
                    Text(it.take(10), style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(text, style = MaterialTheme.typography.bodyMedium, color = Color(0xFF0F172A))
        }
    }
}

@Composable
private fun GroupCard(
    group: FichaGroup,
    values: List<FullFichaLogic.FieldValue>,
    disabledReason: String?,
    enabled: Boolean,
    onEdit: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (group.done) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (group.done) "●" else "○",
                    color = if (group.done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                    style = MaterialTheme.typography.labelSmall,
                )
                Spacer(Modifier.size(6.dp))
                Text(group.label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                OutlinedButton(
                    onClick = onEdit,
                    enabled = enabled && disabledReason == null,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                ) {
                    Text(FullFichaLogic.buttonText(group), style = MaterialTheme.typography.labelMedium)
                }
            }
            disabledReason?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (values.isEmpty()) {
                Text("Sin dato", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            } else {
                values.forEach { value ->
                    Column {
                        Text(
                            value.label,
                            style = MaterialTheme.typography.labelMedium,
                            color = if (value.previous != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            fontWeight = if (value.previous != null) FontWeight.ExtraBold else null,
                        )
                        Text(value.text, style = MaterialTheme.typography.bodyMedium)
                        value.previous?.let {
                            Text(
                                "Antes: ${FullFichaLogic.previousText(it.before)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Estado(texto: String, esError: Boolean = false) {
    Text(
        texto,
        style = MaterialTheme.typography.bodyMedium,
        color = if (esError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(24.dp),
    )
}

/** El documento imprimible a pantalla completa, con «Cerrar» arriba. */
@Composable
internal fun PrintDialog(titulo: String, onClose: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp),
                ) {
                    TextButton(onClick = onClose) { Text("Cerrar") }
                    Text(titulo, style = MaterialTheme.typography.titleMedium, maxLines = 1, modifier = Modifier.weight(1f))
                }
                Column(Modifier.weight(1f)) { content() }
            }
        }
    }
}

