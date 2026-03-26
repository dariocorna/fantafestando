import { parseJsonArrayInput, toIdString } from "@/lib/fixed-menu"

export interface RecipeItemInput {
    ingredientId: string
    quantity: number
}

export interface IngredientCatalogShape {
    _id: unknown
    name?: string | null
    shortName?: string | null
    stockQuantity?: number | null
    active?: boolean | null
}

export interface ProductRecipeShape {
    _id: unknown
    name?: string | null
    recipeItems?: Array<{
        ingredientId?: unknown
        quantity?: number | null
    } | null> | null
}

export interface IngredientPlanSourceItem {
    productId: string
    snapshotName: string
    quantity: number
}

export interface IngredientPlanCartItem {
    productId: string
    snapshotName: string
    quantity: number
    includedComponents?: IngredientPlanSourceItem[] | null
}

export interface IngredientPlanEntry {
    ingredientId?: string
    snapshotName: string
    quantity: number
    sourceProductId?: string
    sourceProductName?: string
    legacy?: boolean
}

export interface IngredientQueueOrderShape {
    ingredientPlan?: Array<{
        ingredientId?: unknown
        snapshotName?: string | null
        quantity?: number | null
        sourceProductId?: unknown
        sourceProductName?: string | null
        legacy?: boolean | null
    } | null> | null
    cart?: Array<{
        productId?: unknown
        snapshotName?: string | null
        quantity?: number | null
        includedComponents?: Array<{
            productId?: unknown
            snapshotName?: string | null
            quantity?: number | null
        } | null> | null
    } | null> | null
}

export interface PendingIngredientQueueEntry {
    ingredientKey: string
    label: string
    quantity: number
    orderCount: number
    legacy: boolean
}

export interface PendingIngredientQueueWithCatalogEntry extends PendingIngredientQueueEntry {
    stockQuantity?: number | null
    remainingStockQuantity?: number | null
    active?: boolean
}

function normalizeQuantity(value: unknown): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.floor(Number(value)))
}

function normalizeLabel(value: unknown, fallback: string): string {
    if (typeof value === "string" && value.trim()) {
        return value.trim()
    }
    return fallback
}

function buildIngredientSnapshotName(ingredient?: Pick<IngredientCatalogShape, "name" | "shortName"> | null) {
    if (ingredient?.shortName?.trim()) return ingredient.shortName.trim()
    if (ingredient?.name?.trim()) return ingredient.name.trim()
    return "Ingrediente"
}

function buildLegacyEntry(source: IngredientPlanSourceItem): IngredientPlanEntry[] {
    const sourceProductName = normalizeLabel(source.snapshotName, "Prodotto legacy")
    const quantity = normalizeQuantity(source.quantity)
    if (quantity <= 0) return []

    return [{
        snapshotName: sourceProductName,
        quantity,
        sourceProductId: source.productId || undefined,
        sourceProductName,
        legacy: true
    }]
}

function normalizeIngredientPlanEntries(entries: IngredientPlanEntry[]): IngredientPlanEntry[] {
    const totals = new Map<string, IngredientPlanEntry>()

    for (const entry of entries) {
        const quantity = normalizeQuantity(entry.quantity)
        if (quantity <= 0) continue

        const snapshotName = normalizeLabel(entry.snapshotName, "Ingrediente")
        const sourceProductName = entry.sourceProductName?.trim() || snapshotName
        const ingredientId = entry.ingredientId?.trim()
        const sourceProductId = entry.sourceProductId?.trim()
        const legacy = Boolean(entry.legacy)
        const aggregationKey = [
            ingredientId || "",
            snapshotName,
            sourceProductId || "",
            sourceProductName,
            legacy ? "1" : "0"
        ].join("::")

        const existing = totals.get(aggregationKey)
        if (existing) {
            existing.quantity += quantity
            continue
        }

        totals.set(aggregationKey, {
            ingredientId,
            snapshotName,
            quantity,
            sourceProductId,
            sourceProductName,
            legacy
        })
    }

    return [...totals.values()]
}

export function parseRecipeItemsInput(rawValue: FormDataEntryValue | null): RecipeItemInput[] {
    return normalizeRecipeItems(parseJsonArrayInput<RecipeItemInput>(rawValue))
}

export function normalizeRecipeItems(value: ProductRecipeShape["recipeItems"] | RecipeItemInput[]): RecipeItemInput[] {
    if (!Array.isArray(value)) return []

    const totals = new Map<string, number>()
    for (const entry of value) {
        const ingredientId = toIdString(entry?.ingredientId)
        const quantity = normalizeQuantity(entry?.quantity)
        if (!ingredientId || quantity <= 0) continue
        totals.set(ingredientId, (totals.get(ingredientId) || 0) + quantity)
    }

    return [...totals.entries()].map(([ingredientId, quantity]) => ({
        ingredientId,
        quantity
    }))
}

export function buildIngredientPlanForCart(options: {
    cart: IngredientPlanCartItem[]
    productById: Map<string, ProductRecipeShape>
    ingredientById: Map<string, IngredientCatalogShape>
}): IngredientPlanEntry[] {
    const result: IngredientPlanEntry[] = []

    for (const item of options.cart) {
        const baseQuantity = normalizeQuantity(item.quantity)
        if (baseQuantity <= 0) continue

        const sources = Array.isArray(item.includedComponents) && item.includedComponents.length > 0
            ? item.includedComponents.map((component) => ({
                productId: component.productId,
                snapshotName: normalizeLabel(component.snapshotName, item.snapshotName || "Prodotto"),
                quantity: normalizeQuantity(component.quantity) * baseQuantity
            }))
            : [{
                productId: item.productId,
                snapshotName: normalizeLabel(item.snapshotName, "Prodotto"),
                quantity: baseQuantity
            }]

        for (const source of sources) {
            if (normalizeQuantity(source.quantity) <= 0) continue

            const product = options.productById.get(source.productId)
            if (!product) {
                result.push(...buildLegacyEntry(source))
                continue
            }

            const recipeItems = normalizeRecipeItems(product.recipeItems)
            if (recipeItems.length === 0) {
                result.push(...buildLegacyEntry(source))
                continue
            }

            const resolvedIngredients = recipeItems.map((recipeItem) => ({
                recipeItem,
                ingredient: options.ingredientById.get(recipeItem.ingredientId)
            }))

            if (resolvedIngredients.some((entry) => !entry.ingredient)) {
                result.push(...buildLegacyEntry(source))
                continue
            }

            for (const entry of resolvedIngredients) {
                result.push({
                    ingredientId: entry.recipeItem.ingredientId,
                    snapshotName: buildIngredientSnapshotName(entry.ingredient),
                    quantity: entry.recipeItem.quantity * source.quantity,
                    sourceProductId: source.productId || undefined,
                    sourceProductName: normalizeLabel(source.snapshotName, product.name?.trim() || "Prodotto"),
                    legacy: false
                })
            }
        }
    }

    return normalizeIngredientPlanEntries(result)
}

export function buildLegacyIngredientPlanFromOrderCart(
    cart: IngredientQueueOrderShape["cart"]
): IngredientPlanEntry[] {
    if (!Array.isArray(cart)) return []

    const result: IngredientPlanEntry[] = []
    for (const item of cart) {
        const baseQuantity = normalizeQuantity(item?.quantity)
        if (baseQuantity <= 0) continue

        const sources = Array.isArray(item?.includedComponents) && item.includedComponents.length > 0
            ? item.includedComponents.map((component) => ({
                productId: toIdString(component?.productId),
                snapshotName: normalizeLabel(component?.snapshotName, normalizeLabel(item?.snapshotName, "Prodotto legacy")),
                quantity: normalizeQuantity(component?.quantity) * baseQuantity
            }))
            : [{
                productId: toIdString(item?.productId),
                snapshotName: normalizeLabel(item?.snapshotName, "Prodotto legacy"),
                quantity: baseQuantity
            }]

        for (const source of sources) {
            result.push(...buildLegacyEntry(source))
        }
    }

    return normalizeIngredientPlanEntries(result)
}

export function aggregatePendingIngredientQueue(
    orders: IngredientQueueOrderShape[]
): PendingIngredientQueueEntry[] {
    const totals = new Map<string, PendingIngredientQueueEntry>()

    for (const order of orders) {
        const sourcePlan = Array.isArray(order.ingredientPlan) && order.ingredientPlan.length > 0
            ? normalizeIngredientPlanEntries(
                order.ingredientPlan.map((entry) => ({
                    ingredientId: toIdString(entry?.ingredientId) || undefined,
                    snapshotName: normalizeLabel(entry?.snapshotName, "Ingrediente"),
                    quantity: normalizeQuantity(entry?.quantity),
                    sourceProductId: toIdString(entry?.sourceProductId) || undefined,
                    sourceProductName: typeof entry?.sourceProductName === "string" ? entry.sourceProductName : undefined,
                    legacy: Boolean(entry?.legacy)
                }))
            )
            : buildLegacyIngredientPlanFromOrderCart(order.cart)

        const seenOrderKeys = new Set<string>()
        for (const entry of sourcePlan) {
            const label = normalizeLabel(entry.snapshotName, entry.sourceProductName || "Ingrediente")
            const ingredientKey = entry.ingredientId
                ? `ingredient:${entry.ingredientId}`
                : `legacy:${entry.sourceProductId || label.toLocaleLowerCase("it-IT")}`
            const existing = totals.get(ingredientKey)

            if (existing) {
                existing.quantity += entry.quantity
                if (!seenOrderKeys.has(ingredientKey)) {
                    existing.orderCount += 1
                }
            } else {
                totals.set(ingredientKey, {
                    ingredientKey,
                    label,
                    quantity: entry.quantity,
                    orderCount: 1,
                    legacy: Boolean(entry.legacy)
                })
            }

            seenOrderKeys.add(ingredientKey)
        }
    }

    return [...totals.values()].sort((left, right) => {
        if (right.quantity !== left.quantity) {
            return right.quantity - left.quantity
        }
        return left.label.localeCompare(right.label, "it")
    })
}

export function attachIngredientCatalogMetadata(
    queue: PendingIngredientQueueEntry[],
    ingredientById: Map<string, Pick<IngredientCatalogShape, "stockQuantity" | "active">>
): PendingIngredientQueueWithCatalogEntry[] {
    return queue.map((entry) => {
        if (!entry.ingredientKey.startsWith("ingredient:")) {
            return entry
        }

        const ingredientId = entry.ingredientKey.slice("ingredient:".length)
        const ingredient = ingredientById.get(ingredientId)
        const stockQuantity = ingredient?.stockQuantity
        const normalizedStockQuantity = typeof stockQuantity === "number" && Number.isFinite(stockQuantity)
            ? Math.max(0, Math.floor(stockQuantity))
            : null

        return {
            ...entry,
            stockQuantity: normalizedStockQuantity,
            remainingStockQuantity: normalizedStockQuantity === null
                ? null
                : Math.max(0, normalizedStockQuantity - entry.quantity),
            active: typeof ingredient?.active === "boolean" ? ingredient.active : undefined
        }
    })
}
