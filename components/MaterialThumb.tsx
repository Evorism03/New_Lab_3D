/** Material illustration, or a neutral cube placeholder until one is uploaded. */
export function MaterialThumb({
  imageUrl,
  alt,
  className = "",
}: {
  imageUrl: string | null;
  alt: string;
  className?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt={alt} className={`object-cover ${className}`} />
    );
  }

  return (
    <div
      aria-hidden
      className={`flex items-center justify-center bg-gradient-to-br from-accent/15 to-transparent ${className}`}
    >
      <svg viewBox="0 0 48 48" className="h-1/2 w-1/2 text-accent/70" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M24 5 41 14.5v19L24 43 7 33.5v-19L24 5Z" />
        <path d="M7 14.5 24 24l17-9.5M24 24v19" />
      </svg>
    </div>
  );
}
