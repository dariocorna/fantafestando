"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, Lock, PencilLine, Sparkles, Upload, ZoomIn } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from "@/components/ui/alert-dialog";
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
    description?: string;
    submitLabel: string;
    submittingLabel: string;
    inputLabel: string;
    helpText?: string;
    emptyStateTitle: string;
    emptyStateDescription: string;
    captureMode?: "user" | "environment";
    showAdvancedControls?: boolean;
    lockAfterFirstSave?: boolean;
    requireUnlockConfirmation?: boolean;
    autoSaveDelayMs?: number;
    testIdPrefix: string;
    onSubmitRaster: (raster: ThermalRasterPayload) => Promise<EasterEggComposerResult>;
}

const DEFAULT_AUTO_SAVE_DELAY_MS = 5000;

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
const PREVIEW_CONTENT_HEIGHT = getThermalTargetHeight(PREVIEW_CONTENT_WIDTH);
const PREVIEW_PAPER_WIDTH = Math.round((PREVIEW_CONTENT_WIDTH / getThermalContentWidth()) * getThermalPaperWidth());
const PREVIEW_STAGE_ASPECT_RATIO = PREVIEW_PAPER_WIDTH / PREVIEW_CONTENT_HEIGHT;
const PREVIEW_MAX_VIEWPORT_HEIGHT = "62dvh";

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
    lockAfterFirstSave = false,
    requireUnlockConfirmation = false,
    autoSaveDelayMs = DEFAULT_AUTO_SAVE_DELAY_MS,
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
    const autoSaveTimeoutRef = useRef<number | null>(null);
    const latestSignatureRef = useRef<string | null>(null);
    const isSubmittingRef = useRef(false);
    const onSubmitRasterRef = useRef(onSubmitRaster);

    const [fileName, setFileName] = useState("");
    const [fileIdentity, setFileIdentity] = useState<string | null>(null);
    const [status, setStatus] = useState<EasterEggComposerResult>({});
    const [fileError, setFileError] = useState<string | null>(null);
    const [isImageReady, setIsImageReady] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isEditingUnlocked, setIsEditingUnlocked] = useState(false);
    const [isUnlockDialogOpen, setIsUnlockDialogOpen] = useState(false);
    const [confirmedRasterSignature, setConfirmedRasterSignature] = useState<string | null>(null);
    const [pendingAutoSaveSignature, setPendingAutoSaveSignature] = useState<string | null>(null);
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
    const isQueuedForAutoSave = Boolean(
        hasPendingConfirmation
        && pendingAutoSaveSignature
        && currentRasterSignature === pendingAutoSaveSignature
    );
    const isEditLocked = lockAfterFirstSave && isSelectionConfirmed && !isEditingUnlocked;
    const canEditCurrentSelection = isImageReady && (!isSelectionConfirmed || !lockAfterFirstSave || isEditingUnlocked);
    const choosePhotoLabel = isEditLocked
        ? "Modifica foto"
        : fileName
            ? "Sostituisci foto"
            : "Scatta o scegli una foto";
    const previewStatusChipLabel = isEditLocked
        ? "Bloccata"
        : isSelectionConfirmed
            ? "Confermata"
        : isSubmitting
            ? "Salvataggio"
            : hasPendingConfirmation
            ? confirmedRasterSignature
                ? "In aggiornamento"
                : "Bozza"
            : null;

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
            }
            if (autoSaveTimeoutRef.current) {
                window.clearTimeout(autoSaveTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        latestSignatureRef.current = currentRasterSignature;
    }, [currentRasterSignature]);

    useEffect(() => {
        isSubmittingRef.current = isSubmitting;
    }, [isSubmitting]);

    useEffect(() => {
        onSubmitRasterRef.current = onSubmitRaster;
    }, [onSubmitRaster]);

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

    const submitRaster = useCallback(async (signature: string) => {
        const image = imageRef.current;
        if (!image || !isImageReady) {
            setFileError("Carica prima una foto.");
            return;
        }
        if (isSubmittingRef.current) {
            return;
        }

        setIsSubmitting(true);
        setPendingAutoSaveSignature(null);
        setStatus({});
        setFileError(null);

        try {
            const raster = buildRasterFromImage(
                image,
                getThermalContentWidth(),
                { centerX, centerY, zoom },
                processing
            );
            const result = await onSubmitRasterRef.current(raster);
            if (result.success && latestSignatureRef.current === signature) {
                setConfirmedRasterSignature(signature);
                if (lockAfterFirstSave) {
                    setIsEditingUnlocked(false);
                    setIsUnlockDialogOpen(false);
                }
            }
            setStatus(result);
        } catch {
            setStatus({ error: "Impossibile preparare l'immagine per la stampa." });
        } finally {
            setIsSubmitting(false);
        }
    }, [centerX, centerY, isImageReady, lockAfterFirstSave, processing, zoom]);

    useEffect(() => {
        if (autoSaveTimeoutRef.current) {
            window.clearTimeout(autoSaveTimeoutRef.current);
            autoSaveTimeoutRef.current = null;
        }

        if (!isImageReady || !currentRasterSignature) {
            setPendingAutoSaveSignature(null);
            return;
        }
        if (currentRasterSignature === confirmedRasterSignature) {
            setPendingAutoSaveSignature(null);
            return;
        }
        if (isSubmitting) {
            return;
        }

        const delay = confirmedRasterSignature ? autoSaveDelayMs : 0;
        setPendingAutoSaveSignature(currentRasterSignature);

        autoSaveTimeoutRef.current = window.setTimeout(() => {
            void submitRaster(currentRasterSignature);
        }, delay);

        return () => {
            if (autoSaveTimeoutRef.current) {
                window.clearTimeout(autoSaveTimeoutRef.current);
                autoSaveTimeoutRef.current = null;
            }
        };
    }, [autoSaveDelayMs, confirmedRasterSignature, currentRasterSignature, isImageReady, isSubmitting, submitRaster]);

    const openFilePicker = () => {
        if (isEditLocked) {
            setIsUnlockDialogOpen(true);
            return;
        }
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
        if (isEditLocked) {
            return;
        }
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
        if (!canEditCurrentSelection) return;
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
        if (!canEditCurrentSelection || !imageRef.current || !pointerMapRef.current.has(event.pointerId)) return;
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
        if (!canEditCurrentSelection) return;
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

    const unlockEditing = () => {
        setIsUnlockDialogOpen(false);
        setIsEditingUnlocked(true);
        setStatus({});
        setFileError(null);
    };

    return (
        <>
            <Card className="overflow-hidden border-2 border-[#d9e6f8] shadow-[var(--brand-shadow-soft)]">
                <CardHeader className="space-y-2 border-b border-[#d9e6f8] bg-[#f7fbff]">
                    <CardTitle className="text-xl text-[var(--brand-ink)]">{title}</CardTitle>
                    {description ? <CardDescription>{description}</CardDescription> : null}
                </CardHeader>
                <CardContent className="space-y-5 p-5">
                {currentRasterSignature ? (
                    <div
                        className={[
                            "rounded-[28px] border p-4 shadow-sm transition-colors",
                            isEditLocked
                                ? "border-slate-300 bg-[linear-gradient(135deg,#f8fafc_0%,#e2e8f0_100%)]"
                                : isSelectionConfirmed
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
                                    isEditLocked
                                        ? "bg-white/80 text-slate-700"
                                        : isSelectionConfirmed
                                        ? "bg-white/75 text-emerald-600"
                                        : hasPendingConfirmation
                                            ? "bg-white/70 text-amber-700"
                                            : "bg-white/75 text-[var(--brand-blue-700)]"
                                ].join(" ")}
                            >
                                {isEditLocked ? (
                                    <Lock className="h-5 w-5" />
                                ) : isSelectionConfirmed ? (
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
                                        isEditLocked
                                            ? "text-slate-700"
                                            : isSelectionConfirmed
                                            ? "text-emerald-700"
                                            : hasPendingConfirmation
                                                ? "text-amber-700"
                                                : "text-[var(--brand-blue-700)]"
                                    ].join(" ")}
                                >
                                    {isEditLocked
                                        ? "Foto bloccata"
                                        : isSelectionConfirmed
                                        ? "Foto confermata"
                                        : isSubmitting
                                            ? "Salvataggio automatico in corso"
                                            : hasPendingConfirmation
                                                ? confirmedRasterSignature
                                                    ? "Nuova versione in attesa"
                                                    : "Prima foto in salvataggio"
                                            : null}
                                </p>
                                <p className="mt-1 text-base font-black leading-tight text-[var(--brand-ink)]">
                                    {isEditLocked
                                        ? "Questa e' la foto attiva. Per cambiarla serve una conferma esplicita."
                                        : isSelectionConfirmed
                                        ? "Questa e' la foto attualmente confermata."
                                        : isSubmitting
                                            ? "Sto salvando automaticamente l'anteprima mostrata."
                                            : hasPendingConfirmation
                                                ? confirmedRasterSignature
                                                    ? "Le modifiche verranno salvate da sole dopo pochi secondi."
                                                    : "La foto viene caricata automaticamente appena pronta."
                                        : null}
                                </p>
                                <p className="mt-1 text-sm font-medium leading-relaxed text-slate-600">
                                    {isEditLocked
                                        ? "Usa il pulsante qui sotto per riaprire l'editing, poi potrai ritoccarla o caricare una nuova immagine."
                                        : isSelectionConfirmed
                                        ? "Se vuoi ritoccarla ancora, sposta la preview o carica un'altra foto: il salvataggio ripartira' in automatico."
                                        : isSubmitting
                                            ? "Non serve premere nulla: appena finisco, questa versione diventera' quella attiva."
                                            : hasPendingConfirmation
                                                ? confirmedRasterSignature
                                                    ? isQueuedForAutoSave
                                                        ? `Aspetto ${Math.round(autoSaveDelayMs / 1000)} secondi dall'ultima modifica prima di aggiornare la foto.`
                                                        : "Preparo il salvataggio automatico della nuova versione."
                                                    : "Non serve confermare: questa prima foto viene inviata appena disponibile."
                                        : null}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : null}

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
                                data-testid={`${testIdPrefix}-${isEditLocked ? "unlock-trigger" : "replace-trigger"}`}
                            >
                                {isEditLocked ? <Lock className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
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
                            <p className="font-bold text-[var(--brand-ink)]">Anteprima</p>
                            <p className="text-xs text-slate-500">
                                {canEditCurrentSelection
                                    ? "Muovi e zooma direttamente sulla preview. Il colore non viene mai inviato al server."
                                    : "La preview e' bloccata finche' non confermi di volerla modificare di nuovo."}
                            </p>
                        </div>
                        {canEditCurrentSelection ? (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                                <ZoomIn className="mr-1.5 h-3.5 w-3.5" />
                                Pinch per zoom
                            </span>
                        ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                                <Lock className="mr-1.5 h-3.5 w-3.5" />
                                Modifica protetta
                            </span>
                        )}
                    </div>

                    <div
                        className="relative mx-auto w-full"
                        style={{
                            width: `min(100%, 340px, calc(${PREVIEW_MAX_VIEWPORT_HEIGHT} * ${PREVIEW_STAGE_ASPECT_RATIO}))`
                        }}
                    >
                        {isImageReady && previewStatusChipLabel ? (
                            <div
                                className={[
                                    "pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] shadow-sm",
                                    isEditLocked
                                        ? "bg-slate-700 text-white"
                                        : isSelectionConfirmed
                                        ? "bg-emerald-600 text-white"
                                        : isSubmitting
                                            ? "bg-[var(--brand-blue-700)] text-white"
                                            : "bg-amber-500 text-[#5b3500]"
                                ].join(" ")}
                                data-testid={`${testIdPrefix}-preview-status-chip`}
                            >
                                {(hasPendingConfirmation || isSubmitting) && !isSelectionConfirmed && !isEditLocked ? (
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${isSubmitting ? "bg-white opacity-35" : "bg-[#7a4b00] opacity-45"}`} />
                                        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isSubmitting ? "bg-white" : "bg-[#7a4b00]"}`} />
                                    </span>
                                ) : null}
                                {previewStatusChipLabel}
                            </div>
                        ) : null}

                        <div
                            className={[
                                "w-full overflow-hidden rounded-[34px] border-[3px] bg-white shadow-[var(--brand-shadow-soft)] transition-colors",
                                canEditCurrentSelection ? "touch-none" : "touch-pan-y",
                                isEditLocked
                                    ? "border-slate-400"
                                    : isSelectionConfirmed
                                    ? "border-emerald-500"
                                    : hasPendingConfirmation
                                        ? "border-amber-500 ring-4 ring-amber-200/70"
                                        : "border-[var(--brand-ink)]"
                            ].join(" ")}
                            style={{
                                aspectRatio: `${PREVIEW_PAPER_WIDTH} / ${PREVIEW_CONTENT_HEIGHT}`,
                                maxHeight: `min(${PREVIEW_MAX_VIEWPORT_HEIGHT}, 420px)`
                            }}
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
                            <Label htmlFor={`${testIdPrefix}-brightness`}>Luminosità: +{Math.round(processing.brightnessBoost)}</Label>
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

                <div
                    className={[
                        "flex items-start gap-3 rounded-[22px] border px-4 py-4",
                        isEditLocked
                            ? "border-slate-300 bg-slate-100 text-slate-700"
                            : isSelectionConfirmed
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : isSubmitting
                                ? "border-[var(--brand-blue-200)] bg-[#eef6ff] text-[var(--brand-blue-700)]"
                                : hasPendingConfirmation
                                    ? "border-amber-200 bg-amber-50 text-amber-800"
                                    : "border-slate-200 bg-slate-50 text-slate-600"
                    ].join(" ")}
                    data-testid={`${testIdPrefix}-autosave-banner`}
                >
                    {isSubmitting ? (
                        <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
                    ) : isEditLocked ? (
                        <Lock className="mt-0.5 h-4 w-4" />
                    ) : isSelectionConfirmed ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4" />
                    ) : hasPendingConfirmation ? (
                        <Upload className="mt-0.5 h-4 w-4" />
                    ) : (
                        <Sparkles className="mt-0.5 h-4 w-4" />
                    )}
                    <div className="min-w-0">
                        <p className="text-sm font-black leading-tight">
                            {isEditLocked
                                ? "Foto bloccata dopo il salvataggio"
                                : isSelectionConfirmed
                                ? "Salvata automaticamente"
                                : isSubmitting
                                    ? submittingLabel
                                    : hasPendingConfirmation
                                        ? confirmedRasterSignature
                                            ? `Salvataggio automatico tra ${Math.round(autoSaveDelayMs / 1000)} secondi`
                                            : submitLabel
                                        : "Il salvataggio automatico partira' quando carichi una foto"}
                        </p>
                        <p className="mt-1 text-xs font-semibold leading-relaxed opacity-90">
                            {isEditLocked
                                ? "Per sbloccarla serve una conferma utente prima di riaprire l'editing."
                                : isSelectionConfirmed
                                ? "Questa e' la versione attiva al momento."
                                : isSubmitting
                                    ? "Attendi qualche istante mentre aggiorno la foto."
                                    : hasPendingConfirmation
                                        ? confirmedRasterSignature
                                            ? `Ogni nuova modifica fa ripartire il conto dei ${Math.round(autoSaveDelayMs / 1000)} secondi.`
                                            : "La prima foto viene inviata subito, senza pulsanti."
                                        : "Non serve piu' confermare manualmente."}
                        </p>
                    </div>
                </div>
                </CardContent>
            </Card>

            {requireUnlockConfirmation ? (
                <AlertDialog open={isUnlockDialogOpen} onOpenChange={setIsUnlockDialogOpen}>
                    <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Vuoi modificare la foto gia&apos; salvata?</AlertDialogTitle>
                            <AlertDialogDescription>
                                La preview verra&apos; sbloccata e ogni nuova modifica sara&apos; salvata di nuovo in automatico.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                            <AlertDialogAction onClick={unlockEditing}>
                                Sblocca modifica
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            ) : null}
        </>
    );
}
