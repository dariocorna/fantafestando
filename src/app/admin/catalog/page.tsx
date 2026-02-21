import dbConnect from "@/lib/mongoose";
import Category from "@/models/Category";
import Product from "@/models/Product";
import Event from "@/models/Event";
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
    const events = await Event.find({}).lean();
    const categories = await Category.find({}).lean();
    const products = await Product.find({}).populate('categoryId').lean();

    async function createCategory(formData: FormData) {
        "use server"
        const name = formData.get("name") as string;
        const eventId = formData.get("eventId") as string;
        const uiColor = formData.get("uiColor") as string || "bg-blue-500";

        if (!name || !eventId) return;

        await dbConnect();
        await Category.create({ name, eventId, uiColor });
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
                    <h2 className="text-2xl font-bold">Categories</h2>
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm" id="new-category-btn">+ New Category</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <form action={createCategory}>
                                <DialogHeader>
                                    <DialogTitle>Add Category</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="eventId">Event</Label>
                                        <select name="eventId" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background" required>
                                            {events.map((e: any) => (
                                                <option key={e._id.toString()} value={e._id.toString()}>{e.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="cat-name">Name</Label>
                                        <Input id="cat-name" name="name" placeholder="Primi, Bar..." required />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="uiColor">Color Class (Tailwind)</Label>
                                        <Input id="uiColor" name="uiColor" placeholder="bg-red-500" defaultValue="bg-blue-500" />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="submit">Save Category</Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Color</TableHead>
                            <TableHead>Event</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories.map((cat: any) => (
                            <TableRow key={cat._id.toString()}>
                                <TableCell className="font-medium">{cat.name}</TableCell>
                                <TableCell><div className={`w-4 h-4 rounded-full ${cat.uiColor}`} /></TableCell>
                                <TableCell>{events.find(e => e._id.toString() === cat.eventId.toString())?.name || "N/A"}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>

            <section>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Products</h2>
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm" id="new-product-btn">+ New Product</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <form action={createProduct}>
                                <DialogHeader>
                                    <DialogTitle>Add Product</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="prod-eventId">Event</Label>
                                        <select name="eventId" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background" required>
                                            {events.map((e: any) => (
                                                <option key={e._id.toString()} value={e._id.toString()}>{e.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="categoryId">Category</Label>
                                        <select name="categoryId" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background" required>
                                            {categories.map((c: any) => (
                                                <option key={c._id.toString()} value={c._id.toString()}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="prod-name">Name</Label>
                                        <Input id="prod-name" name="name" placeholder="Pasta, Beer..." required />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="basePrice">Base Price (€)</Label>
                                        <Input id="basePrice" name="basePrice" type="number" step="0.01" placeholder="5.00" required />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="submit">Save Product</Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Variants</TableHead>
                            <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {products.map((p: any) => (
                            <TableRow key={p._id.toString()}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell>{(p.categoryId as any)?.name || "N/A"}</TableCell>
                                <TableCell>{p.basePrice.toFixed(2)} €</TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {p.variants?.map((v: any, idx: number) => (
                                            <span key={idx} className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                {v.optionName} ({v.priceVariation >= 0 ? '+' : ''}{v.priceVariation}€)
                                            </span>
                                        ))}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="outline" size="xs">Variants</Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                            <form action={addVariant}>
                                                <input type="hidden" name="productId" value={p._id.toString()} />
                                                <DialogHeader>
                                                    <DialogTitle>Manage Variants for {p.name}</DialogTitle>
                                                </DialogHeader>
                                                <div className="grid gap-4 py-4">
                                                    <div className="grid gap-2">
                                                        <Label htmlFor="optionName">Option Name</Label>
                                                        <Input name="optionName" placeholder="Extra Cheese..." required />
                                                    </div>
                                                    <div className="grid gap-2">
                                                        <Label htmlFor="priceVariation">Price Variation (€)</Label>
                                                        <Input name="priceVariation" type="number" step="0.01" placeholder="1.00" required />
                                                    </div>
                                                </div>
                                                <DialogFooter>
                                                    <Button type="submit">Add Variant</Button>
                                                </DialogFooter>
                                            </form>
                                        </DialogContent>
                                    </Dialog>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>
        </div>
    );
}

