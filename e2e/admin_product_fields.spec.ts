import { expect, test } from "@playwright/test";
import {
    createAndActivateEvent,
    createCategory,
    createProduct,
    uniqueSuffix,
} from "./utils/fixtures";

test.describe("Catalogo admin - campi shortName e description", () => {
    test("crea e modifica shortName/description con persistenza in edit", async ({ page, isMobile }) => {
        test.skip(isMobile, "Scenario validato su desktop.");
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `Fields Event ${suffix}`;
        const categoryName = `Fields Category ${suffix}`;
        const productName = `Fields Product ${suffix}`;
        const productShortName = `FLD-${suffix}`;
        const productDescription = `Descrizione iniziale ${suffix}`;
        const updatedShortName = `UPD-${suffix}`;
        const updatedDescription = `Descrizione aggiornata ${suffix}`;

        await createAndActivateEvent(page, eventName);
        await createCategory(page, categoryName);
        await createProduct(page, categoryName, {
            name: productName,
            shortName: productShortName,
            description: productDescription,
            price: "4.50",
        });

        await page.goto("/admin/catalog");
        const productRow = page.locator("tr").filter({ hasText: productName }).first();
        await expect(productRow).toBeVisible();
        await expect(productRow).toContainText(productShortName);

        await productRow.getByRole("button", { name: "Modifica" }).first().click();
        const editDialog = page.getByRole("dialog").filter({ hasText: /Modifica Prodotto/i }).first();
        await expect(editDialog).toBeVisible();
        await editDialog.getByLabel("Etichetta breve POS/Scontrino (opzionale)").fill(updatedShortName);
        await editDialog.getByLabel("Descrizione Menu (opzionale)").fill(updatedDescription);
        await editDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click();
        await expect(editDialog).toBeHidden();

        await productRow.getByRole("button", { name: "Modifica" }).first().click();
        await expect(editDialog).toBeVisible();
        await expect(editDialog.getByLabel("Etichetta breve POS/Scontrino (opzionale)")).toHaveValue(updatedShortName);
        await expect(editDialog.getByLabel("Descrizione Menu (opzionale)")).toHaveValue(updatedDescription);
    });
});
