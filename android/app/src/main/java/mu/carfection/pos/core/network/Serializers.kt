package mu.carfection.pos.core.network

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive

/**
 * PostgREST serializes `numeric` / `bigint` columns as QUOTED STRINGS to preserve
 * precision (e.g. selling_price → "32000.00"), so a plain `Double` field fails to
 * deserialize. Accept either a JSON number or a JSON string and yield a Double.
 * (The web client does the same via `Number(...)`.)
 */
object FlexDoubleSerializer : KSerializer<Double> {
    override val descriptor = PrimitiveSerialDescriptor("FlexDouble", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): Double {
        val el = (decoder as JsonDecoder).decodeJsonElement()
        return (el as? JsonPrimitive)?.content?.toDoubleOrNull() ?: 0.0
    }
    override fun serialize(encoder: Encoder, value: Double) = encoder.encodeDouble(value)
}

typealias FlexDouble = @Serializable(FlexDoubleSerializer::class) Double
