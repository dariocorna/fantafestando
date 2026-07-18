import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import Category from "@/models/Category";
import Product from "@/models/Product";
import PosDevice from "@/models/PosDevice";
import Ingredient from "@/models/Ingredient";
import "@/models/Printer"; // Import to register schema for .populate()
import "@/models/Peripheral"; // Import to register schema for .populate()
import { parsePredefinedTablesInput } from "@/lib/table-presets";
import { getCurrentDayCode, isProductAvailableToday } from "@/lib/product-availability";
import { getStockStatus } from "@/lib/inventory";
import { resolveQuickDiscountPresetsFromSettings, toLegacyQuickDiscountSettings } from "@/lib/quick-discount-presets";
import { normalizePosCatalogLayout } from "@/lib/pos-catalog-layout";
import {
    collectReferencedProductIds,
    isProductVisibleInChannel,
    normalizeProductKind,
    productRequiresMenuConfiguration,
} from "@/lib/fixed-menu";
import { ensureAuthenticatedSession } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
    try {
        const channel = request.nextUrl.searchParams.get("channel") === "pos" ? "pos" : "menu";
        if (channel === "pos") {
            const sessionCheck = await ensureAuthenticatedSession();
            if (!sessionCheck.ok) {
                return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
            }
        }
        await dbConnect();

        // 1. Find active event (or the latest one as fallback)
        let event = await Event.findOne({ active: true, archived: { $ne: true } }).lean();
        if (!event) {
            event = await Event.findOne({ archived: { $ne: true } }).sort({ createdAt: -1 }).lean();
        }

        if (!event) {
            return NextResponse.json({ error: "No events found" }, { status: 404 });
        }

        // 2. Fetch categories for this event
        const categories = await Category.find({ eventId: event._id })
            .sort({ printOrder: 1, name: 1 })
            .lean();

        // 3. Fetch products for this event
        const products = await Product.find({ eventId: event._id })
            .sort({ name: 1 })
            .lean();
        const recipeIngredientIds = channel === "pos"
            ? [...new Set(products.flatMap((product) =>
                Array.isArray((product as { recipeItems?: Array<{ ingredientId?: unknown }> }).recipeItems)
                    ? ((product as { recipeItems?: Array<{ ingredientId?: unknown }> }).recipeItems || [])
                        .map((entry) => String(entry.ingredientId || ""))
                        .filter(Boolean)
                    : []
            ))]
            : [];
        // Una sola query: gli ingredienti attivi e quelli referenziati dalle ricette (anche disattivati).
        const allIngredients = channel === "pos"
            ? await Ingredient.find({
                eventId: event._id,
                $or: [{ active: true }, { _id: { $in: recipeIngredientIds } }]
            })
                .sort({ name: 1 })
                .select("_id name shortName active")
                .lean()
            : [];
        const activeIngredients = allIngredients.filter((ingredient) => (ingredient as { active?: boolean }).active !== false);
        const ingredientById = new Map(allIngredients.map((ingredient) => [String(ingredient._id), ingredient]));
        const referencedProductIds = [...new Set(products.flatMap((product) => collectReferencedProductIds(product)))]
        const referencedProducts = referencedProductIds.length > 0
            ? await Product.find({
                eventId: event._id,
                _id: { $in: referencedProductIds }
            }).select("_id name").lean()
            : []
        const referencedProductById = new Map(referencedProducts.map((product) => [String(product._id), product]))
        const currentDayCode = getCurrentDayCode("Europe/Rome");
        const dayAvailableProducts = products.filter((product) =>
            isProductAvailableToday((product as { availableDays?: string[] }).availableDays || [], currentDayCode)
        );
        const availableProducts = dayAvailableProducts
            .filter((product) => {
                if (!isProductVisibleInChannel(product, channel === "pos" ? "POS" : "MENU")) return false
                if (channel === "pos") return true;
                const stockStatus = getStockStatus(
                    (product as { stockQuantity?: number | null }).stockQuantity ?? null,
                    Boolean((product as { isSoldOut?: boolean }).isSoldOut)
                );
                return stockStatus !== "OUT";
            })
            .map((product) => ({
                _id: String(product._id),
                categoryId: String(product.categoryId),
                name: product.name,
                shortName: product.shortName,
                description: product.description,
                basePrice: product.basePrice,
                variants: Array.isArray((product as { variants?: Array<{ optionName?: string, priceVariation?: number }> }).variants)
                    ? ((product as { variants: Array<{ optionName?: string, priceVariation?: number }> }).variants).map((variant) => ({
                        optionName: variant.optionName,
                        priceVariation: variant.priceVariation
                    }))
                    : [],
                kind: normalizeProductKind((product as { kind?: string }).kind),
                ...(channel === "pos" ? {
                    volunteerPrice: typeof (product as { volunteerPrice?: number }).volunteerPrice === "number"
                        ? (product as { volunteerPrice?: number }).volunteerPrice
                        : undefined,
                    stockQuantity: (product as { stockQuantity?: number | null }).stockQuantity ?? null,
                    isSoldOut: Boolean((product as { isSoldOut?: boolean }).isSoldOut),
                    stockStatus: getStockStatus(
                        (product as { stockQuantity?: number | null }).stockQuantity ?? null,
                        Boolean((product as { isSoldOut?: boolean }).isSoldOut)
                    ),
                    recipeItems: Array.isArray((product as {
                        recipeItems?: Array<{ ingredientId?: unknown, quantity?: number }>
                    }).recipeItems)
                        ? ((product as {
                            recipeItems?: Array<{ ingredientId?: unknown, quantity?: number }>
                        }).recipeItems || []).map((entry) => {
                            const ingredientId = String(entry.ingredientId || "");
                            const ingredient = ingredientById.get(ingredientId) as ({ name?: string, shortName?: string } | undefined);
                            return {
                                ingredientId,
                                name: ingredient?.name || "Ingrediente",
                                shortName: ingredient?.shortName || undefined,
                                quantity: Number(entry.quantity || 1)
                            };
                        }).filter((entry) => entry.ingredientId)
                        : []
                } : {}),
                requiresConfiguration: productRequiresMenuConfiguration(product),
                menuComponents: Array.isArray((product as { menuComponents?: Array<{ productId?: unknown, quantity?: number }> }).menuComponents)
                    ? ((product as { menuComponents?: Array<{ productId?: unknown, quantity?: number }> }).menuComponents || [])
                        .map((component) => {
                            const productId = String(component.productId || "")
                            const referenced = referencedProductById.get(productId) as ({ name?: string } | undefined)
                            return {
                                productId,
                                quantity: Number(component.quantity || 1),
                                name: referenced?.name || "Prodotto"
                            }
                        })
                    : [],
                menuChoiceGroups: Array.isArray((product as {
                    menuChoiceGroups?: Array<{
                        id?: string
                        name?: string
                        minSelections?: number
                        maxSelections?: number
                        options?: Array<{ productId?: unknown, quantity?: number }>
                    }>
                }).menuChoiceGroups)
                    ? ((product as {
                        menuChoiceGroups?: Array<{
                            id?: string
                            name?: string
                            minSelections?: number
                            maxSelections?: number
                            options?: Array<{ productId?: unknown, quantity?: number }>
                        }>
                    }).menuChoiceGroups || []).map((group, index) => ({
                        id: group.id || `group-${index + 1}`,
                        name: group.name || `Scelta ${index + 1}`,
                        minSelections: Number(group.minSelections || 0),
                        maxSelections: Number(group.maxSelections || 1),
                        options: Array.isArray(group.options)
                            ? group.options.map((option) => {
                                const productId = String(option.productId || "")
                                const referenced = referencedProductById.get(productId) as ({ name?: string } | undefined)
                                return {
                                    productId,
                                    quantity: Number(option.quantity || 1),
                                    name: referenced?.name || "Prodotto"
                                }
                            }).filter((option) => option.productId)
                            : []
                    }))
                    : []
            }));
        const availableCategoryIds = new Set(
            availableProducts.map((product) => String((product as { categoryId: unknown }).categoryId))
        );
        const availableCategories = categories.filter((category) => availableCategoryIds.has(String(category._id)));

        // 4. Fetch POS Devices for authenticated POS only
        const posDevices = channel === "pos"
            ? await PosDevice.find({ eventId: event._id })
                .populate({ path: "printerId", select: "name ip port isVirtual emulatorSlot" })
                .populate({ path: "paymentTerminalId", select: "name type" })
                .populate({ path: "cashBoxId", select: "name type" })
                .lean()
            : [];

        const serializedPosDevices = posDevices.map((device) => ({
            _id: String(device._id),
            name: device.name,
            printerId: device.printerId && typeof device.printerId === "object"
                ? {
                    _id: String((device.printerId as { _id: unknown })._id),
                    name: (device.printerId as { name?: string }).name || "",
                    ip: (device.printerId as { ip?: string }).ip || "",
                    port: (device.printerId as { port?: number }).port || 9100,
                    isVirtual: Boolean((device.printerId as { isVirtual?: boolean }).isVirtual),
                    emulatorSlot: (device.printerId as { emulatorSlot?: number }).emulatorSlot
                }
                : (device.printerId ? String(device.printerId) : undefined),
            paymentTerminalId: device.paymentTerminalId && typeof device.paymentTerminalId === "object"
                ? {
                    _id: String((device.paymentTerminalId as { _id: unknown })._id),
                    name: (device.paymentTerminalId as { name?: string }).name || "",
                    type: (device.paymentTerminalId as { type?: string }).type || "OTHER"
                }
                : (device.paymentTerminalId ? String(device.paymentTerminalId) : undefined),
            cashBoxId: device.cashBoxId && typeof device.cashBoxId === "object"
                ? {
                    _id: String((device.cashBoxId as { _id: unknown })._id),
                    name: (device.cashBoxId as { name?: string }).name || "",
                    type: (device.cashBoxId as { type?: string }).type || "OTHER"
                }
                : (device.cashBoxId ? String(device.cashBoxId) : undefined)
        }));

        const quickDiscountPresets = resolveQuickDiscountPresetsFromSettings(event.settings);
        const legacyQuickDiscount = toLegacyQuickDiscountSettings(quickDiscountPresets);

        const sanitizedEvent = {
            _id: String(event._id),
            name: event.name,
            settings: {
                askName: event.settings?.askName ?? false,
                askTable: event.settings?.askTable ?? false,
                posCatalogLayout: normalizePosCatalogLayout(event.settings?.posCatalogLayout),
                menuHeaderLogoUrl: event.settings?.menuHeaderLogoUrl || "",
                ...(channel === "pos" ? {
                    quickDiscountPresets,
                    quickStaffDiscountEnabled: legacyQuickDiscount.quickStaffDiscountEnabled,
                    quickStaffDiscountLabel: legacyQuickDiscount.quickStaffDiscountLabel,
                    quickStaffDiscountType: legacyQuickDiscount.quickStaffDiscountType,
                    quickStaffDiscountValue: legacyQuickDiscount.quickStaffDiscountValue
                } : {})
            },
            predefinedTables: parsePredefinedTablesInput(
                Array.isArray(event.predefinedTables) ? event.predefinedTables.join("\n") : "",
                Number.MAX_SAFE_INTEGER
            )
        };

        return NextResponse.json(
            {
                event: sanitizedEvent,
                categories: availableCategories,
                products: availableProducts,
                ingredients: channel === "pos"
                    ? activeIngredients.map((ingredient) => ({
                        _id: String(ingredient._id),
                        name: ingredient.name,
                        shortName: ingredient.shortName || undefined
                    }))
                    : [],
                posDevices: channel === "pos" ? serializedPosDevices : []
            },
            {
                headers: {
                    "Cache-Control": "no-store, no-cache, must-revalidate"
                }
            }
        );
    } catch (error) {
        console.error("POS Init Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
