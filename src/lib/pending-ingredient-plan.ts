export interface PendingIngredientPlanComparableItem {
    productId: string
    snapshotName: string
    quantity: number
    menuSelections?: Array<{ groupId: string, productId: string }>
}

function normalizeIngredientPlanRelevantCart(
    cart: PendingIngredientPlanComparableItem[]
): Array<{
    productId: string
    snapshotName: string
    quantity: number
    menuSelections: Array<{ groupId: string, productId: string }>
}> {
    return cart.map((item) => ({
        productId: item.productId,
        snapshotName: item.snapshotName,
        quantity: item.quantity,
        menuSelections: [...(item.menuSelections || [])]
            .map((entry) => ({
                groupId: entry.groupId,
                productId: entry.productId
            }))
            .sort((left, right) => (
                left.groupId.localeCompare(right.groupId, "it")
                || left.productId.localeCompare(right.productId, "it")
            ))
    }))
}

export function shouldReusePendingIngredientPlan(
    currentCart: PendingIngredientPlanComparableItem[],
    persistedCart: PendingIngredientPlanComparableItem[]
) {
    return JSON.stringify(normalizeIngredientPlanRelevantCart(currentCart))
        === JSON.stringify(normalizeIngredientPlanRelevantCart(persistedCart))
}
