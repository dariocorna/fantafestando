"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, PencilLine, Sparkles, Upload, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    getThermalContentWidth,
    getThermalPaperWidth,
    normalizeEasterEggProcessingSettings,
    type EasterEggProcessingSettings
} from "@/lib/easter-egg-config";
import {
    buildThermalRasterFromRgba,
    computeSourceCropRect,
    getThermalTargetHeight,
    unpackThermalRasterToPixels,
    type ThermalRasterPayload
} from "@/lib/easter-egg-raster";

interface EasterEggComposerResult {
    success?: string;
    error?: string;
}

interface EasterEggComposerProps {
    title: string;
    description: string;
    submitLabel: string;
    submittingLabel: string;
    inputLabel: string;
    helpText?: string;
    emptyStateTitle: string;
    emptyStateDescription: string;
    captureMode?: "user" | "environment";
    showAdvancedControls?: boolean;
    testIdPrefix: string;
    onSubmitRaster: (raster: ThermalRasterPayload) => Promise<EasterEggComposerResult>;
}

interface PointerPoint {
    x: number;
    y: number;
}

interface GestureStartState {
    centerX: number;
    centerY: number;
    zoom: number;
}

const PREVIEW_CONTENT_WIDTH = 240;
const PREVIEW_PAPER_WIDTH = Math.round((PREVIEW_CONTENT_WIDTH / getThermalContentWidth()) * getThermalPaperWidth());

function clamp(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function midpoint(first: PointerPoint, second: PointerPoint) {
    return {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2
    };
}

function distance(first: PointerPoint, second: PointerPoint) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function createCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function drawPreviewToCanvas(canvas: HTMLCanvasElement, raster: ThermalRasterPayload) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = PREVIEW_PAPER_WIDTH;
    canvas.height = raster.height;
    const pixels = unpackThermalRasterToPixels(raster);
    const imageData = ctx.createImageData(PREVIEW_PAPER_WIDTH, raster.height);
    imageData.data.fill(255);

    const leftPad = Math.floor((PREVIEW_PAPER_WIDTH - raster.width) / 2);
    for (let y = 0; y < raster.height; y += 1) {
        for (let x = 0; x < raster.width; x += 1) {
            const sourceValue = pixels[(y * raster.width) + x] ?? 255;
            const destIndex = ((y * PREVIEW_PAPER_WIDTH) + leftPad + x) * 4;
            imageData.data[destIndex] = sourceValue;
            imageData.data[destIndex + 1] = sourceValue;
            imageData.data[destIndex + 2] = sourceValue;
            imageData.data[destIndex + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
}

function buildRasterFromImage(
    image: HTMLImageElement,
    targetWidth: number,
    cropState: { centerX: number; centerY: number; zoom: number },
    processing: EasterEggProcessingSettings
) {
    const targetHeight = getThermalTargetHeight(targetWidth);
    const cropRect = computeSourceCropRect(image.naturalWidth, image.naturalHeight, {
        centerX: cropState.centerX,
        centerY: cropState.centerY,
        zoom: cropState.zoom,
        aspectRatio: "THERMAL_58"
    });

    const sourceCanvas = createCanvas(targetWidth, targetHeight);
    const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
        throw new Error("Canvas non disponibile");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(
        image,
        cropRect.left,
        cropRect.top,
        cropRect.width,
        cropRect.height,
        0,
        0,
        targetWidth,
        targetHeight
    );

    return buildThermalRasterFromRgba(
        ctx.getImageData(0, 0, targetWidth, targetHeight).data,
        targetWidth,
        targetHeight,
        processing
    );
}

export function EasterEggComposer({
    title,
    description,
    submitLabel,
    submittingLabel,
    inputLabel,
    helpText,
    emptyStateTitle,
    emptyStateDescription,
    captureMode,
    showAdvancedControls = false,
    testIdPrefix,
    onSubmitRaster
}: EasterEggComposerProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const pointerMapRef = useRef<Map<number, PointerPoint>>(new Map());
    const gestureStartRef = useRef<GestureStartState | null>(null);
    const gestureCropRectRef = useRef<{ width: number; height: number } | null>(null);
    const pinchStartRef = useRef<{ midpoint: PointerPoint; distance: number } | null>(null);
    const dragStartPointRef = useRef<PointerPoint | null>(null);

    const [fileName, setFileName] = useState("");
    const [fileIdentity, setFileIdentity] = useState<string | null>(null);
    const [status, setStatus] = useState<EasterEggComposerResult>({});
    const [fileError, setFileError] = useState<string | null>(null);
    const [isImageReady, setIsImageReady] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmedRasterSignature, setConfirmedRasterSignature] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1.6);
    const [centerX, setCenterX] = useState(50);
    const [centerY, setCenterY] = useState(50);
    const [processing, setProcessing] = useState<EasterEggProcessingSettings>(
        normalizeEasterEggProcessingSettings(undefined)
    );
    const currentRasterSignature = isImageReady
        ? [
            fileIdentity || fileName,
            centerX.toFixed(3),
            centerY.toFixed(3),
            zoom.toFixed(3),
            processing.autoEnhance ? "1" : "0",
            processing.brightnessBoost.toFixed(0),
            processing.thresholdBase.toFixed(0)
        ].join("|")
        : null;
    const isSelectionConfirmed = Boolean(
        currentRasterSignature
        && confirmedRasterSignature
        && currentRasterSignature === confirmedRasterSignature
    );
    const hasPendingConfirmation = Boolean(
        currentRasterSignature
        && (!confirmedRasterSignature || currentRasterSignature !== confirmedRasterSignature)
    );
    const choosePhotoLabel = fileName ? "Sostituisci foto" : "Scatta o scegli una foto";
    const previewStatusChipLabel = isSelectionConfirmed
        ? "Confermata"
        : hasPendingConfirmation
            ? confirmedRasterSignature
                ? "Nuova versione"
                : "Bozza"
            : null;
    const submitButtonLabel = isSubmitting
        ? submittingLabel
        : isSelectionConfirmed
            ? "Foto confermata"
            : confirmedRasterSignature
                ? "Conferma nuova versione"
                : submitLabel;
    const submitButtonHint = isSelectionConfirmed
        ? "Puoi ancora ritoccarla se vuoi"
        : confirmedRasterSignature
            ? "Sostituisce la foto gia' confermata"
            : "Conferma l'anteprima mostrata sopra";

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const canvas = previewCanvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image || !isImageReady) return;

        const frame = window.requestAnimationFrame(() => {
            const previewRaster = buildRasterFromImage(image, PREVIEW_CONTENT_WIDTH, { centerX, centerY, zoom }, processing);
            drawPreviewToCanvas(canvas, previewRaster);
        });

        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [centerX, centerY, isImageReady, processing, zoom]);

    useEffect(() => {
        if (!status.success || !confirmedRasterSignature || !currentRasterSignature) return;
        if (currentRasterSignature !== confirmedRasterSignature) {
            setStatus({});
        }
    }, [confirmedRasterSignature, currentRasterSignature, status.success]);

    const openFilePicker = () => {
        fileInputRef.current?.click();
    };

    const handleEmptyStateKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openFilePicker();
    };

    const resetGestureState = () => {
        gestureStartRef.current = null;
        gestureCropRectRef.current = null;
        pinchStartRef.current = null;
        dragStartPointRef.current = null;
        pointerMapRef.current.clear();
    };

    const loadFile = (file: File | null) => {
        setStatus({});
        setFileError(null);
        resetGestureState();

        if (!file) {
            return;
        }
        if (!file.type.startsWith("image/")) {
            setFileError("Seleziona una immagine valida.");
            return;
        }

        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
        }

        const objectUrl = URL.createObjectURL(file);
        objectUrlRef.current = objectUrl;
        setFileName(file.name);
        setFileIdentity([
            file.name,
            String(file.size),
            String(file.lastModified)
        ].join(":"));
        setIsImageReady(false);
        setZoom(1.6);
        setCenterX(50);
        setCenterY(50);

        const image = new window.Image();
        image.onload = () => {
            imageRef.current = image;
            setIsImageReady(true);
        };
        image.onerror = () => {
            setFileError("Impossibile leggere la foto selezionata.");
            setIsImageReady(false);
        };
        image.src = objectUrl;
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!isImageReady) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerMapRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointerMapRef.current.size === 1 && imageRef.current) {
            const cropRect = computeSourceCropRect(imageRef.current.naturalWidth, imageRef.current.naturalHeight, {
                centerX,
                centerY,
                zoom,
                aspectRatio: "THERMAL_58"
            });
            gestureStartRef.current = { centerX, centerY, zoom };
            gestureCropRectRef.current = { width: cropRect.width, height: cropRect.height };
            dragStartPointRef.current = { x: event.clientX, y: event.clientY };
        }

        if (pointerMapRef.current.size === 2) {
            const [first, second] = Array.from(pointerMapRef.current.values());
            gestureStartRef.current = { centerX, centerY, zoom };
            pinchStartRef.current = {
                midpoint: midpoint(first, second),
                distance: Math.max(1, distance(first, second))
            };
            if (imageRef.current) {
                const cropRect = computeSourceCropRect(imageRef.current.naturalWidth, imageRef.current.naturalHeight, {
                    centerX,
                    centerY,
                    zoom,
                    aspectRatio: "THERMAL_58"
                });
                gestureCropRectRef.current = { width: cropRect.width, height: cropRect.height };
            }
        }
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!isImageReady || !imageRef.current || !pointerMapRef.current.has(event.pointerId)) return;
        pointerMapRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        const start = gestureStartRef.current;
        const startCropRect = gestureCropRectRef.current;
        if (!start || !startCropRect) return;

        if (pointerMapRef.current.size === 1) {
            const [point] = Array.from(pointerMapRef.current.values());
            const dragStart = dragStartPointRef.current || point;
            const sourceDeltaX = point.x - dragStart.x;
            const sourceDeltaY = point.y - dragStart.y;
            const centerDeltaX = (sourceDeltaX / Math.max(1, event.currentTarget.clientWidth)) * startCropRect.width;
            const centerDeltaY = (sourceDeltaY / Math.max(1, event.currentTarget.clientHeight)) * startCropRect.height;
            setCenterX(clamp(start.centerX - ((centerDeltaX / imageRef.current.naturalWidth) * 100), 0, 100));
            setCenterY(clamp(start.centerY - ((centerDeltaY / imageRef.current.naturalHeight) * 100), 0, 100));
            return;
        }

        if (pointerMapRef.current.size === 2 && pinchStartRef.current) {
            const [first, second] = Array.from(pointerMapRef.current.values());
            const currentMidpoint = midpoint(first, second);
            const currentDistance = Math.max(1, distance(first, second));
            const zoomRatio = currentDistance / pinchStartRef.current.distance;
            const nextZoom = clamp(start.zoom * zoomRatio, 1, 4);
            const midpointDx = currentMidpoint.x - pinchStartRef.current.midpoint.x;
            const midpointDy = currentMidpoint.y - pinchStartRef.current.midpoint.y;
            const centerDeltaX = (midpointDx / Math.max(1, event.currentTarget.clientWidth)) * startCropRect.width;
            const centerDeltaY = (midpointDy / Math.max(1, event.currentTarget.clientHeight)) * startCropRect.height;

            setZoom(nextZoom);
            setCenterX(clamp(start.centerX - ((centerDeltaX / imageRef.current.naturalWidth) * 100), 0, 100));
            setCenterY(clamp(start.centerY - ((centerDeltaY / imageRef.current.naturalHeight) * 100), 0, 100));
        }
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        pointerMapRef.current.delete(event.pointerId);
        if (pointerMapRef.current.size === 0) {
            resetGestureState();
            return;
        }

        if (pointerMapRef.current.size === 1 && imageRef.current) {
            const [point] = Array.from(pointerMapRef.current.values());
            const cropRect = computeSourceCropRect(imageRef.current.naturalWidth, imageRef.current.naturalHeight, {
                centerX,
                centerY,
                zoom,
                aspectRatio: "THERMAL_58"
            });
            gestureStartRef.current = { centerX, centerY, zoom };
            gestureCropRectRef.current = { width: cropRect.width, height: cropRect.height };
            pinchStartRef.current = null;
            dragStartPointRef.current = point || null;
        }
    };

    const handleSubmit = async () => {
        const image = imageRef.current;
        if (!image || !isImageReady) {
            setFileError("Carica prima una foto.");
            return;
        }

        setIsSubmitting(true);
        setStatus({});
        setFileError(null);

        try {
            const raster = buildRasterFromImage(
                image,
                getThermalContentWidth(),
                { centerX, centerY, zoom },
                processing
            );
            const result = await onSubmitRaster(raster);
            if (result.success && currentRasterSignature) {
                setConfirmedRasterSignature(currentRasterSignature);
            }
            setStatus(result);
        } catch {
            setStatus({ error: "Impossibile preparare l'immagine per la stampante termica." });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Card className="overflow-hidden border-2 border-[#d9e6f8] shadow-[var(--brand-shadow-soft)]">
            <CardHeader className="space-y-2 border-b border-[#d9e6f8] bg-[#f7fbff]">
                <CardTitle className="text-xl text-[var(--brand-ink)]">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
                <div
                    className={[
                        "rounded-[28px] border p-4 shadow-sm transition-colors",
                        isSelectionConfirmed
                            ? "border-emerald-200 bg-[linear-gradient(135deg,#f0fdf4_0%,#dcfce7_100%)]"
                            : hasPendingConfirmation
                                ? "border-amber-400 bg-[linear-gradient(135deg,#fff1b8_0%,#ffd257_48%,#ffbf47_100%)] shadow-[0_18px_38px_rgba(245,158,11,0.24)]"
                                : "border-[#d9e6f8] bg-[linear-gradient(135deg,#f8fbff_0%,#eef6ff_100%)]"
                    ].join(" ")}
                    data-testid={`${testIdPrefix}-state-banner`}
                >
                    <div className="flex items-start gap-3">
                        <div
                            className={[
                                "mt-0.5 rounded-2xl p-2.5",
                                isSelectionConfirmed
                                    ? "bg-white/75 text-emerald-600"
                                    : hasPendingConfirmation
                                        ? "bg-white/70 text-amber-700"
                                        : "bg-white/75 text-[var(--brand-blue-700)]"
                            ].join(" ")}
                        >
                            {isSelectionConfirmed ? (
                                <CheckCircle2 className="h-5 w-5" />
                            ) : hasPendingConfirmation ? (
                                <PencilLine className="h-5 w-5" />
                            ) : (
                                <Sparkles className="h-5 w-5" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p
                                className={[
                                    "text-xs font-black uppercase tracking-[0.14em]",
                                    isSelectionConfirmed
                                        ? "text-emerald-700"
                                        : hasPendingConfirmation
                                            ? "text-amber-700"
                                            : "text-[var(--brand-blue-700)]"
                                ].join(" ")}
                            >
                                {isSelectionConfirmed
                                    ? "Foto confermata"
                                    : hasPendingConfirmation
                                        ? confirmedRasterSignature
                                            ? "Nuova versione non confermata"
                                            : "Bozza non confermata"
                                        : "Pronta per iniziare"}
                            </p>
                            <p className="mt-1 text-base font-black leading-tight text-[var(--brand-ink)]">
                                {isSelectionConfirmed
                                    ? "Questa e' la foto attualmente confermata."
                                    : hasPendingConfirmation
                                        ? confirmedRasterSignature
                                            ? "Stai modificando la foto gia' confermata."
                                            : "Questa foto non e' ancora confermata."
                                        : "Scatta o scegli una foto per vedere l'anteprima termica."}
                            </p>
                            <p className="mt-1 text-sm font-medium leading-relaxed text-slate-600">
                                {isSelectionConfirmed
                                    ? "Se vuoi ritoccarla ancora, sposta la preview o carica un'altra foto: il blocco tornera' in modifica finche' non confermi di nuovo."
                                    : hasPendingConfirmation
                                        ? confirmedRasterSignature
                                            ? "La foto attiva resta quella precedente finche' non premi il pulsante qui sotto."
                                            : "Quando ti convince, premi il pulsante qui sotto per usare questa foto."
                                        : "Il blocco ti mostrera' chiaramente quando la foto e' solo in bozza e quando invece e' gia' confermata."}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label htmlFor={`${testIdPrefix}-image`}>{inputLabel}</Label>
                    <Input
                        id={`${testIdPrefix}-image`}
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture={captureMode}
                        className="hidden"
                        data-testid={`${testIdPrefix}-file-input`}
                        onChange={(event) => loadFile(event.currentTarget.files?.[0] || null)}
                    />
                    <div className="flex flex-wrap gap-3">
                        {fileName ? (
                            <Button
                                type="button"
                                className="gap-2 rounded-2xl px-4 py-5 text-sm font-black"
                                onClick={openFilePicker}
                            >
                                <Camera className="h-4 w-4" />
                                {choosePhotoLabel}
                            </Button>
                        ) : null}
                        {fileName ? (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                                <Upload className="mr-1.5 h-3.5 w-3.5" />
                                {fileName}
                            </span>
                        ) : null}
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-bold text-[var(--brand-ink)]">Anteprima termica</p>
                            <p className="text-xs text-slate-500">
                                Muovi e zooma direttamente sulla preview. Il colore non viene mai inviato al server.
                            </p>
                        </div>
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                            <ZoomIn className="mr-1.5 h-3.5 w-3.5" />
                            Pinch per zoom
                        </span>
                    </div>

                    <div className="relative mx-auto w-full max-w-[340px]">
                        {isImageReady && previewStatusChipLabel ? (
                            <div
                                className={[
                                    "pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] shadow-sm",
                                    isSelectionConfirmed
                                        ? "bg-emerald-600 text-white"
                                        : "bg-amber-500 text-[#5b3500]"
                                ].join(" ")}
                                data-testid={`${testIdPrefix}-preview-status-chip`}
                            >
                                {hasPendingConfirmation && !isSelectionConfirmed ? (
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7a4b00] opacity-45" />
                                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#7a4b00]" />
                                    </span>
                                ) : null}
                                {previewStatusChipLabel}
                            </div>
                        ) : null}

                        <div
                            className={[
                                "w-full touch-none overflow-hidden rounded-[34px] border-[3px] bg-white shadow-[var(--brand-shadow-soft)] transition-colors",
                                isSelectionConfirmed
                                    ? "border-emerald-500"
                                    : hasPendingConfirmation
                                        ? "border-amber-500 ring-4 ring-amber-200/70"
                                        : "border-[var(--brand-ink)]"
                            ].join(" ")}
                            style={{ aspectRatio: `${PREVIEW_PAPER_WIDTH} / ${getThermalTargetHeight(PREVIEW_CONTENT_WIDTH)}` }}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                            data-testid={`${testIdPrefix}-preview-stage`}
                        >
                            {isImageReady ? (
                                <canvas
                                    ref={previewCanvasRef}
                                    className="h-full w-full bg-white"
                                    data-testid={`${testIdPrefix}-thermal-preview`}
                                />
                            ) : (
                                <div
                                    className="flex h-full cursor-pointer flex-col items-center justify-center gap-2 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-6 text-center transition-colors hover:bg-[linear-gradient(180deg,#ffffff_0%,#eef6ff_100%)]"
                                    role="button"
                                    tabIndex={0}
                                    onClick={openFilePicker}
                                    onKeyDown={handleEmptyStateKeyDown}
                                    data-testid={`${testIdPrefix}-empty-state-trigger`}
                                >
                                    <Camera className="h-10 w-10 text-slate-300" />
                                    <p className="font-black text-slate-500">{emptyStateTitle}</p>
                                    <p className="text-sm text-slate-400">{emptyStateDescription}</p>
                                    <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[var(--brand-blue-700)]">
                                        Tocca qui per caricare
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                    {helpText ? (
                        <p className="text-xs font-medium leading-relaxed text-slate-500">{helpText}</p>
                    ) : null}
                </div>

                {showAdvancedControls ? (
                    <div className="grid gap-4 rounded-3xl border border-[#d9e6f8] bg-[#f8fbff] p-4">
                        <div className="space-y-2">
                            <Label htmlFor={`${testIdPrefix}-brightness`}>Luminosità termica: +{Math.round(processing.brightnessBoost)}</Label>
                            <input
                                id={`${testIdPrefix}-brightness`}
                                type="range"
                                min="0"
                                max="80"
                                step="1"
                                value={processing.brightnessBoost}
                                onChange={(event) => setProcessing((current) => ({
                                    ...current,
                                    brightnessBoost: Number(event.target.value)
                                }))}
                                className="w-full"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`${testIdPrefix}-threshold`}>Bias termico: {Math.round(processing.thresholdBase)}</Label>
                            <input
                                id={`${testIdPrefix}-threshold`}
                                type="range"
                                min="80"
                                max="220"
                                step="1"
                                value={processing.thresholdBase}
                                onChange={(event) => setProcessing((current) => ({
                                    ...current,
                                    thresholdBase: Number(event.target.value)
                                }))}
                                className="w-full"
                            />
                        </div>
                    </div>
                ) : null}

                {fileError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                        {fileError}
                    </div>
                ) : null}
                {status.error ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                        {status.error}
                    </div>
                ) : null}
                {status.success ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                        {status.success}
                    </div>
                ) : null}

                <Button
                    type="button"
                    className={[
                        "h-auto w-full gap-3 rounded-[22px] px-4 py-4",
                        isSelectionConfirmed
                            ? "bg-emerald-600 text-white hover:bg-emerald-600"
                            : hasPendingConfirmation
                                ? "bg-[linear-gradient(135deg,#f59e0b_0%,#f97316_100%)] text-white shadow-[0_18px_32px_rgba(249,115,22,0.28)] hover:brightness-105"
                                : ""
                    ].join(" ")}
                    disabled={!isImageReady || isSubmitting || isSelectionConfirmed}
                    onClick={handleSubmit}
                    data-testid={`${testIdPrefix}-submit-button`}
                >
                    {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isSelectionConfirmed ? (
                        <CheckCircle2 className="h-4 w-4" />
                    ) : (
                        <Upload className="h-4 w-4" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col items-start text-left">
                        <span className="text-sm font-black leading-tight">
                            {submitButtonLabel}
                        </span>
                        <span className="mt-1 text-xs font-semibold opacity-90">
                            {submitButtonHint}
                        </span>
                    </span>
                </Button>
            </CardContent>
        </Card>
    );
}
