import dbConnect from "@/lib/mongoose";
import Category, { ICategory } from "@/models/Category";
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
import { DeleteForm } from "@/components/delete-form";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog";
import { revalidatePath } from "next/cache";
import { EditCategoryDialog } from "@/components/edit-category-dialog";
import { EditProductDialog } from "@/components/edit-product-dialog";
import { CreateCategoryDialog } from "@/components/create-category-dialog";
import { CreateProductDialog } from "@/components/create-product-dialog";
import { X } from "lucide-react";

function getReferencedId(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === "object" && "_id" in value) {
        const populated = value as { _id?: unknown };
        return populated._id ? String(populated._id) : undefined;
    }
    return String(value);
}

export default async function AdminCatalog() {
    await dbConnect();
    const currentEventId = await getAdminContextEventId();

    if (!currentEventId) {
        return <div className="text-center p-10 text-muted-foreground">Nessuna festa attiva o selezionata. Seleziona una festa dalla barra in alto.</div>;
    }

    const categories = await Category.find({ eventId: currentEventId }).populate('printerId').lean();
    const products = await Product.find({ eventId: currentEventId }).populate('categoryId').lean();
    const printers = await Printer.find({ eventId: currentEventId }).lean();

    async function createCategory(formData: FormData) {
        "use server"
        const name = formData.get("name") as string;
        const eventId = formData.get("eventId") as string;
        const uiColor = formData.get("uiColor") as string || "bg-blue-500";
        const printerId = formData.get("printerId") as string;

        if (!name || !eventId) return;

        await dbConnect();
        await Category.create({ name, eventId, uiColor, printerId: printerId || undefined });
        revalidatePath("/admin/catalog");
    }

    async function createProduct(formData: FormData) {
        "use server"
        const name = formData.get("name") as string;
        const categoryId = formData.get("categoryId") as string;
        const basePrice = parseFloat(formData.get("basePrice") as string);
        const eventId = formData.get("eventId") as string;

        if (!name || !categoryId || isNaN(basePrice) || !eventId) return;

        await dbConnect();
        await Product.create({
            name,
            categoryId,
            basePrice,
            eventId,
            isSoldOut: false,
            variants: []
        });
        revalidatePath("/admin/catalog");
    }

    async function deleteCategory(formData: FormData) {
        "use server"
        const id = formData.get("id") as string;
        if (!id) return;
        await dbConnect();
        await Category.findByIdAndDelete(id);
        // Also delete products in this category to keep consistency
        await Product.deleteMany({ categoryId: id });
        revalidatePath("/admin/catalog");
    }

    async function updateCategory(formData: FormData) {
        "use server"
        const id = formData.get("id") as string;
        const name = formData.get("name") as string;
        const uiColor = formData.get("uiColor") as string;
        const printerId = formData.get("printerId") as string;
        if (!id || !name) return;

        await dbConnect();
        await Category.findByIdAndUpdate(id, { name, uiColor, printerId: printerId || null });
        revalidatePath("/admin/catalog");
    }

    async function deleteProduct(formData: FormData) {
        "use server"
        const id = formData.get("id") as string;
        if (!id) return;
        await dbConnect();
        await Product.findByIdAndDelete(id);
        revalidatePath("/admin/catalog");
    }

    async function updateProduct(formData: FormData) {
        "use server"
        const id = formData.get("id") as string;
        const name = formData.get("name") as string;
        const categoryId = formData.get("categoryId") as string;
        const basePrice = parseFloat(formData.get("basePrice") as string);
        if (!id || !name || !categoryId || isNaN(basePrice)) return;

        await dbConnect();
        await Product.findByIdAndUpdate(id, { name, categoryId, basePrice });
        revalidatePath("/admin/catalog");
    }

    async function addVariant(formData: FormData) {
        "use server"
        const productId = formData.get("productId") as string;
        const optionName = formData.get("optionName") as string;
        const priceVariation = parseFloat(formData.get("priceVariation") as string);

        if (!productId || !optionName || isNaN(priceVariation)) return;

        await dbConnect();
        await Product.findByIdAndUpdate(productId, {
            $push: { variants: { optionName, priceVariation } }
        });
        revalidatePath("/admin/catalog");
    }

    async function removeVariant(formData: FormData) {
        "use server"
        const productId = formData.get("productId") as string;
        const optionName = formData.get("optionName") as string;

        if (!productId || !optionName) return;

        await dbConnect();
        await Product.findByIdAndUpdate(productId, {
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
                        printers={printers.filter((p: IPrinter) => p.type === 'KITCHEN').map((p: IPrinter) => ({ id: String(p._id), name: p.name, ip: p.ip }))}
                        createAction={createCategory}
                    />
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Colore</TableHead>
                            <TableHead>Stampante Comanda</TableHead>
                            <TableHead className="w-[80px]">Azioni</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories.map((cat: ICategory) => (
                            <TableRow key={String(cat._id)}>
                                <TableCell className="font-medium">{cat.name}</TableCell>
                                <TableCell><div className={`w-4 h-4 rounded-full ${cat.uiColor}`} /></TableCell>
                                <TableCell>{(cat.printerId as unknown as IPrinter)?.name || "Default Cassa"}</TableCell>
                                <TableCell className="flex gap-2">
                                    <EditCategoryDialog
                                        category={{
                                            id: String(cat._id),
                                            name: cat.name,
                                            uiColor: cat.uiColor,
                                            printerId: getReferencedId(cat.printerId)
                                        }}
                                        printers={printers.filter((p: IPrinter) => p.type === 'KITCHEN').map((p: IPrinter) => ({ id: String(p._id), name: p.name, ip: p.ip }))}
                                        updateAction={updateCategory}
                                    />
                                    <DeleteForm
                                        id={String(cat._id)}
                                        idName="id"
                                        message="Eliminare la categoria e TUTTI i suoi prodotti?"
                                        action={deleteCategory}
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
                        createAction={createProduct}
                    />
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Categoria</TableHead>
                            <TableHead>Prezzo</TableHead>
                            <TableHead>Varianti</TableHead>
                            <TableHead className="w-[120px]">Azioni</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {products.map((p: IProduct) => (
                            <TableRow key={String(p._id)}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell>{(p.categoryId as unknown as ICategory)?.name || "N/A"}</TableCell>
                                <TableCell>{p.basePrice.toFixed(2)} €</TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {p.variants?.map((v, idx) => (
                                            <span key={idx} className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded flex items-center gap-1 group">
                                                <span>{v.optionName} ({v.priceVariation >= 0 ? '+' : ''}{v.priceVariation}€)</span>
                                                <form action={removeVariant} className="flex items-center">
                                                    <input type="hidden" name="productId" value={String(p._id)} />
                                                    <input type="hidden" name="optionName" value={v.optionName} />
                                                    <button type="submit" className="text-red-500 hover:bg-red-200 rounded-full cursor-pointer ml-1 p-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </form>
                                            </span>
                                        ))}
                                    </div>
                                </TableCell>
                                <TableCell className="flex gap-2">
                                    <EditProductDialog
                                        product={{
                                            id: String(p._id),
                                            name: p.name,
                                            categoryId: getReferencedId(p.categoryId) || "",
                                            basePrice: p.basePrice
                                        }}
                                        categories={categories.map((c: ICategory) => ({ id: String(c._id), name: c.name }))}
                                        updateAction={updateProduct}
                                    />
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="outline" size="icon" className="h-7 w-7" title="Aggiungi Variante">
                                                <span className="font-bold">+</span>
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                            <form action={addVariant}>
                                                <input type="hidden" name="productId" value={String(p._id)} />
                                                <DialogHeader>
                                                    <DialogTitle>Gestisci Varianti per {p.name}</DialogTitle>
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
                                                </div>
                                                <DialogFooter>
                                                    <Button type="submit">Aggiungi Variante</Button>
                                                </DialogFooter>
                                            </form>
                                        </DialogContent>
                                    </Dialog>

                                    <DeleteForm
                                        id={String(p._id)}
                                        idName="id"
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
