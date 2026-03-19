import type { ProductKind, SalesChannel } from "@/models/Product"

export interface MenuComponentInput {
    productId: string
    quantity: number
}

export interface MenuChoiceGroupInput {
    id: string
    name: string
    minSelections: number
    maxSelections: number
    options: MenuComponentInput[]
}

export interface MenuSelectionInput {
    groupId: string
    productId: string
}

export function parseJsonArrayInput<T>(rawValue: FormDataEntryValue | null): T[] {
    if (typeof rawValue !== "string") return []
    const trimmed = rawValue.trim()
    if (!trimmed) return []

    try {
        const parsed = JSON.parse(trimmed)
        return Array.isArray(parsed) ? parsed as T[] : []
    } catch {
        return []
    }
}

export interface FixedMenuProductShape {
    _id: unknown
    name?: string
    shortName?: string
    description?: string
    categoryId?: unknown
    basePrice?: number | null
    kind?: ProductKind | string
    availableOnlyInMenus?: boolean
    salesChannels?: Array<SalesChannel | string> | null
    menuComponents?: Array<{
        productId?: unknown
        quantity?: number | null
    }> | null
    menuChoiceGroups?: Array<{
        id?: string | null
        name?: string | null
        minSelections?: number | null
        maxSelections?: number | null
        options?: Array<{
            productId?: unknown
            quantity?: number | null
        }> | null
    }> | null
}

export interface ResolvedIncludedComponent {
    productId: string
    snapshotName: string
    quantity: number
    source: "FIXED_ITEM" | "CHOICE_OPTION"
    groupId?: string
    groupName?: string
}

export interface MenuResolutionResult {
    success: true
    selectedOptions: Array<{ name: string, priceVariation: number }>
    includedComponents: ResolvedIncludedComponent[]
}

export interface MenuResolutionError {
    success: false
    error: string
}

export function toIdString(value: unknown): string {
    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed
    }

    if (value && typeof value === "object" && typeof (value as { toString?: () => string }).toString === "function") {
        return (value as { toString(): string }).toString().trim()
    }

    return ""
}

export function normalizeProductKind(value: unknown): ProductKind {
    return value === "FIXED_MENU" ? "FIXED_MENU" : "STANDARD"
}

export function normalizeSalesChannels(value: unknown): SalesChannel[] {
    const normalized = Array.isArray(value)
        ? value
            .map((entry) => (entry === "POS" || entry === "MENU" ? entry : null))
            .filter((entry): entry is SalesChannel => Boolean(entry))
        : []

    if (normalized.length === 0) {
        return ["POS", "MENU"]
    }

    return [...new Set(normalized)]
}

export function parseSalesChannelsInput(rawValues: Array<FormDataEntryValue>) {
    return normalizeSalesChannels(
        rawValues
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
    )
}

export function isProductVisibleInChannel(product: Pick<FixedMenuProductShape, "kind" | "availableOnlyInMenus" | "salesChannels">, channel: SalesChannel) {
    const salesChannels = normalizeSalesChannels(product.salesChannels)
    if (!salesChannels.includes(channel)) return false

    if (normalizeProductKind(product.kind) === "STANDARD" && Boolean(product.availableOnlyInMenus)) {
        return false
    }

    return true
}

export function normalizeMenuComponents(value: FixedMenuProductShape["menuComponents"]): MenuComponentInput[] {
    if (!Array.isArray(value)) return []

    return value
        .map((entry) => ({
            productId: toIdString(entry?.productId),
            quantity: Number.isFinite(entry?.quantity) ? Math.max(1, Math.floor(Number(entry?.quantity))) : 1
        }))
        .filter((entry) => entry.productId.length > 0)
}

export function normalizeMenuChoiceGroups(value: FixedMenuProductShape["menuChoiceGroups"]): MenuChoiceGroupInput[] {
    if (!Array.isArray(value)) return []

    return value
        .map((group, index) => {
            const options = Array.isArray(group?.options)
                ? group.options
                    .map((option) => ({
                        productId: toIdString(option?.productId),
                        quantity: Number.isFinite(option?.quantity) ? Math.max(1, Math.floor(Number(option?.quantity))) : 1
                    }))
                    .filter((option) => option.productId.length > 0)
                : []

            const minSelections = Number.isFinite(group?.minSelections) ? Math.max(0, Math.floor(Number(group?.minSelections))) : 1
            const maxSelections = Number.isFinite(group?.maxSelections) ? Math.max(1, Math.floor(Number(group?.maxSelections))) : 1
            const rawId = typeof group?.id === "string" ? group.id.trim() : ""
            const rawName = typeof group?.name === "string" ? group.name.trim() : ""

            return {
                id: rawId || `group-${index + 1}`,
                name: rawName || `Scelta ${index + 1}`,
                minSelections,
                maxSelections,
                options
            }
        })
        .filter((group) => group.options.length > 0)
}

export function productRequiresMenuConfiguration(product: Pick<FixedMenuProductShape, "kind" | "menuChoiceGroups">) {
    return normalizeProductKind(product.kind) === "FIXED_MENU" && normalizeMenuChoiceGroups(product.menuChoiceGroups).length > 0
}

export function getProductUnitBasePrice(product: Pick<FixedMenuProductShape, "basePrice">): number {
    const amount = Number(product.basePrice ?? 0)
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0
}

export function buildMenuConfigurationKey(selections: MenuSelectionInput[]) {
    return selections
        .map((entry) => `${entry.groupId}:${entry.productId}`)
        .sort((left, right) => left.localeCompare(right, "en"))
        .join("|")
}

export function collectReferencedProductIds(product: Pick<FixedMenuProductShape, "menuComponents" | "menuChoiceGroups">) {
    return [
        ...normalizeMenuComponents(product.menuComponents).map((entry) => entry.productId),
        ...normalizeMenuChoiceGroups(product.menuChoiceGroups).flatMap((group) => group.options.map((option) => option.productId))
    ]
}

export function resolveFixedMenuSelection(options: {
    menu: FixedMenuProductShape
    productById: Map<string, { _id?: unknown; name?: string }>
    selections: MenuSelectionInput[]
}): MenuResolutionResult | MenuResolutionError {
    const kind = normalizeProductKind(options.menu.kind)
    if (kind !== "FIXED_MENU") {
        return { success: false, error: "Prodotto non configurato come menu fisso" }
    }

    const includedComponents: ResolvedIncludedComponent[] = []
    const selectedOptions: Array<{ name: string, priceVariation: number }> = []
    const fixedComponents = normalizeMenuComponents(options.menu.menuComponents)
    const choiceGroups = normalizeMenuChoiceGroups(options.menu.menuChoiceGroups)

    for (const component of fixedComponents) {
        const componentProduct = options.productById.get(component.productId)
        if (!componentProduct?.name?.trim()) {
            return { success: false, error: "Componente fisso del menu non valido" }
        }

        includedComponents.push({
            productId: component.productId,
            snapshotName: componentProduct.name.trim(),
            quantity: component.quantity,
            source: "FIXED_ITEM"
        })
    }

    const selectionsByGroup = new Map<string, MenuSelectionInput[]>()
    for (const selection of options.selections) {
        const groupId = selection.groupId.trim()
        const productId = selection.productId.trim()
        if (!groupId || !productId) continue
        const existing = selectionsByGroup.get(groupId) || []
        existing.push({ groupId, productId })
        selectionsByGroup.set(groupId, existing)
    }

    for (const group of choiceGroups) {
        const picked = selectionsByGroup.get(group.id) || []
        if (picked.length < group.minSelections) {
            return { success: false, error: `Completa la scelta obbligatoria: ${group.name}` }
        }
        if (picked.length > group.maxSelections) {
            return { success: false, error: `Sono state selezionate troppe opzioni per ${group.name}` }
        }

        const optionsByProductId = new Map(group.options.map((entry) => [entry.productId, entry]))

        for (const selection of picked) {
            const choiceOption = optionsByProductId.get(selection.productId)
            if (!choiceOption) {
                return { success: false, error: `Scelta non valida per ${group.name}` }
            }

            const selectedProduct = options.productById.get(selection.productId)
            if (!selectedProduct?.name?.trim()) {
                return { success: false, error: `Prodotto selezionato non valido per ${group.name}` }
            }

            const selectedName = selectedProduct.name.trim()
            selectedOptions.push({
                name: `${group.name}: ${selectedName}`,
                priceVariation: 0
            })
            includedComponents.push({
                productId: selection.productId,
                snapshotName: selectedName,
                quantity: choiceOption.quantity,
                source: "CHOICE_OPTION",
                groupId: group.id,
                groupName: group.name
            })
        }
    }

    if (includedComponents.length === 0) {
        return { success: false, error: "Il menu non contiene prodotti selezionabili" }
    }

    return {
        success: true,
        selectedOptions,
        includedComponents
    }
}
