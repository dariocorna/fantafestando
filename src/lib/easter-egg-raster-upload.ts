import { validateThermalRasterPayload, type ThermalRasterPayload } from "./easter-egg-raster";

function isBlobLike(value: FormDataEntryValue | null): value is Exclude<FormDataEntryValue, string> {
    return typeof value === "object"
        && value !== null
        && "size" in value
        && typeof value.size === "number"
        && "arrayBuffer" in value
        && typeof value.arrayBuffer === "function";
}

export async function parseThermalRasterFormData(formData: FormData): Promise<
    { success: true; raster: ThermalRasterPayload }
    | { success: false; error: string }
> {
    const width = Number(formData.get("rasterWidth"));
    const height = Number(formData.get("rasterHeight"));
    const bits = formData.get("rasterBits");

    if (!isBlobLike(bits)) {
        return { success: false, error: "Raster mancante" };
    }

    const validationError = validateThermalRasterPayload(width, height, bits.size);
    if (validationError) {
        return { success: false, error: validationError };
    }

    return {
        success: true,
        raster: {
            width,
            height,
            data: new Uint8Array(await bits.arrayBuffer())
        }
    };
}
