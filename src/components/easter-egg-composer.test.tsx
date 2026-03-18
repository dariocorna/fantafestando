import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";

const onSubmitRasterMock = vi.fn();

vi.mock("@/lib/easter-egg-config", () => ({
    getThermalContentWidth: () => 240,
    getThermalPaperWidth: () => 280,
    normalizeEasterEggProcessingSettings: () => ({
        autoEnhance: true,
        brightnessBoost: 20,
        thresholdBase: 130
    })
}));

vi.mock("@/lib/easter-egg-raster", () => ({
    buildThermalRasterFromRgba: () => ({
        width: 240,
        height: 320,
        data: new Uint8Array(240 * 320)
    }),
    computeSourceCropRect: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 100
    }),
    getThermalTargetHeight: () => 320,
    unpackThermalRasterToPixels: () => new Uint8Array(280 * 320).fill(255)
}));

import { EasterEggComposer } from "@/components/easter-egg-composer";

function renderComposer() {
    return render(
        <EasterEggComposer
            title="Foto dell'ordine"
            description="Composer test"
            submitLabel="Allega foto all'ordine"
            submittingLabel="Invio allegato..."
            inputLabel="Selfie o foto"
            emptyStateTitle="Scatta la tua foto"
            emptyStateDescription="Anteprima mock"
            testIdPrefix="composer-test"
            onSubmitRaster={onSubmitRasterMock}
        />
    );
}

async function uploadPhoto(
    fileName = "photo.jpg",
    options?: { content?: string; lastModified?: number }
) {
    const input = screen.getByTestId("composer-test-file-input");
    const file = new File(
        [options?.content || "fake-image"],
        fileName,
        {
            type: "image/jpeg",
            lastModified: options?.lastModified
        }
    );
    await act(async () => {
        fireEvent.change(input, {
            target: {
                files: [file]
            }
        });
    });

    expect(screen.getByTestId("composer-test-thermal-preview")).toBeInTheDocument();
}

describe("EasterEggComposer", () => {
    beforeEach(() => {
        onSubmitRasterMock.mockReset();
        vi.useFakeTimers();

        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-photo");
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

        class MockImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            naturalWidth = 800;
            naturalHeight = 1200;

            set src(_value: string) {
                this.onload?.();
            }
        }

        Object.defineProperty(window, "Image", {
            writable: true,
            configurable: true,
            value: MockImage
        });

        Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
            writable: true,
            configurable: true,
            value: vi.fn(() => ({
                createImageData: (width: number, height: number) => ({
                    data: new Uint8ClampedArray(width * height * 4),
                    width,
                    height
                }),
                putImageData: vi.fn(),
                fillRect: vi.fn(),
                drawImage: vi.fn(),
                getImageData: (_x: number, _y: number, width: number, height: number) => ({
                    data: new Uint8ClampedArray(width * height * 4)
                })
            }))
        });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test("uploads the first photo automatically as soon as it is ready", async () => {
        onSubmitRasterMock.mockResolvedValue({
            success: "Foto allegata all'ordine. Puoi sostituirla finche' non paghi in cassa."
        });

        renderComposer();
        expect(screen.queryByRole("button", { name: /Scatta o scegli una foto/i })).not.toBeInTheDocument();
        await uploadPhoto();
        await act(async () => {
            await vi.runOnlyPendingTimersAsync();
        });

        expect(screen.getByRole("button", { name: /Sostituisci foto/i })).toBeInTheDocument();
        expect(screen.queryByTestId("composer-test-submit-button")).not.toBeInTheDocument();

        expect(screen.getByTestId("composer-test-state-banner")).toHaveTextContent("Foto confermata");
        expect(onSubmitRasterMock).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("composer-test-autosave-banner")).toHaveTextContent("Salvata automaticamente");
    });

    test("auto-saves a modified image after 5 seconds from the last change", async () => {
        onSubmitRasterMock.mockResolvedValue({
            success: "Foto allegata all'ordine. Puoi sostituirla finche' non paghi in cassa."
        });

        renderComposer();
        await uploadPhoto("first.jpg");
        await act(async () => {
            await vi.runOnlyPendingTimersAsync();
        });

        expect(screen.getByTestId("composer-test-state-banner")).toHaveTextContent("Foto confermata");

        await uploadPhoto("second.jpg");

        expect(screen.getByTestId("composer-test-state-banner")).toHaveTextContent("Nuova versione in attesa");

        expect(screen.queryByText(/Puoi sostituirla finche'/i)).not.toBeInTheDocument();
        expect(screen.getByTestId("composer-test-autosave-banner")).toHaveTextContent("Salvataggio automatico tra 5 secondi");
        expect(onSubmitRasterMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(4999);
        });
        expect(onSubmitRasterMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(1);
            await Promise.resolve();
        });

        expect(onSubmitRasterMock).toHaveBeenCalledTimes(2);
    });

    test("restarts the autosave countdown when the image changes again", async () => {
        onSubmitRasterMock.mockResolvedValue({
            success: "Foto allegata all'ordine. Puoi sostituirla finche' non paghi in cassa."
        });

        renderComposer();
        await uploadPhoto("camera.jpg", { content: "first-image", lastModified: 1000 });
        await act(async () => {
            await vi.runOnlyPendingTimersAsync();
        });

        expect(screen.getByTestId("composer-test-state-banner")).toHaveTextContent("Foto confermata");

        await uploadPhoto("camera.jpg", { content: "second-image", lastModified: 2000 });

        expect(screen.getByTestId("composer-test-state-banner")).toHaveTextContent("Nuova versione in attesa");

        await act(async () => {
            vi.advanceTimersByTime(3000);
        });

        await uploadPhoto("camera.jpg", { content: "third-image", lastModified: 3000 });
        expect(onSubmitRasterMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
        expect(onSubmitRasterMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(2000);
            await Promise.resolve();
        });

        expect(onSubmitRasterMock).toHaveBeenCalledTimes(2);
    });

    test("opens the file picker from the empty preview area before any image is loaded", () => {
        const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);

        renderComposer();
        fireEvent.click(screen.getByTestId("composer-test-empty-state-trigger"));

        expect(inputClickSpy).toHaveBeenCalled();
        expect(screen.queryByRole("button", { name: /Scatta o scegli una foto/i })).not.toBeInTheDocument();
    });
});
