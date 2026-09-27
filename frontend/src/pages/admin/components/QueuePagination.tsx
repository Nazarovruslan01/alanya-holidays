export default function QueuePagination({ page, totalPages, total, busy, onChange }: {
  page: number; totalPages: number; total: number; busy: boolean; onChange: (page: number) => void;
}) {
  return <nav aria-label="Queue pages" className="flex gap-4 items-center">
    <button disabled={busy || page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
    <span>{total} records · Page {page} / {Math.max(1, totalPages)}</span>
    <button disabled={busy || page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}
