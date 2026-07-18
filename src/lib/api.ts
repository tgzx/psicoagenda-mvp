import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type PublicSlot = {
  starts_at: string
  ends_at: string
  day_label: string
  date: string
  time: string
}

export type PublicBookingPage = {
  profile: {
    slug: string
    headline: string
    bio: string
    approaches: string[]
    audiences: string[]
    whatsapp_url: string | null
  } | null
  professional: {
    id: string
    name: string
    crp: string | null
    email: string | null
    phone: string | null
    photo_url: string | null
    timezone: string
    default_session_duration_minutes: number
  } | null
  slots: PublicSlot[]
}

export type BookingHold = {
  hold_id: string
  hold_token: string
  starts_at: string
  ends_at: string
  expires_at: string
}

export type AppointmentWithPatient = {
  id: string
  professional_id: string
  patient_id: string
  treatment_episode_id: string | null
  starts_at: string
  ends_at: string
  status: string
  meet_url: string | null
  google_event_id: string | null
  source: string
  patients?: {
    full_name: string
    phone: string | null
    email: string | null
  } | null
}

export type Patient = {
  id: string
  full_name: string
  preferred_name: string | null
  email: string | null
  phone: string | null
  first_contact_note: string | null
  created_at: string
  archived_at: string | null
}

export type TreatmentEpisode = {
  id: string
  patient_id: string
  status: string
  main_complaint: string | null
  therapeutic_goals: string | null
  anamnesis_json: Record<string, unknown>
}

export type ClinicalNote = {
  id: string
  appointment_id: string
  treatment_episode_id: string | null
  content: string
  locked_at: string | null
  updated_at: string
}

export type AdminData = {
  professional: PublicBookingPage['professional']
  profile: PublicBookingPage['profile']
  appointments: AppointmentWithPatient[]
  patients: Patient[]
  treatments: TreatmentEpisode[]
  notes: ClinicalNote[]
  googleConnected: boolean
  notifications: Array<{
    id: string
    appointment_id: string | null
    channel: string
    recipient: string
    status: string
    error_message: string | null
  }>
}

export const demoLogin = {
  email: 'tiago.codex.1784382239223@gmail.com',
  password: 'Teste123456!',
}

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase não está configurado em .env.local.')
  }
  return supabase
}

export async function getSession() {
  const client = requireSupabase()
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  return data.session
}

export async function signIn(email: string, password: string) {
  const client = requireSupabase()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export async function signOut() {
  const client = requireSupabase()
  await client.auth.signOut()
}

export async function loadPublicBookingPage(slug = 'dra-clara-menezes') {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_public_booking_page' as never, {
    p_slug: slug,
    p_days: 21,
  } as never)
  if (error) throw error
  return data as unknown as PublicBookingPage
}

export function subscribeToBookingSlotEvents(professionalId: string, onChange: () => void) {
  const client = requireSupabase()
  const channel = client
    .channel(`booking-slot-events:${professionalId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'booking_slot_events',
        filter: `professional_id=eq.${professionalId}`,
      },
      () => onChange(),
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}

export async function createPublicBookingHold(input: {
  slug: string
  startsAt: string
}) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_public_booking_hold' as never, {
    p_slug: input.slug,
    p_starts_at: input.startsAt,
  } as never)
  if (error) throw error
  return data as unknown as BookingHold
}

export async function releasePublicBookingHold(hold: Pick<BookingHold, 'hold_id' | 'hold_token'> | null) {
  if (!hold) return false
  const client = requireSupabase()
  const { data, error } = await client.rpc('release_public_booking_hold' as never, {
    p_hold_id: hold.hold_id,
    p_hold_token: hold.hold_token,
  } as never)
  if (error) throw error
  return Boolean(data)
}

export async function createPublicBooking(input: {
  slug: string
  startsAt: string
  holdId?: string | null
  holdToken?: string | null
  fullName: string
  phone: string
  email: string
  initialNote: string
  consent: boolean
}) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_public_booking' as never, {
    p_slug: input.slug,
    p_starts_at: input.startsAt,
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_email: input.email || null,
    p_initial_note: input.initialNote || null,
    p_consent: input.consent,
    p_hold_id: input.holdId ?? null,
    p_hold_token: input.holdToken ?? null,
  } as never)
  if (error) throw error
  const booking = data as unknown as {
    appointment: AppointmentWithPatient
    patient: { id: string; full_name: string }
    manage_token: string
  }
  const sync = await client.functions.invoke('booking-sync', {
    body: { appointment_id: booking.appointment.id, manage_token: booking.manage_token },
  })
  return { booking, sync: sync.data as Record<string, unknown> | null, syncError: sync.error }
}

export async function ensureWorkspace(session: Session) {
  const client = requireSupabase()
  const emailName = session.user.email?.split('@')[0] ?? 'Psicólogo'
  const { data, error } = await client.rpc('ensure_my_workspace' as never, {
    p_name: emailName,
    p_crp: '',
    p_email: session.user.email,
    p_phone: '',
    p_slug: 'dra-clara-menezes',
  } as never)
  if (error) throw error
  return data
}

export async function loadAdminData(session: Session): Promise<AdminData> {
  const client = requireSupabase()
  const db = client as any
  await ensureWorkspace(session)
  const userId = session.user.id

  const [
    professional,
    profile,
    appointments,
    patients,
    treatments,
    notes,
    google,
    notifications,
  ] = await Promise.all([
    db.from('professionals').select('*').eq('id', userId).single(),
    db.from('public_profiles').select('*').eq('professional_id', userId).single(),
    db
      .from('appointments')
      .select('*, patients(full_name, phone, email)')
      .eq('professional_id', userId)
      .order('starts_at', { ascending: true }),
    db
      .from('patients')
      .select('*')
      .eq('professional_id', userId)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    db.from('treatment_episodes').select('*').eq('professional_id', userId),
    db.from('clinical_notes').select('*').eq('professional_id', userId).order('updated_at'),
    db
      .from('google_integrations')
      .select('id')
      .eq('professional_id', userId)
      .is('revoked_at', null)
      .maybeSingle(),
    db
      .from('notification_jobs')
      .select('id, appointment_id, channel, recipient, status, error_message')
      .eq('professional_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const responses = [professional, profile, appointments, patients, treatments, notes, google, notifications]
  const failed = responses.find((response) => response.error)
  if (failed?.error) throw failed.error

  return {
    professional: professional.data,
    profile: profile.data,
    appointments: (appointments.data ?? []) as unknown as AppointmentWithPatient[],
    patients: (patients.data ?? []) as Patient[],
    treatments: (treatments.data ?? []) as unknown as TreatmentEpisode[],
    notes: (notes.data ?? []) as ClinicalNote[],
    googleConnected: Boolean(google.data),
    notifications: notifications.data ?? [],
  }
}

export async function updateAppointmentStatus(id: string, status: string) {
  const client = requireSupabase()
  const { error } = await (client as any).from('appointments').update({ status }).eq('id', id)
  if (error) throw error
}

export async function createManualSession(input: {
  professionalId: string
  patientId?: string | null
  fullName: string
  phone: string
  email: string
  initialNote: string
  startsAt: string
  durationMinutes: number
}) {
  const client = requireSupabase()
  const db = client as any
  const email = input.email ? input.email.trim().toLowerCase() : null
  const phone = input.phone ? input.phone.trim() : null
  let patientId = input.patientId || null

  if (!patientId) {
    const { data: patient, error: patientError } = await db
      .from('patients')
      .insert({
        professional_id: input.professionalId,
        full_name: input.fullName.trim(),
        phone,
        email,
        first_contact_note: input.initialNote.trim() || null,
      })
      .select('id')
      .single()
    if (patientError) throw patientError
    patientId = patient.id
  } else {
    const { error: updateError } = await db
      .from('patients')
      .update({
        full_name: input.fullName.trim(),
        phone,
        email,
        first_contact_note: input.initialNote.trim() || null,
      })
      .eq('id', patientId)
      .eq('professional_id', input.professionalId)
    if (updateError) throw updateError
  }

  const { data: currentEpisode, error: episodeReadError } = await db
    .from('treatment_episodes')
    .select('id')
    .eq('professional_id', input.professionalId)
    .eq('patient_id', patientId)
    .in('status', ['triage', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (episodeReadError) throw episodeReadError

  let treatmentEpisodeId = currentEpisode?.id ?? null
  if (!treatmentEpisodeId) {
    const { data: episode, error: episodeError } = await db
      .from('treatment_episodes')
      .insert({
        professional_id: input.professionalId,
        patient_id: patientId,
        status: 'triage',
        main_complaint: input.initialNote.trim() || null,
      })
      .select('id')
      .single()
    if (episodeError) throw episodeError
    treatmentEpisodeId = episode.id
  }

  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000)
  const { data: appointment, error: appointmentError } = await db
    .from('appointments')
    .insert({
      professional_id: input.professionalId,
      patient_id: patientId,
      treatment_episode_id: treatmentEpisodeId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'scheduled',
      appointment_type: 'online',
      source: 'manual_admin',
    })
    .select('id, starts_at')
    .single()
  if (appointmentError) throw appointmentError

  return appointment as { id: string; starts_at: string }
}

export async function saveClinicalNote(input: {
  professionalId: string
  appointmentId: string
  treatmentEpisodeId: string | null
  content: string
  lock?: boolean
}) {
  const client = requireSupabase()
  const db = client as any
  const { data: current, error: readError } = await db
    .from('clinical_notes')
    .select('id')
    .eq('appointment_id', input.appointmentId)
    .eq('note_type', 'evolution')
    .maybeSingle()
  if (readError) throw readError

  const payload = {
    professional_id: input.professionalId,
    appointment_id: input.appointmentId,
    treatment_episode_id: input.treatmentEpisodeId,
    content: input.content,
    locked_at: input.lock ? new Date().toISOString() : null,
  }

  const result = current
    ? await db.from('clinical_notes').update(payload).eq('id', current.id)
    : await db.from('clinical_notes').insert(payload)
  if (result.error) throw result.error
}

export async function saveAnamnesis(treatmentId: string, anamnesisJson: Record<string, unknown>) {
  const client = requireSupabase()
  const { error } = await client
    .from('treatment_episodes')
    .update({ anamnesis_json: anamnesisJson } as never)
    .eq('id', treatmentId)
  if (error) throw error
}

export async function saveProfile(input: {
  professionalId: string
  name: string
  crp: string
  headline: string
  bio: string
  phone: string
}) {
  const client = requireSupabase()
  const whatsappUrl = input.phone ? `https://wa.me/${input.phone.replace(/\D/g, '')}` : null
  const [professional, profile] = await Promise.all([
    (client as any)
      .from('professionals')
      .update({ name: input.name, crp: input.crp, phone: input.phone })
      .eq('id', input.professionalId),
    (client as any)
      .from('public_profiles')
      .update({ headline: input.headline, bio: input.bio, whatsapp_url: whatsappUrl, published: true })
      .eq('professional_id', input.professionalId),
  ])
  if (professional.error) throw professional.error
  if (profile.error) throw profile.error
}

export async function uploadProfilePhoto(professionalId: string, blob: Blob) {
  const client = requireSupabase()
  const path = `${professionalId}/profile.webp`
  const { error: uploadError } = await client.storage
    .from('profile-photos')
    .upload(path, blob, {
      cacheControl: '3600',
      contentType: 'image/webp',
      upsert: true,
    })
  if (uploadError) throw uploadError

  const { data } = client.storage.from('profile-photos').getPublicUrl(path)
  const publicUrl = `${data.publicUrl}?v=${Date.now()}`
  const { error: updateError } = await (client as any)
    .from('professionals')
    .update({ photo_url: publicUrl })
    .eq('id', professionalId)
  if (updateError) throw updateError
  return publicUrl
}

export async function connectGoogle() {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke('google-auth-url', { body: {} })
  if (error) throw error
  return data as { status: string; auth_url?: string; message?: string; missing?: string[] }
}

export async function finishGoogleOAuth(code: string) {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke('google-oauth-finish', { body: { code } })
  if (error) throw error
  return data as { status: string; google_account_email?: string; error?: string }
}

export async function syncAppointment(appointmentId: string) {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke('booking-sync', {
    body: { appointment_id: appointmentId },
  })
  if (error) throw error
  return data as Record<string, unknown>
}

export function formatWhen(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value))
}

export function whatsappUrl(phone: string | null | undefined, text: string) {
  const number = (phone ?? '').replace(/\D/g, '')
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
