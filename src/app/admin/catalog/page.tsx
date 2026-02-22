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

    async function deleteProduct(formData: FormData) {
        "use server"
        const id = formData.get("id") as string;
        if (!id) return;
        await dbConnect();
        await Product.findByIdAndDelete(id);
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

    return (
        <div className="space-y-10">
            <section>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Categorie</h2>
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm" id="new-category-btn">+ Nuova Categoria</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <form action={createCategory}>
                                <DialogHeader>
                                    <DialogTitle>Aggiungi Categoria</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <input type="hidden" name="eventId" value={currentEventId} />
                                    <div className="grid gap-2">
                                        <Label htmlFor="cat-name">Nome</Label>
                                        <Input id="cat-name" name="name" placeholder="Primi, Bar..." required />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="uiColor">Classe Colore (Tailwind)</Label>
                                        <Input id="uiColor" name="uiColor" placeholder="bg-red-500" defaultValue="bg-blue-500" />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="printerId">Stampante Reparto (Opzionale)</Label>
                                        <select id="printerId" name="printerId" aria-label="Stampante Reparto" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                                            <option value="">Nessuna (Copia singola in cassa)</option>
                                            {printers.filter((p: IPrinter) => p.type === 'KITCHEN').map((p: IPrinter) => (
                                                <option key={String(p._id)} value={String(p._id)}>{p.name} ({p.ip})</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="submit">Salva Categoria</Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
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
                                <TableCell>
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
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm" id="new-product-btn">+ Nuovo Prodotto</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <form action={createProduct}>
                                <DialogHeader>
                                    <DialogTitle>Aggiungi Prodotto</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <input type="hidden" name="eventId" value={currentEventId} />
                                    <div className="grid gap-2">
                                        <Label htmlFor="categoryId">Categoria</Label>
                                        <select name="categoryId" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background" required>
                                            {categories.map((c: ICategory) => (
                                                <option key={String(c._id)} value={String(c._id)}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="prod-name">Nome</Label>
                                        <Input id="prod-name" name="name" placeholder="Pasta, Birra..." required />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="basePrice">Prezzo Base (€)</Label>
                                        <Input id="basePrice" name="basePrice" type="number" step="0.01" placeholder="5.00" required />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="submit">Salva Prodotto</Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
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
                                            <span key={idx} className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                {v.optionName} ({v.priceVariation >= 0 ? '+' : ''}{v.priceVariation}€)
                                            </span>
                                        ))}
                                    </div>
                                </TableCell>
                                <TableCell className="flex gap-2">
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="outline" size="xs">Varianti</Button>
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
