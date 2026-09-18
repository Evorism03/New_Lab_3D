"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Dictionary } from "@/lib/i18n/translations";

export function UploadClient({ dict }: { dict: Dictionary }) {
  const t = dict.upload;
  const router = useRouter();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/files", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          setError(data.file?.errorMessage ?? data.error ?? t.errorFallback);
          setIsUploading(false);
          return;
        }

        router.push(`/order/configure/${data.file.id}`);
      } catch {
        setError(t.errorFallback);
        setIsUploading(false);
      }
    },
    [router, t.errorFallback],
  );

  // Accept a dropped file anywhere on the page, not just on the drop zone.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setIsDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setIsDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void uploadFile(file);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [uploadFile]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center border-4 border-dashed border-accent bg-bg/85 backdrop-blur-sm">
          <p className="text-2xl font-semibold text-accent">{t.dropTitle}</p>
        </div>
      )}
      <h1 className="text-2xl font-bold text-text">{t.title}</h1>
      <p className="mt-2 text-muted">{t.subtitle}</p>

      <div
        onClick={() => inputRef.current?.click()}
        className={`mt-8 flex h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors ${
          isDragging ? "border-accent bg-accent-soft" : "border-border bg-card"
        }`}
      >
        {isUploading ? (
          <p className="text-muted">{t.uploading}</p>
        ) : (
          <>
            <p className="font-medium text-text">{t.dropTitle}</p>
            <p className="mt-1 text-sm text-muted">{t.dropSubtitle}</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".stl,.obj"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
