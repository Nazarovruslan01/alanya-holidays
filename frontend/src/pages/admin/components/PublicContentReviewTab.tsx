import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import ArticleContentRenderer from '@/components/article/ArticleContentRenderer';

const TYPES = {
  directory_listings: 'Business listings', services: 'Services', service_edits: 'Service edits',
  products: 'Legacy products', product_items: 'Shop products', forum_events: 'Events',
  listing_reviews: 'Business reviews', blog_posts: 'Articles and guides',
  forum_posts: 'Forum posts', forum_comments: 'Forum replies', blog_comments: 'Article comments',
  saved_itineraries: 'Public itineraries', profile_public_revisions: 'Public profiles',
};
type ReviewItem = Record<string, unknown> & { id: string | number; moderation_revision: number };
type Queue = { data: ReviewItem[]; total: number; totalPages: number };

function ContentPreview({ value, field }: { value: unknown; field?: string }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value)) return <ul className="space-y-3">{value.map((item, index) => <li key={index}><ContentPreview value={item} field={field} /></li>)}</ul>;
  if (typeof value === 'object') return <dl className="space-y-3">{Object.entries(value).filter(([key]) => !['id', 'moderation_revision', 'moderation_status'].includes(key)).map(([key, item]) => <div key={key}><dt className="font-medium capitalize">{key.replaceAll('_', ' ')}</dt><dd className="pl-3"><ContentPreview value={item} field={key} /></dd></div>)}</dl>;
  const text = String(value);
  if (field === 'content' || field === 'body') return <ArticleContentRenderer content={text} />;
  if (/^https?:\/\//i.test(text) && (field === 'video_url' || /\.(mp4|webm|ogg)(\?|$)/i.test(text))) return <video src={text} controls preload="metadata" className="max-h-64 max-w-full"><track kind="captions" /></video>;
  if (/^https?:\/\//i.test(text) && (/image|avatar|gallery|photo|cover|media_urls/i.test(field || '') || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(text))) return <a href={text} target="_blank" rel="noreferrer"><img src={text} alt="Submitted image" className="max-h-64 max-w-full object-contain" /></a>;
  if (/^https?:\/\//i.test(text)) return <a href={text} target="_blank" rel="noreferrer" className="underline break-all">{text}</a>;
  return <p className="whitespace-pre-wrap break-words">{text}</p>;
}

export default function PublicContentReviewTab() {
  const [type, setType] = useState<keyof typeof TYPES>('forum_posts');
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<Queue>({ data: [], total: 0, totalPages: 0 });
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [selectedType, setSelectedType] = useState<keyof typeof TYPES>('forum_posts');
  const requestId = useRef(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setBusy(true); setError('');
    setQueue({ data: [], total: 0, totalPages: 0 });
    try {
      const response = await apiClient.get<Queue>('/admin/public-content', { params: { type, status, page, limit: 20 } });
      if (currentRequest === requestId.current) setQueue(response);
    }
    catch (error) { if (currentRequest === requestId.current) setError(error instanceof Error ? error.message : 'Could not load queue'); }
    finally { if (currentRequest === requestId.current) setBusy(false); }
  }, [type, status, page]);
  useEffect(() => { const requests = requestId; setSelected(null); void load(); return () => { requests.current++; }; }, [load]);
  const review = async (approve: boolean) => {
    if (!selected || busy) return;
    const reviewedRequest = requestId.current;
    setBusy(true); setError('');
    try {
      await apiClient.patch('/admin/public-content/review', { type: selectedType, id: String(selected.id), revision: selected.moderation_revision, approve, reason });
      if (reviewedRequest === requestId.current) { setSelected(null); setReason(''); await load(); }
    } catch (error) { if (reviewedRequest === requestId.current) setError(error instanceof Error ? error.message : 'Review failed'); }
    finally { if (reviewedRequest === requestId.current) setBusy(false); }
  };
  return <section className="space-y-4">
    <h2 className="text-xl font-semibold">Public content approval</h2>
    <p>New submissions and edits remain private until approved. Review the complete content before publishing.</p>
    <div className="flex flex-wrap gap-3">
      <label>Content type <select value={type} onChange={(e) => { setType(e.target.value as keyof typeof TYPES); setPage(1); }} className="border rounded p-2">{Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Status <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="border rounded p-2">{['pending','approved','rejected'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <button disabled={busy} onClick={() => void load()} className="border rounded px-3">Refresh</button>
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <p aria-live="polite">{busy ? 'Loading…' : `${queue.total} records`}</p>
    <ul className="divide-y">{queue.data.map((item) => <li key={String(item.id)} className="py-3"><button disabled={busy} className="text-left underline" onClick={() => { setSelected(item); setSelectedType(type); setReason(''); }}>{String(item.title ?? item.name ?? item.body ?? item.comment ?? item.id).slice(0, 160)}</button></li>)}</ul>
    <div className="flex gap-3"><button disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} / {Math.max(1, queue.totalPages)}</span><button disabled={page >= queue.totalPages || busy} onClick={() => setPage(page + 1)}>Next</button></div>
    {selected && <article className="border rounded-xl p-4 space-y-3">
      <h3 className="font-semibold">Review revision {selected.moderation_revision}</h3>
      <ContentPreview value={selected} />
      {status === 'pending' && <><label className="block">Reason for rejection<textarea className="block border rounded w-full p-2" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} /></label><div className="flex gap-3"><button disabled={busy} onClick={() => void review(true)} className="rounded bg-green-700 text-white px-4 py-2">Approve and publish</button><button disabled={busy || !reason.trim()} onClick={() => void review(false)} className="rounded bg-red-700 text-white px-4 py-2">Reject</button></div></>}
    </article>}
  </section>;
}
