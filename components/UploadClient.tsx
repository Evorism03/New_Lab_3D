"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

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

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold text-text">{t.title}</h1>
      <p className="mt-2 text-muted">{t.subtitle}</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
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
