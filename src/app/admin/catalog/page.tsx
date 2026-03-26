import dbConnect from "@/lib/mongoose";
import mongoose from "mongoose";
import { ensureAdminSession } from "@/lib/authz";
import Category, { ICategory } from "@/models/Category";
import Ingredient, { IIngredient } from "@/models/Ingredient";
import Product, { IProduct } from "@/models/Product";
import Printer, { IPrinter } from "@/models/Printer";
import { getAdminContextEventId } from "@/lib/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { SortableCategoryTable } from "./sortable-category-table";
import { DeleteForm } from "@/components/delete-form";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog";
import { revalidatePath } from "next/cache";
import { EditProductDialog } from "@/components/edit-product-dialog";
import { CreateCategoryDialog } from "@/components/create-category-dialog";
import { CreateIngredientDialog } from "@/components/create-ingredient-dialog";
import { CreateProductDialog } from "@/components/create-product-dialog";
import { EditIngredientDialog } from "@/components/edit-ingredient-dialog";
import { validatePizzaCategoryConfiguration } from "@/lib/category-pizza-validation";
import { normalizeCategoryColor } from "@/lib/category-colors";
import { X } from "lucide-react";
import {
    formatAvailableDaysLabel,
    normalizeAvailableDays,
    parseAvailableDaysInput
} from "@/lib/product-availability";
import {
    getStockLabel,
    getStockStatus,
    parseStockQuantityInput
} from "@/lib/inventory";
import {
    normalizeProductDescription,
    normalizeProductShortName,
    validateProductShortName
} from "@/lib/product-fields";
import {
    normalizeRecipeItems,
    parseRecipeItemsInput,
} from "@/lib/ingredient-plan";
import {
    normalizeMenuChoiceGroups,
    normalizeMenuComponents,
    normalizeProductKind,
    normalizeSalesChannels,
    parseJsonArrayInput,
    parseSalesChannelsInput,
    type MenuChoiceGroupInput,
    type MenuComponentInput,
} from "@/lib/fixed-menu";

function getReferencedId(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === "object" && "_id" in value) {
        const populated = value as { _id?: unknown };
        return populated._id ? String(populated._id) : undefined;
    }
    return String(value);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseBasePriceInput(rawValue: FormDataEntryValue | null) {
    if (typeof rawValue !== "string") return null;
    const trimmed = rawValue.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, "."));
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function normalizeIngredientShortName(rawValue: FormDataEntryValue | null) {
    if (typeof rawValue !== "string") return undefined;
    const trimmed = rawValue.trim();
    return trimmed ? trimmed.slice(0, 24) : undefined;
}

function formatDirectPrice(product: Pick<IProduct, "kind" | "availableOnlyInMenus" | "basePrice">) {
    const kind = normalizeProductKind(product.kind);
    if (kind === "STANDARD" && product.availableOnlyInMenus) {
        return "Solo menu";
    }
    return `${Number(product.basePrice || 0).toFixed(2)} €`;
}

function formatSalesChannelsLabel(product: Pick<IProduct, "salesChannels">) {
    const channels = normalizeSalesChannels(product.salesChannels);
    if (channels.length === 2) return "POS + App";
    if (channels.includes("POS")) return "Solo POS";
    if (channels.includes("MENU")) return "Solo App";
    return "Nascosto";
}

function formatMenuSummary(product: Pick<IProduct, "kind" | "menuComponents" | "menuChoiceGroups">) {
    if (normalizeProductKind(product.kind) !== "FIXED_MENU") return "-";
    const fixedComponents = normalizeMenuComponents(product.menuComponents);
    const choiceGroups = normalizeMenuChoiceGroups(product.menuChoiceGroups);
    const parts: string[] = [];
    if (fixedComponents.length > 0) {
        parts.push(`${fixedComponents.length} fissi`);
    }
    if (choiceGroups.length > 0) {
        parts.push(`${choiceGroups.length} scelte`);
    }
    return parts.length > 0 ? parts.join(" · ") : "Menu vuoto";
}

function formatRecipeSummary(
    product: Pick<IProduct, "recipeItems">,
    ingredientById: Map<string, { name: string; shortName?: string }>
) {
    const recipeItems = normalizeRecipeItems(product.recipeItems);
    if (recipeItems.length === 0) return "Fallback legacy";

    return recipeItems
        .slice(0, 3)
        .map((entry) => {
            const ingredient = ingredientById.get(entry.ingredientId);
            const label = ingredient?.shortName || ingredient?.name || "Ingrediente rimosso";
            return `${label} x${entry.quantity}`;
        })
        .join(" · ");
}

async function parseProductPayload(
    formData: FormData,
    currentEventId: string | null,
    options?: { existingProductId?: string }
) {
    const submittedEventId = formData.get("eventId") as string | null;
    const name = ((formData.get("name") as string | null) || "").trim();
    const shortName = normalizeProductShortName(formData.get("shortName"));
    const description = normalizeProductDescription(formData.get("description"));
    const categoryId = (formData.get("categoryId") as string | null)?.trim() || "";
    const stockQuantity = parseStockQuantityInput(formData.get("stockQuantity") as string | null);
    const availableDays = parseAvailableDaysInput(formData.get("availableDays") as string | null);
    const normalizedSubmittedEventId = submittedEventId?.trim();
    const scopedEventId = currentEventId;
    const kind = normalizeProductKind(formData.get("kind"));
    const availableOnlyInMenus = formData.get("availableOnlyInMenus") === "on";
    const salesChannels = parseSalesChannelsInput(formData.getAll("salesChannels"));
    const fixedComponents = normalizeMenuComponents(
        parseJsonArrayInput<MenuComponentInput>(formData.get("menuComponentsJson"))
    );
    const choiceGroups = normalizeMenuChoiceGroups(
        parseJsonArrayInput<MenuChoiceGroupInput>(formData.get("menuChoiceGroupsJson"))
    );
    const recipeItems = parseRecipeItemsInput(formData.get("recipeItemsJson"));
    const parsedBasePrice = parseBasePriceInput(formData.get("basePrice"));
    const shortNameValidationError = validateProductShortName(shortName);

    if (shortNameValidationError) return { error: shortNameValidationError };
    if (!name || !categoryId || !scopedEventId) return { error: "Dati prodotto non validi" };
    if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return { error: "Festa non valida" };

    const category = await Category.findOne({ _id: categoryId, eventId: scopedEventId }).select("_id").lean();
    if (!category) return { error: "Categoria non valida" };

    const existingProduct = await Product.findOne({
        eventId: scopedEventId,
        _id: options?.existingProductId ? { $ne: options.existingProductId } : { $exists: true },
        name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, "i") }
    }).select("_id").lean();
    if (existingProduct) {
        return { error: "Esiste già un prodotto con questo nome" };
    }

    if (shortName) {
        const existingShortName = await Product.findOne({
            eventId: scopedEventId,
            _id: options?.existingProductId ? { $ne: options.existingProductId } : { $exists: true },
            shortName: { $regex: new RegExp(`^${escapeRegExp(shortName)}$`, "i") }
        }).select("_id").lean();
        if (existingShortName) {
            return { error: "Esiste già un prodotto con questo nome breve" };
        }
    }

    if (kind === "FIXED_MENU" && availableOnlyInMenus) {
        return { error: "Un menu fisso non può essere marcato come solo menu" };
    }

    if (!salesChannels.includes("POS") && !salesChannels.includes("MENU")) {
        return { error: "Seleziona almeno un canale di vendita" };
    }

    if (kind === "STANDARD" && (fixedComponents.length > 0 || choiceGroups.length > 0)) {
        return { error: "Un prodotto standard non può contenere componenti o gruppi di scelta" };
    }

    if (kind === "FIXED_MENU" && fixedComponents.length === 0 && choiceGroups.length === 0) {
        return { error: "Configura almeno un componente o un gruppo di scelta per il menu" };
    }

    if (kind === "FIXED_MENU" && parsedBasePrice === null) {
        return { error: "Il prezzo fisso del menu è obbligatorio" };
    }

    if (kind === "STANDARD" && !availableOnlyInMenus && parsedBasePrice === null) {
        return { error: "Prezzo base obbligatorio" };
    }

    if (kind === "STANDARD" && availableOnlyInMenus && choiceGroups.length > 0) {
        return { error: "I prodotti solo menu non possono definire gruppi di scelta" };
    }

    if (kind === "FIXED_MENU" && recipeItems.length > 0) {
        return { error: "Configura gli ingredienti sui singoli prodotti del menu, non sul menu contenitore" };
    }

    const referencedProductIds = [
        ...fixedComponents.map((entry) => entry.productId),
        ...choiceGroups.flatMap((group) => group.options.map((option) => option.productId))
    ];

    if (kind === "FIXED_MENU" && referencedProductIds.length > 0) {
        const uniqueReferencedProductIds = [...new Set(referencedProductIds)];
        const referencedProducts = await Product.find({
            eventId: scopedEventId,
            _id: { $in: uniqueReferencedProductIds }
        }).select("_id kind").lean() as Array<{ _id: string | { toString(): string }, kind?: string }>;

        if (referencedProducts.length !== uniqueReferencedProductIds.length) {
            return { error: "Alcuni prodotti del menu non sono validi per l'evento corrente" };
        }

        const referencedKindById = new Map(
            referencedProducts.map((product) => [product._id.toString(), normalizeProductKind(product.kind)])
        );

        for (const referencedProductId of uniqueReferencedProductIds) {
            if (options?.existingProductId && referencedProductId === options.existingProductId) {
                return { error: "Un menu non può includere se stesso" };
            }
            if (referencedKindById.get(referencedProductId) === "FIXED_MENU") {
                return { error: "In questa versione un menu non può includere un altro menu" };
            }
        }
    }

    for (const group of choiceGroups) {
        if (group.options.length === 0) {
            return { error: `Il gruppo ${group.name} non contiene opzioni` };
        }
        if (group.maxSelections < 1 || group.minSelections < 0 || group.minSelections > group.maxSelections) {
            return { error: `Il gruppo ${group.name} ha vincoli di scelta non validi` };
        }
    }

    if (recipeItems.length > 0) {
        const ingredientIds = [...new Set(recipeItems.map((entry) => entry.ingredientId))];
        const ingredients = await Ingredient.find({
            eventId: scopedEventId,
            _id: { $in: ingredientIds }
        }).select("_id").lean() as Array<{ _id: string | { toString(): string } }>;

        if (ingredients.length !== ingredientIds.length) {
            return { error: "Alcuni ingredienti selezionati non sono validi per l'evento corrente" };
        }
    }

    return {
        success: true as const,
        payload: {
            name,
            shortName,
            description,
            categoryId,
            kind,
            basePrice: kind === "FIXED_MENU"
                ? parsedBasePrice || 0
                : (availableOnlyInMenus ? (parsedBasePrice || 0) : (parsedBasePrice || 0)),
            availableOnlyInMenus: kind === "STANDARD" ? availableOnlyInMenus : false,
            salesChannels,
            stockQuantity,
            availableDays,
            recipeItems: kind === "STANDARD" ? recipeItems : [],
            menuComponents: kind === "FIXED_MENU" ? fixedComponents : [],
            menuChoiceGroups: kind === "FIXED_MENU" ? choiceGroups : [],
            isSoldOut: stockQuantity !== null ? stockQuantity <= 0 : false,
        }
    };
}

export default async function AdminCatalog() {
    await dbConnect();
    const currentEventId = await getAdminContextEventId();

    if (!currentEventId) {
        return <div className="text-center p-10 text-muted-foreground">Nessuna festa attiva o selezionata. Seleziona una festa dalla barra in alto.</div>;
    }

    const categories = await Category.find({ eventId: currentEventId }).sort({ printOrder: 1 }).populate('printerId').lean();
    const ingredients = await Ingredient.find({ eventId: currentEventId }).sort({ name: 1 }).lean();
    const products = await Product.find({ eventId: currentEventId }).populate('categoryId').lean();
    const printers = await Printer.find({ eventId: currentEventId }).lean();
    const ingredientById = new Map(
        ingredients.map((ingredient: IIngredient) => [String(ingredient._id), {
            name: ingredient.name,
            shortName: ingredient.shortName || undefined
        }])
    );
    async function createIngredient(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return { error: sessionCheck.error };

        const submittedEventId = formData.get("eventId") as string | null;
        const scopedEventId = currentEventId;
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const name = ((formData.get("name") as string | null) || "").trim();
        const shortName = normalizeIngredientShortName(formData.get("shortName"));
        const stockQuantity = parseStockQuantityInput(formData.get("stockQuantity") as string | null);
        const active = formData.get("active") === "on";
        const shortNameValidationError = validateProductShortName(shortName);

        if (shortNameValidationError) return { error: shortNameValidationError };
        if (!name || !scopedEventId) return { error: "Nome ingrediente obbligatorio" };
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return { error: "Festa non valida" };

        await dbConnect();

        const existingIngredient = await Ingredient.findOne({
            eventId: scopedEventId,
            name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, "i") }
        }).select("_id").lean();
        if (existingIngredient) {
            return { error: "Esiste già un ingrediente con questo nome" };
        }

        if (shortName) {
            const existingShortName = await Ingredient.findOne({
                eventId: scopedEventId,
                shortName: { $regex: new RegExp(`^${escapeRegExp(shortName)}$`, "i") }
            }).select("_id").lean();
            if (existingShortName) {
                return { error: "Esiste già un ingrediente con questo nome breve" };
            }
        }

        await Ingredient.create({
            eventId: scopedEventId,
            name,
            shortName,
            stockQuantity,
            active
        });
        revalidatePath("/admin/catalog");
        return { success: true };
    }

    async function createCategory(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return { error: sessionCheck.error };

        const submittedEventId = formData.get("eventId") as string | null;
        const name = ((formData.get("name") as string | null) || "").trim();
        const uiColor = normalizeCategoryColor(formData.get("uiColor") as string | null);
        const printerId = formData.get("printerId") as string;
        const skipKitchenPrint = formData.get("skipKitchenPrint") === "on";
        const pizzaFlowEnabled = formData.get("pizzaFlowEnabled") === "on";
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const scopedEventId = currentEventId;

        if (!name || !scopedEventId) return { error: "Nome categoria obbligatorio" };
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return { error: "Festa non valida" };

        await dbConnect();

        if (printerId) {
            const printer = await Printer.findOne({ _id: printerId, eventId: scopedEventId, type: "KITCHEN" }).select("_id").lean();
            if (!printer) return { error: "Stampante reparto non valida" };
        }
        const pizzaCategoryValidationError = validatePizzaCategoryConfiguration({
            pizzaFlowEnabled,
            printerId: printerId || undefined,
            skipKitchenPrint
        });
        if (pizzaCategoryValidationError) {
            return { error: pizzaCategoryValidationError };
        }

        const existingCategory = await Category.findOne({
            eventId: scopedEventId,
            name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, "i") }
        }).select("_id").lean();
        if (existingCategory) {
            return { error: "Esiste già una categoria con questo nome" };
        }

        // Assign printOrder = max+1 so new categories appear at the end
        const lastCategory = await Category.findOne({ eventId: scopedEventId }).sort({ printOrder: -1 }).select('printOrder').lean();
        const nextPrintOrder = (lastCategory?.printOrder ?? -1) + 1;

        await Category.create({
            name,
            eventId: scopedEventId,
            uiColor,
            printerId: printerId || undefined,
            printOrder: nextPrintOrder,
            skipKitchenPrint,
            pizzaFlowEnabled
        });
        revalidatePath("/admin/catalog");
        return { success: true };
    }

    async function createProduct(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return { error: sessionCheck.error };

        await dbConnect();
        const parsed = await parseProductPayload(formData, currentEventId);
        if (!parsed.success) {
            return { error: parsed.error };
        }

        await Product.create({
            ...parsed.payload,
            eventId: currentEventId,
            variants: []
        });
        revalidatePath("/admin/catalog");
        return { success: true };
    }

    async function updateIngredient(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return { error: sessionCheck.error };

        const id = (formData.get("id") as string | null)?.trim();
        const submittedEventId = formData.get("eventId") as string | null;
        const scopedEventId = currentEventId;
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const name = ((formData.get("name") as string | null) || "").trim();
        const shortName = normalizeIngredientShortName(formData.get("shortName"));
        const stockQuantity = parseStockQuantityInput(formData.get("stockQuantity") as string | null);
        const active = formData.get("active") === "on";
        const shortNameValidationError = validateProductShortName(shortName);

        if (shortNameValidationError) return { error: shortNameValidationError };
        if (!id || !name || !scopedEventId) return { error: "Dati ingrediente non validi" };
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return { error: "Festa non valida" };

        await dbConnect();

        const ingredient = await Ingredient.findOne({ _id: id, eventId: scopedEventId }).select("_id").lean();
        if (!ingredient) {
            return { error: "Ingrediente non trovato" };
        }

        const existingIngredient = await Ingredient.findOne({
            eventId: scopedEventId,
            _id: { $ne: id },
            name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, "i") }
        }).select("_id").lean();
        if (existingIngredient) {
            return { error: "Esiste già un ingrediente con questo nome" };
        }

        if (shortName) {
            const existingShortName = await Ingredient.findOne({
                eventId: scopedEventId,
                _id: { $ne: id },
                shortName: { $regex: new RegExp(`^${escapeRegExp(shortName)}$`, "i") }
            }).select("_id").lean();
            if (existingShortName) {
                return { error: "Esiste già un ingrediente con questo nome breve" };
            }
        }

        const updateSet: Record<string, unknown> = {
            name,
            stockQuantity,
            active,
            ...(shortName ? { shortName } : {})
        };
        const updateUnset: Record<string, 1> = shortName ? {} : { shortName: 1 };

        await Ingredient.findOneAndUpdate(
            { _id: id, eventId: scopedEventId },
            {
                $set: updateSet,
                ...(Object.keys(updateUnset).length > 0 ? { $unset: updateUnset } : {})
            }
        );
        revalidatePath("/admin/catalog");
        return { success: true };
    }

    async function reorderCategories(orderedIds: string[]) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const scopedEventId = currentEventId;
        if (!scopedEventId || !orderedIds || !orderedIds.length) return;

        await dbConnect();

        // Update each category with its new position as printOrder
        const bulkOps = orderedIds.map((id, index) => ({
            updateOne: {
                filter: {
                    _id: new mongoose.Types.ObjectId(id),
                    eventId: new mongoose.Types.ObjectId(scopedEventId)
                },
                update: { $set: { printOrder: index } }
            }
        }));

        await Category.bulkWrite(bulkOps);
        revalidatePath("/admin/catalog");
    }

    async function deleteCategory(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const submittedEventId = formData.get("eventId") as string | null;
        const id = formData.get("id") as string;
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const scopedEventId = currentEventId;
        if (!id || !scopedEventId) return;
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return;
        await dbConnect();
        const deletedCategory = await Category.findOneAndDelete({ _id: id, eventId: scopedEventId }).select("_id").lean();
        if (!deletedCategory) return;
        // Also delete products in this category to keep consistency
        await Product.deleteMany({ eventId: scopedEventId, categoryId: id });
        revalidatePath("/admin/catalog");
    }

    async function deleteIngredient(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const submittedEventId = formData.get("eventId") as string | null;
        const id = formData.get("id") as string;
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const scopedEventId = currentEventId;
        if (!id || !scopedEventId) return;
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return;

        await dbConnect();
        const deletedIngredient = await Ingredient.findOneAndDelete({ _id: id, eventId: scopedEventId }).select("_id").lean();
        if (!deletedIngredient) return;

        await Product.updateMany(
            { eventId: scopedEventId },
            { $pull: { recipeItems: { ingredientId: id } } }
        );
        revalidatePath("/admin/catalog");
    }

    async function updateCategory(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const submittedEventId = formData.get("eventId") as string | null;
        const id = formData.get("id") as string;
        const name = formData.get("name") as string;
        const uiColor = normalizeCategoryColor(formData.get("uiColor") as string | null);
        const printerId = formData.get("printerId") as string;
        const skipKitchenPrint = formData.get("skipKitchenPrint") === "on";
        const pizzaFlowEnabled = formData.get("pizzaFlowEnabled") === "on";
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const scopedEventId = currentEventId;
        if (!id || !name || !scopedEventId) return { error: "Dati categoria non validi" };
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return { error: "Festa non valida" };

        await dbConnect();
        if (printerId) {
            const printer = await Printer.findOne({ _id: printerId, eventId: scopedEventId, type: "KITCHEN" }).select("_id").lean();
            if (!printer) return { error: "Stampante reparto non valida" };
        }
        const pizzaCategoryValidationError = validatePizzaCategoryConfiguration({
            pizzaFlowEnabled,
            printerId: printerId || undefined,
            skipKitchenPrint
        });
        if (pizzaCategoryValidationError) {
            return { error: pizzaCategoryValidationError };
        }

        await Category.findOneAndUpdate(
            { _id: id, eventId: scopedEventId },
            { name, uiColor, printerId: printerId || null, skipKitchenPrint, pizzaFlowEnabled }
        );
        revalidatePath("/admin/catalog");
        return { success: true };
    }

    async function deleteProduct(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const submittedEventId = formData.get("eventId") as string | null;
        const id = formData.get("id") as string;
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const scopedEventId = currentEventId;
        if (!id || !scopedEventId) return;
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return;
        await dbConnect();
        await Product.findOneAndDelete({ _id: id, eventId: scopedEventId });
        revalidatePath("/admin/catalog");
    }

    async function updateProduct(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return { error: sessionCheck.error };

        const id = formData.get("id") as string;
        if (!id || !currentEventId) return { error: "Dati prodotto non validi" };

        await dbConnect();
        const existingProduct = await Product.findOne({ _id: id, eventId: currentEventId }).select("kind").lean() as ({ kind?: string } | null);
        if (!existingProduct) {
            return { error: "Prodotto non trovato" };
        }
        const parsed = await parseProductPayload(formData, currentEventId, { existingProductId: id });
        if (!parsed.success) {
            return { error: parsed.error };
        }

        const updateSet: Record<string, unknown> = {
            name: parsed.payload.name,
            categoryId: parsed.payload.categoryId,
            basePrice: parsed.payload.basePrice,
            kind: parsed.payload.kind,
            availableOnlyInMenus: parsed.payload.availableOnlyInMenus,
            salesChannels: parsed.payload.salesChannels,
            stockQuantity: parsed.payload.stockQuantity,
            isSoldOut: parsed.payload.isSoldOut,
            availableDays: parsed.payload.availableDays,
            recipeItems: parsed.payload.recipeItems,
            menuComponents: parsed.payload.menuComponents,
            menuChoiceGroups: parsed.payload.menuChoiceGroups,
            ...(parsed.payload.shortName ? { shortName: parsed.payload.shortName } : {}),
            ...(parsed.payload.description ? { description: parsed.payload.description } : {})
        };
        const updateUnset: Record<string, 1> = {
            ...(parsed.payload.shortName ? {} : { shortName: 1 }),
            ...(parsed.payload.description ? {} : { description: 1 }),
        };

        if (parsed.payload.kind === "FIXED_MENU" || parsed.payload.availableOnlyInMenus) {
            updateSet.variants = [];
        } else if (normalizeProductKind(existingProduct.kind) === "FIXED_MENU") {
            updateSet.variants = [];
        }

        await Product.findOneAndUpdate(
            { _id: id, eventId: currentEventId },
            {
                $set: updateSet,
                ...(Object.keys(updateUnset).length > 0 ? { $unset: updateUnset } : {})
            }
        );
        revalidatePath("/admin/catalog");
        return { success: true };
    }

    async function addVariant(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const submittedEventId = formData.get("eventId") as string | null;
        const productId = formData.get("productId") as string;
        const optionName = formData.get("optionName") as string;
        const priceVariation = parseFloat(formData.get("priceVariation") as string);
        const stockQuantity = parseStockQuantityInput(formData.get("stockQuantity") as string | null);
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const scopedEventId = currentEventId;

        if (!productId || !optionName || isNaN(priceVariation) || !scopedEventId) return;
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return;

        await dbConnect();
        const product = await Product.findOne({ _id: productId, eventId: scopedEventId }).select("kind availableOnlyInMenus").lean() as ({ kind?: string, availableOnlyInMenus?: boolean } | null);
        if (!product) return;
        if (normalizeProductKind(product.kind) !== "STANDARD" || Boolean(product.availableOnlyInMenus)) return;
        await Product.findOneAndUpdate({ _id: productId, eventId: scopedEventId }, {
            $push: { variants: { optionName, priceVariation, stockQuantity } }
        });
        revalidatePath("/admin/catalog");
    }

    async function removeVariant(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const submittedEventId = formData.get("eventId") as string | null;
        const productId = formData.get("productId") as string;
        const optionName = formData.get("optionName") as string;
        const normalizedSubmittedEventId = submittedEventId?.trim();
        const scopedEventId = currentEventId;

        if (!productId || !optionName || !scopedEventId) return;
        if (normalizedSubmittedEventId && normalizedSubmittedEventId !== scopedEventId) return;

        await dbConnect();
        await Product.findOneAndUpdate({ _id: productId, eventId: scopedEventId }, {
            $pull: { variants: { optionName } }
        });
        revalidatePath("/admin/catalog");
    }

    return (
        <div className="space-y-10">
            <section>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Categorie</h2>
                    <CreateCategoryDialog
                        eventId={currentEventId}
                        printers={printers.filter((p: IPrinter) => p.type === 'KITCHEN').map((p: IPrinter) => ({
                            id: String(p._id),
                            name: p.name,
                            ip: p.ip,
                            port: p.port || 9100
                        }))}
                        createAction={createCategory}
                    />
                </div>
                <SortableCategoryTable
                    categories={categories.map((c: ICategory) => ({
                        _id: String(c._id),
                        name: c.name,
                        uiColor: c.uiColor,
                        printOrder: c.printOrder,
                        printerName: (c.printerId as unknown as IPrinter)?.name || undefined,
                        printerId: getReferencedId(c.printerId),
                        skipKitchenPrint: Boolean(c.skipKitchenPrint),
                        pizzaFlowEnabled: Boolean(c.pizzaFlowEnabled),
                    }))}
                    onReorder={reorderCategories}
                    eventId={currentEventId}
                    printers={printers.filter((p: IPrinter) => p.type === 'KITCHEN').map((p: IPrinter) => ({
                        id: String(p._id),
                        name: p.name,
                        ip: p.ip,
                        port: p.port || 9100
                    }))}
                    updateAction={updateCategory}
                    deleteAction={deleteCategory}
                />

            </section>

            <section>
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold">Ingredienti</h2>
                        <p className="text-sm text-muted-foreground">
                            Gli ingredienti vengono riutilizzati nelle ricette prodotto e alimentano la coda ingredienti nel POS.
                        </p>
                    </div>
                    <CreateIngredientDialog
                        eventId={currentEventId}
                        createAction={createIngredient}
                    />
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Nome breve</TableHead>
                            <TableHead>Scorte</TableHead>
                            <TableHead>Stato</TableHead>
                            <TableHead className="w-[120px]">Azioni</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {ingredients.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                                    Nessun ingrediente configurato.
                                </TableCell>
                            </TableRow>
                        ) : ingredients.map((ingredient: IIngredient) => (
                            <TableRow key={String(ingredient._id)}>
                                <TableCell className="font-medium">{ingredient.name}</TableCell>
                                <TableCell className="text-slate-600">{ingredient.shortName || "-"}</TableCell>
                                <TableCell>
                                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${getStockStatus(ingredient.stockQuantity, false) === "OUT"
                                        ? "bg-red-100 text-red-700"
                                        : getStockStatus(ingredient.stockQuantity, false) === "LOW"
                                            ? "bg-amber-100 text-amber-700"
                                            : "bg-slate-100 text-slate-700"
                                        }`}>
                                        {getStockLabel(ingredient.stockQuantity, false)}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${ingredient.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                                        {ingredient.active ? "Attivo" : "Inattivo"}
                                    </span>
                                </TableCell>
                                <TableCell className="flex gap-2">
                                    <EditIngredientDialog
                                        ingredient={{
                                            id: String(ingredient._id),
                                            name: ingredient.name,
                                            shortName: ingredient.shortName || "",
                                            stockQuantity: ingredient.stockQuantity ?? null,
                                            active: Boolean(ingredient.active),
                                        }}
                                        eventId={currentEventId}
                                        updateAction={updateIngredient}
                                    />
                                    <DeleteForm
                                        id={String(ingredient._id)}
                                        idName="id"
                                        hiddenFields={[{ name: "eventId", value: currentEventId }]}
                                        message="Eliminare questo ingrediente? Verrà rimosso anche dalle ricette dei prodotti che lo usano."
                                        action={deleteIngredient}
                                        buttonSize="xs"
                                        iconSize={16}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>

            <section>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Prodotti</h2>
                    <CreateProductDialog
                        eventId={currentEventId}
                        categories={categories.map((c: ICategory) => ({ id: String(c._id), name: c.name }))}
                        ingredients={ingredients.map((ingredient: IIngredient) => ({
                            id: String(ingredient._id),
                            name: ingredient.name,
                            shortName: ingredient.shortName || "",
                            active: Boolean(ingredient.active)
                        }))}
                        products={products.map((p: IProduct) => ({
                            id: String(p._id),
                            name: p.name,
                            kind: normalizeProductKind(p.kind)
                        }))}
                        createAction={createProduct}
                    />
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Nome breve</TableHead>
                            <TableHead>Categoria</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Canali</TableHead>
                            <TableHead>Prezzo</TableHead>
                            <TableHead>Scorte</TableHead>
                            <TableHead>Disponibilità</TableHead>
                            <TableHead>Menu</TableHead>
                            <TableHead>Ricetta</TableHead>
                            <TableHead>Varianti</TableHead>
                            <TableHead className="w-[120px]">Azioni</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {products.map((p: IProduct) => (
                            <TableRow key={String(p._id)}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell className="font-medium text-slate-600">{p.shortName || "-"}</TableCell>
                                <TableCell>{(p.categoryId as unknown as ICategory)?.name || "N/A"}</TableCell>
                                <TableCell>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                                        {normalizeProductKind(p.kind) === "FIXED_MENU" ? "Menu fisso" : "Standard"}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                                        {formatSalesChannelsLabel(p)}
                                    </span>
                                </TableCell>
                                <TableCell>{formatDirectPrice(p)}</TableCell>
                                <TableCell>
                                    <span
                                        className={`rounded-full px-2 py-1 text-xs font-bold ${getStockStatus(p.stockQuantity, p.isSoldOut) === "OUT"
                                            ? "bg-red-100 text-red-700"
                                            : getStockStatus(p.stockQuantity, p.isSoldOut) === "LOW"
                                                ? "bg-amber-100 text-amber-700"
                                                : "bg-slate-100 text-slate-700"
                                            }`}
                                    >
                                        {getStockLabel(p.stockQuantity, p.isSoldOut)}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                                        {formatAvailableDaysLabel(p.availableDays)}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {Boolean(p.availableOnlyInMenus) ? (
                                            <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">
                                                Solo menu
                                            </span>
                                        ) : null}
                                        {normalizeProductKind(p.kind) === "FIXED_MENU" ? (
                                            <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-700">
                                                {formatMenuSummary(p)}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-slate-400">-</span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">
                                        {normalizeProductKind(p.kind) === "STANDARD"
                                            ? formatRecipeSummary(p, ingredientById)
                                            : "Derivata dai componenti"}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    {normalizeProductKind(p.kind) === "STANDARD" && !Boolean(p.availableOnlyInMenus) ? (
                                        <div className="flex flex-wrap gap-1">
                                            {p.variants?.map((v, idx) => (
                                                <span key={idx} className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded flex items-center gap-1 group">
                                                    <span>
                                                        {v.optionName} ({v.priceVariation >= 0 ? '+' : ''}{v.priceVariation}€)
                                                        {" · "}
                                                        {getStockLabel(v.stockQuantity, false)}
                                                    </span>
                                                    <form action={removeVariant} className="flex items-center">
                                                        <input type="hidden" name="productId" value={String(p._id)} />
                                                        <input type="hidden" name="eventId" value={currentEventId} />
                                                        <input type="hidden" name="optionName" value={v.optionName} />
                                                        <button type="submit" className="text-red-500 hover:bg-red-200 rounded-full cursor-pointer ml-1 p-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    </form>
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-slate-400">Non applicabili</span>
                                    )}
                                </TableCell>
                                <TableCell className="flex gap-2">
                                    <EditProductDialog
                                        product={{
                                            id: String(p._id),
                                            name: p.name,
                                            shortName: p.shortName || "",
                                            description: p.description || "",
                                            categoryId: getReferencedId(p.categoryId) || "",
                                            basePrice: p.basePrice,
                                            stockQuantity: p.stockQuantity ?? null,
                                            availableDays: normalizeAvailableDays(p.availableDays),
                                            kind: normalizeProductKind(p.kind),
                                            availableOnlyInMenus: Boolean(p.availableOnlyInMenus),
                                            salesChannels: normalizeSalesChannels(p.salesChannels),
                                            menuComponents: normalizeMenuComponents(p.menuComponents),
                                            menuChoiceGroups: normalizeMenuChoiceGroups(p.menuChoiceGroups),
                                            recipeItems: normalizeRecipeItems(p.recipeItems),
                                        }}
                                        eventId={currentEventId}
                                        categories={categories.map((c: ICategory) => ({ id: String(c._id), name: c.name }))}
                                        ingredients={ingredients.map((ingredient: IIngredient) => ({
                                            id: String(ingredient._id),
                                            name: ingredient.name,
                                            shortName: ingredient.shortName || "",
                                            active: Boolean(ingredient.active)
                                        }))}
                                        products={products.map((entry: IProduct) => ({
                                            id: String(entry._id),
                                            name: entry.name,
                                            kind: normalizeProductKind(entry.kind)
                                        }))}
                                        updateAction={updateProduct}
                                    />
                                    {normalizeProductKind(p.kind) === "STANDARD" && !Boolean(p.availableOnlyInMenus) ? (
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button variant="outline" size="icon" className="h-7 w-7" title="Aggiungi Variante">
                                                    <span className="font-bold">+</span>
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <form action={addVariant}>
                                                    <input type="hidden" name="productId" value={String(p._id)} />
                                                    <input type="hidden" name="eventId" value={currentEventId} />
                                                    <DialogHeader>
                                                        <DialogTitle>Gestisci Varianti per {p.name}</DialogTitle>
                                                        <DialogDescription>
                                                            Aggiungi una nuova opzione variante con prezzo e scorte dedicate.
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <div className="grid gap-4 py-4">
                                                        <div className="grid gap-2">
                                                            <Label htmlFor="optionName">Nome Opzione</Label>
                                                            <Input name="optionName" placeholder="Extra Formaggio..." required />
                                                        </div>
                                                        <div className="grid gap-2">
                                                            <Label htmlFor="priceVariation">Varianza Prezzo (€)</Label>
                                                            <Input name="priceVariation" type="number" step="0.01" placeholder="1.00" required />
                                                        </div>
                                                        <div className="grid gap-2">
                                                            <Label htmlFor="stockQuantity">Scorte Variante</Label>
                                                            <Input
                                                                name="stockQuantity"
                                                                type="number"
                                                                min="0"
                                                                step="1"
                                                                inputMode="numeric"
                                                                placeholder="Illimitato"
                                                            />
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button type="submit">Aggiungi Variante</Button>
                                                    </DialogFooter>
                                                </form>
                                            </DialogContent>
                                        </Dialog>
                                    ) : null}

                                    <DeleteForm
                                        id={String(p._id)}
                                        idName="id"
                                        hiddenFields={[{ name: "eventId", value: currentEventId }]}
                                        message="Eliminare questo prodotto?"
                                        action={deleteProduct}
                                        buttonSize="xs"
                                        iconSize={16}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>
        </div>
    );
}
