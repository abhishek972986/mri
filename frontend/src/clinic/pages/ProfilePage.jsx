import { useMutation } from '@tanstack/react-query';
import { Camera, KeyRound, LogOut, Save, Stethoscope } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../auth';
import { doctorName, formatDateTime } from '../format';
import { useToast } from '../toast';
import { Avatar, Button, Card, CardHeader, Field, InlineAlert, PageHeader, TextInput } from '../ui';

const FIELDS = ['full_name', 'email', 'specialty', 'hospital', 'license_id', 'phone', 'location'];

export default function ProfilePage() {
  const { doctor, setDoctor, signOut } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [pwError, setPwError] = useState(null);

  useEffect(() => {
    if (doctor) setForm(Object.fromEntries(FIELDS.map((k) => [k, doctor[k] ?? ''])));
  }, [doctor]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () => api.updateProfile(Object.fromEntries(FIELDS.map((k) => [k, form[k].trim() || null]))),
    onSuccess: (updated) => { setDoctor(updated); toast.success('Profile updated.'); },
    onError: (err) => setError(err.message),
  });

  const photo = useMutation({
    mutationFn: (file) => api.uploadProfilePhoto(file),
    onSuccess: (updated) => { setDoctor(updated); setPhotoVersion((v) => v + 1); toast.success('Profile photo updated.'); },
    onError: (err) => toast.error(err.message),
  });

  const password = useMutation({
    mutationFn: () => api.changePassword({ current_password: pw.current_password, new_password: pw.new_password }),
    onSuccess: () => {
      setPw({ current_password: '', new_password: '', confirm: '' });
      toast.success('Password changed. Other devices have been signed out.');
    },
    onError: (err) => setPwError(err.message),
  });

  const submitProfile = (e) => {
    e.preventDefault();
    setError(null);
    if (!form.full_name?.trim()) return setError('Name is required.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email?.trim() || '')) return setError('Enter a valid email address.');
    return save.mutate();
  };

  const submitPassword = (e) => {
    e.preventDefault();
    setPwError(null);
    if (pw.new_password.length < 8) return setPwError('New password must be at least 8 characters.');
    if (pw.new_password !== pw.confirm) return setPwError('The new passwords do not match.');
    return password.mutate();
  };

  if (!doctor) return null;

  return (
    <div className="mx-auto max-w-[960px]">
      <PageHeader eyebrow="Settings" title="Your profile" subtitle="Shown on reports you generate and reviews you sign." />

      <div className="space-y-6">
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-5">
            <Avatar name={doctor.full_name} src={doctor.has_photo ? api.profilePhotoUrl(photoVersion || doctor.id) : null} size={80} />
            <div className="min-w-0 flex-1">
              <p className="text-[20px] font-bold text-ink">{doctorName(doctor)}</p>
              <p className="text-[13.5px] text-ink-soft">{[doctor.specialty, doctor.hospital].filter(Boolean).join(' · ') || doctor.email}</p>
              <p className="mt-1 text-[12px] text-ink-faint">Last sign-in {formatDateTime(doctor.last_login_at, 'never')}</p>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) photo.mutate(f); e.target.value = ''; }} />
            <Button variant="secondary" icon={Camera} loading={photo.isPending} onClick={() => fileRef.current?.click()}>Update photo</Button>
          </div>
        </Card>

        <Card as="form" onSubmit={submitProfile} className="p-5 sm:p-6">
          <CardHeader icon={Stethoscope} title="Professional details" />
          <InlineAlert tone="red" className="mt-4">{error}</InlineAlert>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>{({ id }) => <TextInput id={id} value={form.full_name ?? ''} onChange={set('full_name')} />}</Field>
            <Field label="Email" required>{({ id }) => <TextInput id={id} type="email" value={form.email ?? ''} onChange={set('email')} />}</Field>
            <Field label="Medical specialty">{({ id }) => <TextInput id={id} value={form.specialty ?? ''} onChange={set('specialty')} placeholder="e.g. Neuroradiology" />}</Field>
            <Field label="Hospital / clinic">{({ id }) => <TextInput id={id} value={form.hospital ?? ''} onChange={set('hospital')} />}</Field>
            <Field label="License / professional ID">{({ id }) => <TextInput id={id} value={form.license_id ?? ''} onChange={set('license_id')} className="font-mono" />}</Field>
            <Field label="Phone">{({ id }) => <TextInput id={id} type="tel" value={form.phone ?? ''} onChange={set('phone')} />}</Field>
            <Field label="Location" className="sm:col-span-2">{({ id }) => <TextInput id={id} value={form.location ?? ''} onChange={set('location')} placeholder="City, country" />}</Field>
          </div>
          <div className="mt-5 flex justify-end"><Button type="submit" icon={Save} loading={save.isPending}>Save profile</Button></div>
        </Card>

        <Card as="form" onSubmit={submitPassword} className="p-5 sm:p-6">
          <CardHeader icon={KeyRound} title="Password" subtitle="Changing it signs you out on every other device." />
          <InlineAlert tone="red" className="mt-4">{pwError}</InlineAlert>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="Current password">{({ id }) => <TextInput id={id} type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />}</Field>
            <Field label="New password" hint="8+ characters, letters and numbers or symbols.">{({ id }) => <TextInput id={id} type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />}</Field>
            <Field label="Confirm new password">{({ id }) => <TextInput id={id} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
          </div>
          <div className="mt-5 flex justify-end"><Button type="submit" variant="secondary" icon={KeyRound} loading={password.isPending}>Change password</Button></div>
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
          <div>
            <p className="font-semibold text-ink">Sign out</p>
            <p className="text-[13px] text-ink-soft">End this session on this device.</p>
          </div>
          <Button variant="danger" icon={LogOut} onClick={signOut}>Sign out</Button>
        </Card>
      </div>
    </div>
  );
}
