"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Upload, ZoomIn } from "lucide-react";
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
    const [status, setStatus] = useState<EasterEggComposerResult>({});
    const [fileError, setFileError] = useState<string | null>(null);
    const [isImageReady, setIsImageReady] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [zoom, setZoom] = useState(1.6);
    const [centerX, setCenterX] = useState(50);
    const [centerY, setCenterY] = useState(50);
    const [processing, setProcessing] = useState<EasterEggProcessingSettings>(
        normalizeEasterEggProcessingSettings(undefined)
    );

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

    const openFilePicker = () => {
        fileInputRef.current?.click();
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
                        <Button type="button" className="gap-2" onClick={openFilePicker}>
                            <Camera className="h-4 w-4" />
                            Scatta o scegli una foto
                        </Button>
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

                    <div
                        className="mx-auto w-full max-w-[340px] touch-none overflow-hidden rounded-[34px] border-[3px] border-[var(--brand-ink)] bg-white shadow-[var(--brand-shadow-soft)]"
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
                            <div className="flex h-full flex-col items-center justify-center gap-2 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-6 text-center">
                                <Camera className="h-10 w-10 text-slate-300" />
                                <p className="font-black text-slate-500">{emptyStateTitle}</p>
                                <p className="text-sm text-slate-400">{emptyStateDescription}</p>
                            </div>
                        )}
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
                    className="w-full gap-2"
                    disabled={!isImageReady || isSubmitting}
                    onClick={handleSubmit}
                >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {isSubmitting ? submittingLabel : submitLabel}
                </Button>
            </CardContent>
        </Card>
    );
}
