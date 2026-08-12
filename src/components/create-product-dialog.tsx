"use client";

import type { ProductRecipeIngredientOption } from "@/components/product-recipe-editor";
import {
    ProductFormDialog,
    type ProductFormAction,
    type ProductOption
} from "@/components/product-form-dialog";

export function CreateProductDialog({
    eventId,
    categories,
    products,
    ingredients,
    createAction
}: {
    eventId: string;
    categories: { id: string; name: string }[];
    products: ProductOption[];
    ingredients: ProductRecipeIngredientOption[];
    createAction: ProductFormAction;
}) {
    return (
        <ProductFormDialog
            mode="create"
            eventId={eventId}
            categories={categories}
            products={products}
            ingredients={ingredients}
            action={createAction}
        />
    );
}
