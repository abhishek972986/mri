import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, HeartPulse, IdCard, Phone, Save, ShieldAlert, Trash2, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { Avatar, Button, Card, CardHeader, ErrorState, Field, InlineAlert, PageHeader, Select, Skeleton, TextArea, TextInput } from '../ui';
import { useToast } from '../toast';

const EMPTY = {
  first_name: '', last_name: '', date_of_birth: '', sex: '', code: '',
  phone: '', email: '', address: '',
  medical_history: '', medications: '', conditions: '', allergies: '', neuro_history: '', clinical_notes: '',
  emergency_name: '', emergency_phone: '', emergency_relation: '',
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^[0-9+()\-\s.]{5,32}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9\-_/]{1,31}$/;

function validate(form) {
  const errors = {};
  if (!form.first_name.trim()) errors.first_name = 'First name is required.';
  if (!form.last_name.trim()) errors.last_name = 'Last name is required.';
  if (!form.date_of_birth) errors.date_of_birth = 'Date of birth is required.';
  else if (new Date(form.date_of_birth) > new Date()) errors.date_of_birth = 'Date of birth cannot be in the future.';
  if (!form.sex) errors.sex = 'Select a sex.';
  if (form.code.trim() && !CODE.test(form.code.trim())) errors.code = '2–32 letters, numbers, dashes or slashes.';
  if (form.email.trim() && !EMAIL.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  if (form.phone.trim() && !PHONE.test(form.phone.trim())) errors.phone = 'Enter a valid phone number.';
  if (form.emergency_phone.trim() && !PHONE.test(form.emergency_phone.trim())) errors.emergency_phone = 'Enter a valid phone number.';
  return errors;
}

/**
 * Only send what the API accepts; blanks become null so they clear a field.
 * A blank patient ID is omitted instead: on create the server mints
 * NV-######, on edit the existing ID is kept.
 */
function toPayload(form) {
  const payload = {};
  Object.keys(EMPTY).forEach((key) => {
    const value = typeof form[key] === 'string' ? form[key].trim() : form[key];
    if (key === 'code' && !value) return;
    payload[key] = value === '' ? null : value;
  });
  return payload;
}

function Section({ icon, title, subtitle, children }) {
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

export default function PatientFormPage() {
  const { patientId } = useParams();
  const editing = Boolean(patientId);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const existing = useQuery({
    queryKey: ['patient', Number(patientId)],
    queryFn: () => api.getPatient(patientId),
    enabled: editing,
  });

  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!existing.data) return;
    const next = { ...EMPTY };
    Object.keys(EMPTY).forEach((key) => { next[key] = existing.data[key] ?? ''; });
    setForm(next);
  }, [existing.data]);

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors((errs) => ({ ...errs, [key]: undefined }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = toPayload(form);
      const saved = editing ? await api.updatePatient(patientId, payload) : await api.createPatient(payload);
      if (photo) {
        try {
          return await api.uploadPatientPhoto(saved.id, photo);
        } catch (err) {
          // The record is saved; only the photo failed. Say so rather than
          // pretending the whole save failed.
          toast.error(`Patient saved, but the photo was not: ${err.message}`);
        }
      }
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.setQueryData(['patient', saved.id], saved);
      toast.success(editing ? 'Patient details updated.' : `Patient ${saved.display_name} created (${saved.code}).`);
      navigate(`/app/patients/${saved.id}`, { replace: true });
    },
    onError: (err) => setSubmitError(err.message),
  });

  const submit = (e) => {
    e.preventDefault();
    setSubmitError(null);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) {
      setSubmitError('Please correct the highlighted fields.');
      const first = document.querySelector('[aria-invalid="true"]');
      first?.focus();
      return;
    }
    save.mutate();
  };

  const pickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setSubmitError('Photo must be a JPEG, PNG or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('Photo must be 5 MB or smaller.');
      return;
    }
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  if (editing && existing.isError) {
    return <Card><ErrorState error={existing.error} onRetry={existing.refetch} title="Could not load this patient" /></Card>;
  }

  const name = `${form.first_name} ${form.last_name}`.trim();
  const currentPhoto = photoPreview || (editing && existing.data?.has_photo ? api.patientPhotoUrl(patientId, existing.dataUpdatedAt) : null);

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        eyebrow={editing ? 'Edit patient' : 'New patient'}
        title={editing ? (existing.data?.display_name ?? 'Edit patient') : 'Add new patient'}
        subtitle="Fields marked * are required. Everything else can be added later."
        back={
          <Link to={editing ? `/app/patients/${patientId}` : '/app/patients'} className="mb-2 inline-block text-[13px] font-semibold text-ink-soft hover:text-brand">
            ← {editing ? 'Back to patient' : 'Patients'}
          </Link>
        }
      />

      {editing && existing.isPending ? (
        <Card className="space-y-4 p-6"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-2/3" /></Card>
      ) : (
        <div className="space-y-5">
          <InlineAlert tone="red">{submitError}</InlineAlert>

          <Section icon={User} title="Personal information">
            <div className="flex items-center gap-4 sm:col-span-2">
              <Avatar name={name || '?'} src={currentPhoto} size={64} />
              <div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickPhoto} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" icon={Camera} onClick={() => fileRef.current?.click()}>
                    {currentPhoto ? 'Change photo' : 'Add photo'}
                  </Button>
                  {photo && (
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => { setPhoto(null); setPhotoPreview(null); if (fileRef.current) fileRef.current.value = ''; }}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 text-[12px] text-ink-faint">Optional. JPEG, PNG or WebP, up to 5 MB. Metadata is stripped.</p>
              </div>
            </div>
            <Field label="First name" required error={errors.first_name}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={form.first_name} onChange={set('first_name')} autoComplete="off" />}
            </Field>
            <Field label="Last name" required error={errors.last_name}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={form.last_name} onChange={set('last_name')} autoComplete="off" />}
            </Field>
            <Field label="Date of birth" required error={errors.date_of_birth}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="date" max={new Date().toISOString().slice(0, 10)} value={form.date_of_birth} onChange={set('date_of_birth')} />}
            </Field>
            <Field label="Sex" required error={errors.sex}>
              {({ id, invalid }) => (
                <Select id={id} invalid={invalid} value={form.sex} onChange={set('sex')}>
                  <option value="">Select…</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="unspecified">Prefer not to say</option>
                </Select>
              )}
            </Field>
            <Field label="Patient ID" error={errors.code} hint={editing ? 'Hospital or clinic identifier.' : 'Leave blank to generate one (NV-######).'}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={form.code} onChange={set('code')} placeholder={editing ? '' : 'e.g. MRN-20931'} className="font-mono" />}
            </Field>
          </Section>

          <Section icon={Phone} title="Contact information">
            <Field label="Phone" error={errors.phone}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="tel" value={form.phone} onChange={set('phone')} />}
            </Field>
            <Field label="Email" error={errors.email}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="email" value={form.email} onChange={set('email')} />}
            </Field>
            <Field label="Address" className="sm:col-span-2">
              {({ id }) => <TextArea id={id} rows={2} value={form.address} onChange={set('address')} className="!min-h-[64px]" />}
            </Field>
          </Section>

          <Section icon={HeartPulse} title="Clinical information" subtitle="Context for interpreting imaging findings">
            <Field label="Medical history" className="sm:col-span-2">
              {({ id }) => <TextArea id={id} value={form.medical_history} onChange={set('medical_history')} />}
            </Field>
            <Field label="Known conditions">
              {({ id }) => <TextArea id={id} value={form.conditions} onChange={set('conditions')} />}
            </Field>
            <Field label="Current medications">
              {({ id }) => <TextArea id={id} value={form.medications} onChange={set('medications')} />}
            </Field>
            <Field label="Allergies">
              {({ id }) => <TextArea id={id} value={form.allergies} onChange={set('allergies')} placeholder="e.g. Iodinated contrast, penicillin" />}
            </Field>
            <Field label="Previous neurological history">
              {({ id }) => <TextArea id={id} value={form.neuro_history} onChange={set('neuro_history')} />}
            </Field>
            <Field label="Clinical notes" className="sm:col-span-2">
              {({ id }) => <TextArea id={id} value={form.clinical_notes} onChange={set('clinical_notes')} />}
            </Field>
          </Section>

          <Section icon={ShieldAlert} title="Emergency contact">
            <Field label="Contact name">
              {({ id }) => <TextInput id={id} value={form.emergency_name} onChange={set('emergency_name')} />}
            </Field>
            <Field label="Relationship">
              {({ id }) => <TextInput id={id} value={form.emergency_relation} onChange={set('emergency_relation')} placeholder="e.g. Spouse" />}
            </Field>
            <Field label="Contact phone" error={errors.emergency_phone}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="tel" value={form.emergency_phone} onChange={set('emergency_phone')} />}
            </Field>
          </Section>

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-[#E7EDF6] bg-[#F5F8FC]/90 px-4 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border sm:bg-white/90">
            <span className="mr-auto hidden items-center gap-2 text-[12.5px] text-ink-faint sm:flex">
              <IdCard className="h-4 w-4" /> Visible only to you as the treating doctor.
            </span>
            <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
            <Button type="submit" icon={Save} loading={save.isPending}>
              {editing ? 'Save changes' : 'Save patient'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
