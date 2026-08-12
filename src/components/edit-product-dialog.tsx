"use client";

import type { ProductRecipeIngredientOption } from "@/components/product-recipe-editor";
import {
    ProductFormDialog,
    type ProductFormAction,
    type ProductFormProduct,
    type ProductOption
} from "@/components/product-form-dialog";

export function EditProductDialog({
    product,
    eventId,
    categories,
    products,
    ingredients,
    updateAction
}: {
    product: ProductFormProduct;
    eventId?: string;
    categories: { id: string; name: string }[];
    products: ProductOption[];
    ingredients: ProductRecipeIngredientOption[];
    updateAction: ProductFormAction;
}) {
    return (
        <ProductFormDialog
            mode="edit"
            product={product}
            eventId={eventId}
            categories={categories}
            products={products}
            ingredients={ingredients}
            action={updateAction}
        />
    );
}
