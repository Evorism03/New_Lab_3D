"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { Dictionary } from "@/lib/i18n/translations";

type ShowcaseItemDto = {
  id: string;
  title: string;
};

export function ShowcaseAdmin({
  items,
  dict,
}: {
  items: ShowcaseItemDto[];
  dict: Dictionary;
}) {
  const t = dict.admin;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file || !title.trim()) return;

    setIsUploading(true);
    setError(null);
    const body = new FormData();
    body.set("title", title.trim());
    body.set("file", file);

    const res = await fetch("/api/showcase", { method: "POST", body });
    setIsUploading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Upload failed");
      return;
    }

    setTitle("");
    formRef.current?.reset();
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await fetch(`/api/showcase/${id}`, { method: "DELETE" });
    setDeletingId(null);
    router.refresh();
  };

  return (
    <div>
      <form
        ref={formRef}
        onSubmit={handleUpload}
        className="card flex flex-wrap items-end gap-3 p-5"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">{t.workTitleLabel}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-3 py-1.5 text-sm"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">{t.workImageLabel}</label>
          <input type="file" name="file" accept=".jpg,.jpeg,.png,.webp" required />
        </div>
        <button type="submit" disabled={isUploading} className="btn btn-primary px-4 py-1.5 text-sm">
          {isUploading ? t.saving : t.addWork}
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </form>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => (
          <div key={item.id} className="card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/showcase/${item.id}/raw`}
              alt={item.title}
              className="aspect-[4/3] w-full object-cover"
            />
            <div className="flex items-center justify-between gap-2 p-3">
              <span className="truncate text-sm text-text">{item.title}</span>
              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                disabled={deletingId === item.id}
                className="btn btn-outline px-2.5 py-1 text-xs"
              >
                {t.deleteWork}
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">{t.noWorks}</p>}
      </div>
    </div>
  );
}
