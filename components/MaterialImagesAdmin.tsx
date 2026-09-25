"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type AdminColor, ColorSuggestions, MaterialColorsAdmin } from "@/components/MaterialColorsAdmin";
import { MaterialThumb } from "@/components/MaterialThumb";
import type { Dictionary } from "@/lib/i18n/translations";

type MaterialImageItem = { id: string; name: string; imageUrl: string | null; colors: AdminColor[] };

export function MaterialImagesAdmin({
  materials,
  dict,
}: {
  materials: MaterialImageItem[];
  dict: Dictionary;
}) {
  const t = dict.admin;
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (id: string, file: File) => {
    setBusyId(id);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    const res = await fetch(`/api/materials/${id}/image`, { method: "POST", body });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Upload failed");
      return;
    }
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    await fetch(`/api/materials/${id}/image`, { method: "DELETE" });
    setBusyId(null);
    router.refresh();
  };

  return (
    <div>
      <ColorSuggestions />
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {materials.map((m) => (
          <div key={m.id} className="card overflow-hidden">
            <MaterialThumb imageUrl={m.imageUrl} alt={m.name} className="aspect-[4/3] w-full" />
            <div className="flex flex-col gap-2 p-3">
              <span className="text-sm font-semibold text-text">{m.name}</span>
              <label
                className={`btn btn-outline cursor-pointer px-2.5 py-1 text-center text-xs ${
                  busyId === m.id ? "pointer-events-none opacity-60" : ""
                }`}
              >
                {m.imageUrl ? t.replaceImage : t.uploadImage}
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void upload(m.id, file);
                  }}
                />
              </label>
              {m.imageUrl && (
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  disabled={busyId === m.id}
                  className="text-xs text-muted transition-colors hover:text-danger"
                >
                  {t.removeImage}
                </button>
              )}
            </div>
            <MaterialColorsAdmin materialId={m.id} colors={m.colors} dict={dict} />
          </div>
        ))}
      </div>
    </div>
  );
}
