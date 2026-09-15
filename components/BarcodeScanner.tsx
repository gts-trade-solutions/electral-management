"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
  return (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
}

/** Whether this browser can read barcodes from the camera (Chrome on Android can; Safari can't). */
export function useCanScanBarcodes(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(barcodeDetector() !== null && !!navigator.mediaDevices?.getUserMedia);
  }, []);
  return supported;
}

/** Full-screen camera that reads a QR code or barcode, using the browser's own BarcodeDetector. */
export function BarcodeScanner({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    const Detector = barcodeDetector();
    if (!Detector) {
      setError("This browser can't read barcodes. Type the serial instead.");
      return;
    }
    const detector = new Detector({ formats: ["qr_code", "code_128", "code_39", "data_matrix"] });
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    let lastTry = 0;

    const scan = async (t: number) => {
      const v = video.current;
      if (stopped || !v) return;
      if (t - lastTry > 250 && v.readyState >= 2) {
        lastTry = t;
        try {
          const [code] = await detector.detect(v);
          if (code?.rawValue && !stopped) {
            stopped = true;
            onDetectedRef.current(code.rawValue.trim());
            return;
          }
        } catch {
          // A frame that can't be decoded; try the next one.
        }
      }
      frame = requestAnimationFrame(scan);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        frame = requestAnimationFrame(scan);
      } catch {
        setError("The camera is unavailable or permission was denied.");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video ref={video} className="h-full w-full object-cover" playsInline muted />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-40 w-64 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-white">
        <span className="text-sm">Point the camera at the asset&apos;s barcode</span>
        <button type="button" onClick={onClose} aria-label="Close camera">
          <X className="size-6" />
        </button>
      </div>
      {error && <div className="absolute inset-x-4 bottom-8 rounded-lg bg-white p-3 text-sm text-red-700">{error}</div>}
    </div>
  );
}
