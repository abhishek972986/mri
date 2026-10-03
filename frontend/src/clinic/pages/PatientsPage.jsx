import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { formatDate, STATUS, titleCase } from '../format';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, StatusBadge } from '../ui';

const PAGE_SIZE = 12;

export default function PatientsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const sex = params.get('sex') || '';
  const status = params.get('status') || '';
  const sort = params.get('sort') || 'recent';
  const page = Math.max(1, Number(params.get('page') || 1));

  // The box updates immediately; the URL (and so the request) after a pause.
  const [term, setTerm] = useState(q);
  useEffect(() => { setTerm(q); }, [q]);
  useEffect(() => {
    if (term === q) return undefined;
    const id = setTimeout(() => update({ q: term, page: 1 }), 300);
    return () => clearTimeout(id);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(changes) {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === '' || value === null || value === undefined || (key === 'page' && value === 1) || (key === 'sort' && value === 'recent')) next.delete(key);
      else next.set(key, String(value));
    });
    setParams(next, { replace: true });
  }

  const query = useQuery({
    queryKey: ['patients', { q, sex, status, sort, page }],
    queryFn: () => api.listPatients({ q, sex, status, sort, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtered = q || sex || status;

  return (
    <div>
      <PageHeader
        eyebrow="Patient management"
        title="Patients"
        subtitle={data ? `${data.total} ${data.total === 1 ? 'patient' : 'patients'}${filtered ? ' match your filters' : ' in your care'}` : 'Your patient records'}
        actions={<Button icon={UserPlus} to="/app/patients/new">Add patient</Button>}
      />

      <Card className="p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px_170px]">
          <label className="relative block">
            <span className="sr-only">Search patients</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search name, patient ID, phone or email"
              className="cx-input !pl-10"
              type="search"
            />
          </label>
          <Select aria-label="Filter by sex" value={sex} onChange={(e) => update({ sex: e.target.value, page: 1 })}>
            <option value="">All sexes</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="unspecified">Unspecified</option>
          </Select>
          <Select aria-label="Filter by latest scan status" value={status} onChange={(e) => update({ status: e.target.value, page: 1 })}>
            <option value="">Any scan status</option>
            <option value="none">No scans yet</option>
            {Object.entries(STATUS).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}
          </Select>
          <Select aria-label="Sort patients" value={sort} onChange={(e) => update({ sort: e.target.value, page: 1 })}>
            <option value="recent">Newest first</option>
            <option value="last_scan">Last scan</option>
            <option value="name">Name A–Z</option>
            <option value="age">Age</option>
          </Select>
        </div>

        <div className={`mt-5 transition-opacity duration-300 ${query.isFetching && !query.isPending ? 'opacity-60' : ''}`}>
          {query.isPending ? (
            <SkeletonRows rows={6} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={query.refetch} title="Could not load patients" />
          ) : data.items.length === 0 ? (
            filtered ? (
              <EmptyState icon={Search} title="No matching patients" body="Try a different name or ID, or clear the filters."
                action={<Button variant="secondary" onClick={() => { setTerm(''); setParams({}, { replace: true }); }}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={Users} title="No patients yet" body="Create a patient record to begin uploading MRI scans."
                action={<Button icon={UserPlus} to="/app/patients/new">Add patient</Button>} />
            )
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-[#EEF2F8] text-[12px] uppercase tracking-[0.06em] text-ink-faint">
                      <th className="pb-2.5 pr-3 font-semibold">Patient</th>
                      <th className="pb-2.5 pr-3 font-semibold">Age</th>
                      <th className="pb-2.5 pr-3 font-semibold">Sex</th>
                      <th className="pb-2.5 pr-3 font-semibold">Patient ID</th>
                      <th className="pb-2.5 pr-3 font-semibold">Last scan</th>
                      <th className="pb-2.5 pr-3 font-semibold">Scans</th>
                      <th className="pb-2.5 pr-3 font-semibold">Latest status</th>
                      <th className="pb-2.5 font-semibold"><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((p) => (
                      <tr key={p.id} onClick={() => navigate(`/app/patients/${p.id}`)} className="group cursor-pointer border-b border-[#F1F4F9] last:border-0 hover:bg-[#F8FAFE]">
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={p.display_name} src={p.has_photo ? api.patientPhotoUrl(p.id) : null} size={36} />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-ink">{p.display_name}</p>
                              {p.phone && <p className="text-[12px] text-ink-faint">{p.phone}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-ink-soft">{p.age_years ?? '—'}</td>
                        <td className="py-3 pr-3 text-ink-soft">{titleCase(p.sex) || '—'}</td>
                        <td className="py-3 pr-3 font-mono text-[12.5px] text-ink-soft">{p.code}</td>
                        <td className="py-3 pr-3 text-ink-soft">{formatDate(p.last_scan_at)}</td>
                        <td className="py-3 pr-3 text-ink-soft">{p.study_count}</td>
                        <td className="py-3 pr-3">{p.latest_status ? <StatusBadge status={p.latest_status} /> : <Badge>No scans</Badge>}</td>
                        <td className="py-3 text-right">
                          <span className="inline-flex items-center gap-1 font-semibold text-brand">View <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="grid gap-2.5 sm:grid-cols-2 lg:hidden">
                {data.items.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => navigate(`/app/patients/${p.id}`)} className="cx-card-hover flex w-full items-center gap-3 rounded-2xl border border-[#EEF2F8] bg-white p-3.5 text-left">
                      <Avatar name={p.display_name} src={p.has_photo ? api.patientPhotoUrl(p.id) : null} size={42} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{p.display_name}</span>
                        <span className="block text-[12.5px] text-ink-soft">
                          {[p.age_years != null ? `${p.age_years} y` : null, titleCase(p.sex), p.code].filter(Boolean).join(' · ')}
                        </span>
                        <span className="mt-1 block text-[12px] text-ink-faint">{p.study_count} scans · last {formatDate(p.last_scan_at, 'never')}</span>
                      </span>
                      {p.latest_status && <StatusBadge status={p.latest_status} />}
                    </button>
                  </li>
                ))}
              </ul>

              {pages > 1 && (
                <nav aria-label="Pagination" className="mt-5 flex items-center justify-between gap-3 border-t border-[#EEF2F8] pt-4 text-[13.5px]">
                  <span className="text-ink-soft">Page {page} of {pages}</span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => update({ page: page - 1 })}>Previous</Button>
                    <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </nav>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
