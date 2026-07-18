import {
  Activity,
  Bell,
  Calendar,
  Camera,
  Check,
  ClipboardList,
  Clock,
  FileText,
  HeartHandshake,
  Home,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  MonitorSmartphone,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings,
  ShieldCheck,
  UserRound,
  Video,
  ZoomIn,
  X,
} from 'lucide-react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  type AdminData,
  type AppointmentWithPatient,
  type BookingHold,
  type PublicBookingPage,
  type PublicSlot,
  connectGoogle,
  createManualSession,
  createPublicBooking,
  createPublicBookingHold,
  demoLogin,
  finishGoogleOAuth,
  formatWhen,
  getSession,
  loadAdminData,
  loadPublicBookingPage,
  releasePublicBookingHold,
  saveAnamnesis,
  saveClinicalNote,
  saveProfile,
  signIn,
  signOut,
  subscribeToBookingSlotEvents,
  syncAppointment,
  updateAppointmentStatus,
  uploadProfilePhoto,
  whatsappUrl,
} from './lib/api'
import { isSupabaseConfigured } from './lib/supabase'

type View = 'public' | 'booking' | 'success' | 'admin'
type AdminSection = 'dashboard' | 'agenda' | 'patients' | 'record' | 'settings'

const emptyPage: PublicBookingPage = { profile: null, professional: null, slots: [] }

function App() {
  const [view, setView] = useState<View>('public')
  const [adminSection, setAdminSection] = useState<AdminSection>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [page, setPage] = useState<PublicBookingPage>(emptyPage)
  const [publicLoading, setPublicLoading] = useState(true)
  const [success, setSuccess] = useState<{ when: string; sync: Record<string, unknown> | null } | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [preferredSlotStart, setPreferredSlotStart] = useState<string | null>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  const reloadPublic = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setPublicLoading(true)
    try {
      setPage(await loadPublicBookingPage())
    } catch (error) {
      notify(readableError(error))
    } finally {
      if (!options?.silent) setPublicLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void reloadPublic()
    void getSession().finally(() => setSessionReady(true))
  }, [reloadPublic])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code || !params.get('google_oauth')) return
    void finishGoogleOAuth(code)
      .then((result) => notify(result.status === 'connected' ? 'Google Calendar conectado.' : `Google: ${result.error ?? result.status}`))
      .finally(() => {
        window.history.replaceState({}, '', window.location.pathname)
        setView('admin')
        setAdminSection('settings')
      })
  }, [notify])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [view])

  useEffect(() => {
    const professionalId = page.professional?.id
    if (view !== 'public' || !professionalId) return

    let timer = 0
    const refreshQuietly = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void reloadPublic({ silent: true }), 180)
    }

    const unsubscribe = subscribeToBookingSlotEvents(professionalId, refreshQuietly)
    const fallback = window.setInterval(() => void reloadPublic({ silent: true }), 30000)

    return () => {
      window.clearTimeout(timer)
      window.clearInterval(fallback)
      unsubscribe()
    }
  }, [page.professional?.id, reloadPublic, view])

  const go = (next: View) => {
    setView(next)
    setMenuOpen(false)
    if (next === 'public') void reloadPublic()
  }

  const openBooking = (slot?: PublicSlot) => {
    setPreferredSlotStart(slot?.starts_at ?? null)
    go('booking')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => go('public')} aria-label="Ir para a página pública">
          <span className="brand-mark">PA</span>
          <span>
            <strong>PsicoAgenda</strong>
            <small>Agenda clínica real</small>
          </span>
        </button>
        <button className="icon-button mobile-only" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Abrir menu">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={menuOpen ? 'nav open' : 'nav'} aria-label="Navegação principal">
          <button type="button" onClick={() => go('public')}>Site público</button>
          <button type="button" onClick={() => openBooking()}>Agendar</button>
          <button type="button" onClick={() => go('admin')}>Área do psicólogo</button>
        </nav>
      </header>

      {view === 'public' && <PublicSite page={page} loading={publicLoading} onBook={openBooking} onNotice={notify} />}
      {view === 'booking' && <Booking page={page} preferredSlotStart={preferredSlotStart} onReload={reloadPublic} onBack={() => go('public')} onSuccess={(data) => { setSuccess(data); setPreferredSlotStart(null); go('success'); void reloadPublic() }} onNotice={notify} />}
      {view === 'success' && <Success success={success} onAdmin={() => go('admin')} />}
      {view === 'admin' && sessionReady && <AdminApp active={adminSection} onChangeSection={setAdminSection} onNotice={notify} />}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

function PublicSite({ page, loading, onBook, onNotice }: {
  page: PublicBookingPage
  loading: boolean
  onBook: (slot?: PublicSlot) => void
  onNotice: (message: string) => void
}) {
  const professional = page.professional
  const profile = page.profile
  const nextSlot = page.slots[0]
  const miniCalendarDays = groupSlotsByDay(page.slots.slice(0, 8))
  if (loading && !professional && !profile) return <PublicSiteSkeleton />
  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><ShieldCheck size={16} /> Atendimento online, direto e sem burocracia</div>
          <h1>{professional?.name ?? 'Perfil não publicado'}</h1>
          <p className="lead">{profile?.bio ?? 'Entre na área do psicólogo para publicar o perfil e abrir a agenda.'}</p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={() => onBook()} disabled={!profile || loading}>
              <Calendar size={18} /> Agendar consulta
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                if (profile?.whatsapp_url) window.open(profile.whatsapp_url, '_blank', 'noopener,noreferrer')
                else onNotice('WhatsApp do perfil ainda não configurado.')
              }}
            >
              <MessageCircle size={18} /> Chamar no WhatsApp
            </button>
          </div>
          <div className="trust-row">
            <span><Video size={16} /> Consulta online por Google Meet</span>
            <span><Lock size={16} /> Agendamento sem cadastro</span>
            <span><MonitorSmartphone size={16} /> Acesso fácil no celular</span>
          </div>
        </div>
        <div className="profile-panel" aria-label="Resumo da agenda">
          <div className="portrait-card">
            <ProfilePhoto name={professional?.name} url={professional?.photo_url} className="portrait" />
            <div>
              <strong>Próxima disponibilidade</strong>
              <span>{nextSlot ? `${compactWeekdayDate(nextSlot.starts_at)} às ${nextSlot.time}` : loading ? 'Carregando...' : 'Sem horário livre'}</span>
            </div>
          </div>
          <div className="mini-calendar">
            {miniCalendarDays.map((day) => (
              <div className="mini-calendar-day" key={day.key}>
                <strong>{day.label}</strong>
                <div className="slot-badge-list" aria-label={`Horários livres em ${day.label}`}>
                  {day.slots.map((slot) => (
                    <button className="slot-badge" type="button" key={slot.starts_at} onClick={() => onBook(slot)}>
                      {slot.time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="feature-band">
        <Feature icon={<HeartHandshake size={22} />} title="Agende em poucos minutos">Escolha um horário disponível, informe seus contatos e envie a solicitação sem criar conta.</Feature>
        <Feature icon={<Calendar size={22} />} title="Horários claros">Veja os próximos horários livres e encontre uma opção que encaixe na sua rotina.</Feature>
        <Feature icon={<FileText size={22} />} title="Primeiro contato simples">Compartilhe apenas o necessário no início. Os detalhes podem ser conversados com calma na sessão.</Feature>
      </section>
    </main>
  )
}

function PublicSiteSkeleton() {
  return (
    <main aria-busy="true" aria-label="Carregando página pública">
      <section className="hero-section">
        <div className="hero-copy skeleton-copy" aria-hidden="true">
          <div className="skeleton-line skeleton-eyebrow" />
          <div className="skeleton-title">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
          <div className="skeleton-paragraph">
            <div className="skeleton-line" />
            <div className="skeleton-line medium" />
          </div>
          <div className="hero-actions">
            <div className="skeleton-button" />
            <div className="skeleton-button secondary" />
          </div>
          <div className="trust-row skeleton-trust">
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
          </div>
        </div>
        <div className="profile-panel skeleton-panel" aria-hidden="true">
          <div className="portrait-card skeleton-portrait-card">
            <div className="skeleton-avatar" />
            <div className="skeleton-stack">
              <div className="skeleton-line strong" />
              <div className="skeleton-line medium" />
            </div>
          </div>
          <div className="mini-calendar">
            {[0, 1, 2].map((item) => (
              <div className="mini-calendar-day skeleton-day" key={item}>
                <div className="skeleton-line day-title" />
                <div className="skeleton-line day-times" />
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="feature-band" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <article className="feature-card skeleton-feature" key={item}>
            <div className="skeleton-icon" />
            <div className="skeleton-line feature-title" />
            <div className="skeleton-line" />
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
          </article>
        ))}
      </section>
    </main>
  )
}

function Booking({ page, preferredSlotStart, onReload, onBack, onSuccess, onNotice }: {
  page: PublicBookingPage
  preferredSlotStart: string | null
  onReload: () => Promise<void>
  onBack: () => void
  onSuccess: (data: { when: string; sync: Record<string, unknown> | null }) => void
  onNotice: (message: string) => void
}) {
  const [selected, setSelected] = useState<PublicSlot | null>(null)
  const [visibleCount, setVisibleCount] = useState(12)
  const [submitting, setSubmitting] = useState(false)
  const [hold, setHold] = useState<BookingHold | null>(null)
  const [holdingStartAt, setHoldingStartAt] = useState<string | null>(null)
  const holdRef = useRef<BookingHold | null>(null)
  const visibleSlots = page.slots.slice(0, visibleCount)
  const selectedStartAt = selected?.starts_at ?? null
  const profileSlug = page.profile?.slug ?? null

  const releaseCurrentHold = async () => {
    const current = holdRef.current
    holdRef.current = null
    setHold(null)
    if (!current) return
    try {
      await releasePublicBookingHold(current)
    } catch {
      // If the tab closes or the network drops, the database hold still expires automatically.
    }
  }

  useEffect(() => {
    setSelected((current) => {
      const preferred = preferredSlotStart ? page.slots.find((slot) => slot.starts_at === preferredSlotStart) : null
      if (preferred) return preferred
      if (current && page.slots.some((slot) => slot.starts_at === current.starts_at)) return current
      return page.slots[0] ?? null
    })
  }, [page.slots, preferredSlotStart])

  useEffect(() => {
    return () => {
      const current = holdRef.current
      holdRef.current = null
      if (current) void releasePublicBookingHold(current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const previous = holdRef.current

    if (!selectedStartAt || !profileSlug) {
      if (previous) {
        holdRef.current = null
        setHold(null)
        void releasePublicBookingHold(previous)
      }
      return
    }

    if (previous?.starts_at === selectedStartAt && new Date(previous.expires_at) > new Date()) {
      setHold(previous)
      return
    }

    if (previous) {
      holdRef.current = null
      setHold(null)
      void releasePublicBookingHold(previous)
    }

    setHoldingStartAt(selectedStartAt)
    void createPublicBookingHold({ slug: profileSlug, startsAt: selectedStartAt })
      .then((nextHold) => {
        if (cancelled) {
          void releasePublicBookingHold(nextHold)
          return
        }
        holdRef.current = nextHold
        setHold(nextHold)
      })
      .catch(async (error) => {
        if (cancelled) return
        setSelected(null)
        setHold(null)
        onNotice(readableError(error))
        await onReload()
      })
      .finally(() => {
        if (!cancelled) setHoldingStartAt(null)
      })

    return () => {
      cancelled = true
    }
  }, [selectedStartAt, profileSlug, onNotice, onReload])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return onNotice('Escolha um horário livre.')
    const activeHold = holdRef.current
    if (!activeHold || activeHold.starts_at !== selected.starts_at) return onNotice('Estamos reservando esse horário. Tente confirmar em alguns segundos.')
    setSubmitting(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await createPublicBooking({
        slug: page.profile?.slug ?? 'dra-clara-menezes',
        startsAt: selected.starts_at,
        holdId: activeHold.hold_id,
        holdToken: activeHold.hold_token,
        fullName: String(form.get('fullName') ?? ''),
        phone: String(form.get('phone') ?? ''),
        email: String(form.get('email') ?? ''),
        initialNote: String(form.get('initialNote') ?? ''),
        consent: form.get('consent') === 'on',
      })
      holdRef.current = null
      setHold(null)
      onSuccess({ when: formatWhen(result.booking.appointment.starts_at), sync: result.sync })
    } catch (error) {
      onNotice(readableError(error))
      await onReload()
    } finally {
      setSubmitting(false)
    }
  }

  const back = async () => {
    await releaseCurrentHold()
    onBack()
  }

  return (
    <main className="booking-page">
      <section className="booking-layout">
        <div className="booking-copy">
          <button className="text-button" type="button" onClick={() => void back()}>Voltar</button>
          <h2>Agende sem criar conta</h2>
          <p>Escolha um horário livre e informe seus contatos. A solicitação fica registrada para a psicóloga confirmar os próximos passos.</p>
          <div className="notice"><Bell size={18} /> A consulta não é gravada por este site. Qualquer gravação deve ser combinada diretamente com a psicóloga.</div>
        </div>
        <form className="booking-card" onSubmit={(event) => void submit(event)}>
          <fieldset>
            <legend>Horários livres</legend>
            <div className="slot-grid">
              {visibleSlots.map((slot) => (
                <button className={selected?.starts_at === slot.starts_at ? 'slot selected' : 'slot'} key={slot.starts_at} type="button" onClick={() => setSelected(slot)}>
                  <span>{compactWeekdayDate(slot.starts_at)}</span>
                  <strong>{slot.time}</strong>
                </button>
              ))}
            </div>
            <p className="hold-helper">
              {selected
                ? holdingStartAt === selected.starts_at
                  ? 'Reservando esse horário para você...'
                  : hold?.starts_at === selected.starts_at
                    ? 'Horário separado por alguns minutos enquanto você preenche.'
                    : 'Clique em um horário para separar temporariamente.'
                : 'Escolha um horário livre para continuar.'}
            </p>
            {visibleCount < page.slots.length && (
              <button className="secondary-button full more-slots" type="button" onClick={() => setVisibleCount((count) => count + 12)}>
                Mostrar mais horários
              </button>
            )}
            {!page.slots.length && <p className="empty-state">Nenhum horário livre publicado no momento.</p>}
          </fieldset>
          <div className="form-grid">
            <label>Nome completo<input name="fullName" required placeholder="Seu nome" /></label>
            <label>WhatsApp<input name="phone" required placeholder="(11) 99999-0000" inputMode="tel" /></label>
            <label>E-mail<input name="email" placeholder="voce@email.com" type="email" /></label>
            <label>Motivo inicial<textarea name="initialNote" placeholder="Escreva uma frase, se quiser" rows={3} /></label>
          </div>
          <label className="checkbox-row">
            <input name="consent" required type="checkbox" />
            <span>Li e aceito receber confirmações sobre este agendamento. Não enviaremos conteúdo clínico sensível por mensagem.</span>
          </label>
          <button className="primary-button full" type="submit" disabled={submitting || !selected || holdingStartAt === selected?.starts_at || hold?.starts_at !== selected?.starts_at}>
            <Check size={18} /> {submitting ? 'Confirmando...' : !selected ? 'Escolha um horário' : holdingStartAt === selected?.starts_at || hold?.starts_at !== selected?.starts_at ? 'Reservando horário...' : 'Confirmar agendamento'}
          </button>
        </form>
      </section>
    </main>
  )
}

function Success({ success, onAdmin }: { success: { when: string; sync: Record<string, unknown> | null } | null; onAdmin: () => void }) {
  const sync = success?.sync
  return (
    <main className="success-page">
      <section className="success-card">
        <div className="success-icon"><Check size={34} /></div>
        <h2>Consulta registrada</h2>
        <p>{success ? `Solicitação registrada para ${success.when}.` : 'Solicitação registrada.'}</p>
        <div className="success-steps">
          <span>Dados recebidos</span>
          <span>Horário reservado</span>
          <span>WhatsApp: {statusFrom(sync?.whatsapp)}</span>
          <span>Agenda online: {statusFrom(sync?.google)}</span>
        </div>
        <button className="secondary-button" type="button" onClick={onAdmin}>Ver área do psicólogo</button>
      </section>
    </main>
  )
}

function AdminApp({ active, onChangeSection, onNotice }: {
  active: AdminSection
  onChangeSection: (section: AdminSection) => void
  onNotice: (message: string) => void
}) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof getSession>>>(null)
  const [data, setData] = useState<AdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [openNewSession, setOpenNewSession] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const current = await getSession()
      setSession(current)
      setData(current ? await loadAdminData(current) : null)
    } catch (error) {
      onNotice(readableError(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return <AdminSkeleton />
  if (!session) return <LoginPanel onLogged={() => void reload()} onNotice={onNotice} />
  if (!data) return null

  const nav = [
    { id: 'dashboard' as const, label: 'Início', icon: <Home size={18} /> },
    { id: 'agenda' as const, label: 'Agenda', icon: <Calendar size={18} /> },
    { id: 'patients' as const, label: 'Pacientes', icon: <UserRound size={18} /> },
    { id: 'record' as const, label: 'Prontuário', icon: <ClipboardList size={18} /> },
    { id: 'settings' as const, label: 'Configurações', icon: <Settings size={18} /> },
  ]

  return (
    <main className="admin-shell">
      <aside className="admin-nav" aria-label="Navegação da área do psicólogo">
        {nav.map((item) => (
          <button className={active === item.id ? 'active' : ''} key={item.id} type="button" onClick={() => onChangeSection(item.id)}>{item.icon}{item.label}</button>
        ))}
      </aside>
      <section className="admin-content">
        <div className="admin-header">
          <div><p className="eyebrow compact">Área do psicólogo</p><h2>Bom dia, {firstName(data.professional?.name)}</h2></div>
          <div className="admin-actions">
            <button className="secondary-button small" type="button" onClick={() => void reload()}><RefreshCw size={16} /> Atualizar</button>
            <button className="secondary-button small" type="button" onClick={() => { void signOut().then(reload) }}><LogOut size={16} /> Sair</button>
            <button className="primary-button small" type="button" onClick={() => { onChangeSection('agenda'); setOpenNewSession(true) }}><Plus size={16} /> Novo agendamento</button>
          </div>
        </div>
        {active === 'dashboard' && <Dashboard data={data} />}
        {active === 'agenda' && <Agenda data={data} openNewSession={openNewSession} onOpenNewSessionHandled={() => setOpenNewSession(false)} onReload={reload} onNotice={onNotice} />}
        {active === 'patients' && <Patients data={data} />}
        {active === 'record' && <Record data={data} onReload={reload} onNotice={onNotice} />}
        {active === 'settings' && <SettingsPanel data={data} onReload={reload} onNotice={onNotice} />}
      </section>
    </main>
  )
}

function AdminSkeleton() {
  return (
    <main className="admin-shell skeleton-admin" aria-busy="true" aria-label="Carregando área do psicólogo">
      <aside className="admin-nav" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((item) => <div className="skeleton-nav-item" key={item} />)}
      </aside>
      <section className="admin-content" aria-hidden="true">
        <div className="admin-header">
          <div className="skeleton-stack header-stack">
            <div className="skeleton-line skeleton-eyebrow" />
            <div className="skeleton-line admin-title" />
          </div>
          <div className="admin-actions">
            <div className="skeleton-button small" />
            <div className="skeleton-button small" />
            <div className="skeleton-button small" />
          </div>
        </div>
        <div className="dashboard-grid">
          {[0, 1, 2].map((item) => (
            <article className="metric-card skeleton-metric" key={item}>
              <div className="skeleton-icon" />
              <div className="skeleton-line medium" />
              <div className="skeleton-line metric-number" />
            </article>
          ))}
          <section className="panel wide skeleton-content-panel">
            <div className="skeleton-line feature-title" />
            {[0, 1, 2].map((item) => <div className="skeleton-row" key={item} />)}
          </section>
          <section className="panel skeleton-content-panel">
            <div className="skeleton-line feature-title" />
            {[0, 1, 2, 3].map((item) => <div className="skeleton-line" key={item} />)}
          </section>
        </div>
      </section>
    </main>
  )
}

function LoginPanel({ onLogged, onNotice }: { onLogged: () => void; onNotice: (message: string) => void }) {
  const [email, setEmail] = useState(demoLogin.email)
  const [password, setPassword] = useState(demoLogin.password)
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    try {
      await signIn(email, password)
      onLogged()
    } catch (error) {
      onNotice(readableError(error))
    } finally {
      setLoading(false)
    }
  }
  return (
    <main className="success-page">
      <form className="success-card login-card" onSubmit={(event) => void submit(event)}>
        <div className="success-icon"><Lock size={30} /></div>
        <h2>Acesso do psicólogo</h2>
        <p>O paciente não precisa fazer login. Para testar agora, use a conta demo já confirmada no Supabase.</p>
        <label>E-mail<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Senha<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" /></label>
        <button className="primary-button full" disabled={loading} type="submit">{loading ? 'Entrando...' : 'Entrar'}</button>
      </form>
    </main>
  )
}

function Dashboard({ data }: { data: AdminData }) {
  const pendingNotes = data.appointments.filter((item) => !data.notes.some((note) => note.appointment_id === item.id)).length
  return (
    <div className="dashboard-grid">
      <Metric icon={<Calendar size={20} />} label="Consultas no banco" value={String(data.appointments.length)} />
      <Metric icon={<PenLine size={20} />} label="Evoluções pendentes" value={String(pendingNotes)} />
      <Metric icon={<Activity size={20} />} label="Pacientes ativos" value={String(data.patients.length)} />
      <section className="panel wide">
        <div className="panel-header"><h3>Agenda</h3><span>Dados reais do Supabase</span></div>
        <AppointmentList appointments={data.appointments.slice(0, 8)} />
      </section>
      <section className="panel">
        <div className="panel-header"><h3>Integrações</h3><span>Status operacional</span></div>
        <div className="flow-list">
          <Step done text={isSupabaseConfigured ? 'Supabase conectado' : 'Supabase pendente'} />
          <Step done={data.googleConnected} text={data.googleConnected ? 'Google conectado' : 'Google aguardando credenciais/OAuth'} />
          <Step done text="WhatsApp manual via wa.me disponível" />
          <Step text="E-mail depende de RESEND_API_KEY" />
        </div>
      </section>
    </div>
  )
}

function Agenda({ data, openNewSession, onOpenNewSessionHandled, onReload, onNotice }: {
  data: AdminData
  openNewSession: boolean
  onOpenNewSessionHandled: () => void
  onReload: () => Promise<void>
  onNotice: (message: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [patientMode, setPatientMode] = useState<'new' | 'existing'>('new')
  const [selectedPatientId, setSelectedPatientId] = useState('')

  useEffect(() => {
    if (!openNewSession) return
    setCreating(true)
    onOpenNewSessionHandled()
  }, [onOpenNewSessionHandled, openNewSession])

  const selectedPatient = data.patients.find((patient) => patient.id === selectedPatientId)

  const act = async (appointment: AppointmentWithPatient, action: string) => {
    try {
      if (action === 'sync') {
        const result = await syncAppointment(appointment.id)
        onNotice(`Sincronização: Google ${statusFrom(result.google)}, WhatsApp ${statusFrom(result.whatsapp)}.`)
      } else {
        await updateAppointmentStatus(appointment.id, action)
        onNotice('Status salvo no Supabase.')
      }
      await onReload()
    } catch (error) {
      onNotice(readableError(error))
    }
  }

  const submitManualSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!data.professional) return onNotice('Perfil do psicólogo indisponível.')
    const form = new FormData(event.currentTarget)
    const patientMode = String(form.get('patientMode') ?? 'new')
    const patientId = patientMode === 'existing' ? String(form.get('patientId') ?? '') : ''
    const fullName = patientMode === 'existing'
      ? selectedPatient?.full_name ?? ''
      : String(form.get('fullName') ?? '')
    if (!fullName.trim()) return onNotice('Informe o paciente da sessão.')
    setSaving(true)
    try {
      const appointment = await createManualSession({
        professionalId: data.professional.id,
        patientId: patientId || null,
        fullName,
        phone: String(form.get('phone') ?? ''),
        email: String(form.get('email') ?? ''),
        initialNote: String(form.get('initialNote') ?? ''),
        startsAt: String(form.get('startsAt') ?? ''),
        durationMinutes: Number(form.get('durationMinutes') || data.professional.default_session_duration_minutes || 50),
      })
      try {
        const result = await syncAppointment(appointment.id)
        onNotice(`Agendamento criado. Google ${statusFrom(result.google)}, WhatsApp ${statusFrom(result.whatsapp)}.`)
      } catch {
        onNotice('Agendamento criado. Use Sincronizar para tentar gerar o Meet depois.')
      }
      setCreating(false)
      setPatientMode('new')
      setSelectedPatientId('')
      await onReload()
    } catch (error) {
      onNotice(readableError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Agenda</h3>
        <span>Atualizar status, sincronizar e criar agendamentos manuais</span>
      </div>
      {creating && (
        <form className="manual-session-form" onSubmit={(event) => void submitManualSession(event)}>
          <div className="manual-session-header">
            <div>
              <strong>Novo agendamento</strong>
              <span>Crie uma sessão manual para um paciente novo ou já cadastrado.</span>
            </div>
            <button className="icon-button icon-only" type="button" onClick={() => { setCreating(false); setPatientMode('new'); setSelectedPatientId('') }} aria-label="Fechar novo agendamento"><X size={18} /></button>
          </div>
          <div className="segmented-control" role="group" aria-label="Tipo de paciente">
            <label><input checked={patientMode === 'new'} name="patientMode" type="radio" value="new" onChange={() => { setPatientMode('new'); setSelectedPatientId('') }} /> Paciente novo</label>
            <label><input checked={patientMode === 'existing'} name="patientMode" type="radio" value="existing" onChange={() => setPatientMode('existing')} /> Já cadastrado</label>
          </div>
          <div className="manual-session-grid" key={`${patientMode}-${selectedPatientId || 'new-patient'}`}>
            {patientMode === 'existing' && (
              <label>Paciente cadastrado
                <select name="patientId" value={selectedPatientId} onChange={(event) => setSelectedPatientId(event.target.value)}>
                  <option value="">Selecionar paciente</option>
                  {data.patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name}</option>)}
                </select>
              </label>
            )}
            <label>Nome do paciente<input name="fullName" placeholder="Nome completo" defaultValue={selectedPatient?.full_name ?? ''} /></label>
            <label>WhatsApp<input name="phone" placeholder="(11) 99999-0000" defaultValue={selectedPatient?.phone ?? ''} inputMode="tel" /></label>
            <label>E-mail<input name="email" placeholder="paciente@email.com" defaultValue={selectedPatient?.email ?? ''} type="email" /></label>
            <label>Data e horário<input name="startsAt" required type="datetime-local" defaultValue={defaultLocalDateTime()} /></label>
            <label>Duração<input name="durationMinutes" min={20} step={5} type="number" defaultValue={data.professional?.default_session_duration_minutes ?? 50} /></label>
            <label className="manual-session-note">Observação inicial<textarea name="initialNote" placeholder="Contexto breve, se necessário" rows={3} defaultValue={selectedPatient?.first_contact_note ?? ''} /></label>
          </div>
          <div className="manual-session-actions">
            <button className="secondary-button small" type="button" onClick={() => { setCreating(false); setPatientMode('new'); setSelectedPatientId('') }}>Cancelar</button>
            <button className="primary-button small" type="submit" disabled={saving}><Check size={16} /> {saving ? 'Criando...' : 'Criar agendamento'}</button>
          </div>
        </form>
      )}
      <div className="appointment-list">
        {data.appointments.map((appointment) => (
          <article className="appointment-row rich" key={appointment.id}>
            <span className="time">{new Date(appointment.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span>
            <div>
              <strong>{appointment.patients?.full_name ?? 'Paciente'}</strong>
              <span>{formatWhen(appointment.starts_at)} - {appointment.meet_url ? 'Meet criado' : 'Meet pendente'}</span>
            </div>
              <span className="status-pill">{statusLabel(appointment.status)}</span>
            <div className="row-actions">
              <button type="button" onClick={() => void act(appointment, 'completed')}>Realizada</button>
              <button type="button" onClick={() => void act(appointment, 'no_show')}>Falta</button>
              <button type="button" onClick={() => void act(appointment, 'sync')}>Sincronizar</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function Patients({ data }: { data: AdminData }) {
  return (
    <section className="panel">
      <div className="panel-header"><h3>Pacientes</h3><span>Criados pelo agendamento público</span></div>
      <div className="patient-list">
        {data.patients.map((patient) => {
          const link = whatsappUrl(patient.phone, `Olá, ${patient.full_name}. Estou entrando em contato sobre seu agendamento.`)
          return (
            <article className="patient-row" key={patient.id}>
              <div className="avatar">{initials(patient.full_name)}</div>
              <div><strong>{patient.full_name}</strong><span>{patient.phone ?? 'sem telefone'} - {patient.email ?? 'sem e-mail'}</span></div>
              <span className="status-pill">{treatmentStatusLabel(data.treatments.find((item) => item.patient_id === patient.id)?.status ?? 'triage')}</span>
              {link ? <a className="text-link" href={link} target="_blank" rel="noreferrer">WhatsApp</a> : <span>Sem WhatsApp</span>}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function Record({ data, onReload, onNotice }: { data: AdminData; onReload: () => Promise<void>; onNotice: (message: string) => void }) {
  const appointment = data.appointments[0]
  const treatment = appointment?.treatment_episode_id ? data.treatments.find((item) => item.id === appointment.treatment_episode_id) : data.treatments[0]
  const note = appointment ? data.notes.find((item) => item.appointment_id === appointment.id) : null
  const [section, setSection] = useState('queixa')
  const [anamnesis, setAnamnesis] = useState('')
  const [content, setContent] = useState(note?.content ?? '')

  useEffect(() => {
    setContent(note?.content ?? '')
    setAnamnesis(String((treatment?.anamnesis_json?.[section] as string | undefined) ?? ''))
  }, [note?.content, section, treatment])

  const saveAll = async (lock = false) => {
    if (!appointment || !treatment || !data.professional) return onNotice('Crie uma consulta antes de registrar evolução.')
    try {
      await saveAnamnesis(treatment.id, { ...(treatment.anamnesis_json ?? {}), [section]: anamnesis })
      await saveClinicalNote({ professionalId: data.professional.id, appointmentId: appointment.id, treatmentEpisodeId: treatment.id, content, lock })
      onNotice(lock ? 'Evolução bloqueada no Supabase.' : 'Rascunho salvo no Supabase.')
      await onReload()
    } catch (error) {
      onNotice(readableError(error))
    }
  }

  return (
    <div className="record-layout">
      <section className="panel">
        <div className="panel-header"><h3>Prontuário: {appointment?.patients?.full_name ?? 'sem consulta'}</h3><span>Anamnese por ciclo de tratamento</span></div>
        <div className="section-tabs" role="tablist" aria-label="Seções de anamnese">
          {['queixa', 'historico', 'rede'].map((item) => <button className={section === item ? 'active' : ''} key={item} type="button" onClick={() => setSection(item)}>{labelSection(item)}</button>)}
        </div>
        <textarea aria-label="Anamnese" value={anamnesis} onChange={(event) => setAnamnesis(event.target.value)} rows={10} placeholder="Preencha aos poucos durante as sessões." />
      </section>
      <section className="panel note-panel">
        <div className="panel-header"><h3>Evolução da sessão</h3><span>{note?.locked_at ? 'Bloqueada' : 'Rascunho editável'}</span></div>
        <textarea aria-label="Evolução clínica" value={content} onChange={(event) => setContent(event.target.value)} rows={9} placeholder="Registro clínico da sessão." />
        <div className="note-actions">
          <button className="secondary-button small" type="button" onClick={() => void saveAll(false)}>Salvar rascunho</button>
          <button className="primary-button small" type="button" onClick={() => void saveAll(true)}>Bloquear evolução</button>
        </div>
      </section>
    </div>
  )
}

function SettingsPanel({ data, onReload, onNotice }: { data: AdminData; onReload: () => Promise<void>; onNotice: (message: string) => void }) {
  const [name, setName] = useState(data.professional?.name ?? '')
  const [crp, setCrp] = useState(data.professional?.crp ?? '')
  const [phone, setPhone] = useState(data.professional?.phone ?? '')
  const [headline, setHeadline] = useState(data.profile?.headline ?? '')
  const [bio, setBio] = useState(data.profile?.bio ?? '')
  const save = async () => {
    if (!data.professional) return
    try {
      await saveProfile({ professionalId: data.professional.id, name, crp, headline, bio, phone })
      onNotice('Perfil salvo no Supabase.')
      await onReload()
    } catch (error) {
      onNotice(readableError(error))
    }
  }
  const google = async () => {
    try {
      const result = await connectGoogle()
      if (result.auth_url) window.location.href = result.auth_url
      else onNotice(result.message ?? `Google: ${result.status}`)
    } catch (error) {
      onNotice(readableError(error))
    }
  }
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-header"><h3>Perfil público</h3><span>Persistido no Supabase</span></div>
        <div className="settings-form">
          {data.professional && (
            <PhotoEditor
              currentUrl={data.professional.photo_url}
              professionalId={data.professional.id}
              professionalName={data.professional.name}
              onNotice={onNotice}
              onSaved={onReload}
            />
          )}
          <label>Nome público<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>CRP<input value={crp} onChange={(event) => setCrp(event.target.value)} /></label>
          <label>WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label>Chamada<input value={headline} onChange={(event) => setHeadline(event.target.value)} /></label>
          <label>Biografia<textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={4} /></label>
          <button className="primary-button small settings-save" type="button" onClick={() => void save()}>Salvar perfil</button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h3>Integrações</h3><span>Sem pagamento e sem gravação no app</span></div>
        <div className="integration-list">
          <Integration icon={<ShieldCheck size={18} />} title="Supabase" status="Conectado" />
          <Integration icon={<Calendar size={18} />} title="Google Calendar" status={data.googleConnected ? 'Conectado' : 'Pendente'} />
          <Integration icon={<Video size={18} />} title="Google Meet" status="Via Google Calendar" />
          <Integration icon={<MessageCircle size={18} />} title="WhatsApp" status="Manual/API" />
        </div>
        <div className="note-actions">
          <button className="secondary-button small" type="button" onClick={() => void google()}>Conectar Google</button>
        </div>
      </section>
    </div>
  )
}

function PhotoEditor({
  currentUrl,
  professionalId,
  professionalName,
  onNotice,
  onSaved,
}: {
  currentUrl?: string | null
  professionalId: string
  professionalName?: string | null
  onNotice: (message: string) => void
  onSaved: () => Promise<void>
}) {
  const [source, setSource] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const previewUrl = source ?? currentUrl ?? null

  const chooseFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onNotice('Escolha uma imagem em PNG, JPG ou WebP.')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      onNotice('A foto precisa ter até 3 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setSource(String(reader.result))
      setZoom(1)
      setRotation(0)
    }
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!source) {
      onNotice('Escolha uma nova foto antes de salvar.')
      return
    }
    setSaving(true)
    try {
      const blob = await renderEditedPhoto(source, zoom, rotation)
      await uploadProfilePhoto(professionalId, blob)
      onNotice('Foto publicada no perfil.')
      setSource(null)
      await onSaved()
    } catch (error) {
      onNotice(readableError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="photo-editor">
      <div className="photo-preview-frame">
        <ProfilePhoto name={professionalName} url={previewUrl} className="photo-preview" style={{
          transform: source ? `scale(${zoom}) rotate(${rotation}deg)` : undefined,
        }} />
      </div>
      <div className="photo-controls">
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <button className="secondary-button small" type="button" onClick={() => fileRef.current?.click()}>
          <Camera size={16} /> Escolher foto
        </button>
        <label className="range-control">
          <span><ZoomIn size={16} /> Zoom</span>
          <input min="1" max="2.2" step="0.05" type="range" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} disabled={!source} />
        </label>
        <div className="photo-action-row">
          <button className="secondary-button small icon-only" type="button" onClick={() => setRotation((value) => value - 90)} disabled={!source} aria-label="Girar para esquerda">
            <RotateCcw size={16} />
          </button>
          <button className="secondary-button small icon-only" type="button" onClick={() => setRotation((value) => value + 90)} disabled={!source} aria-label="Girar para direita">
            <RotateCw size={16} />
          </button>
          <button className="secondary-button small" type="button" onClick={() => { setSource(null); setZoom(1); setRotation(0) }} disabled={!source}>
            Resetar
          </button>
          <button className="primary-button small" type="button" onClick={() => void save()} disabled={!source || saving}>
            {saving ? 'Subindo...' : 'Salvar foto'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfilePhoto({
  name,
  url,
  className,
  style,
}: {
  name?: string | null
  url?: string | null
  className: string
  style?: CSSProperties
}) {
  if (url) return <img className={`${className} profile-image`} src={url} alt={name ? `Foto de ${name}` : 'Foto do psicólogo'} style={style} />
  return <div className={className} style={style}>{initials(name)}</div>
}

function AppointmentList({ appointments }: { appointments: AppointmentWithPatient[] }) {
  if (!appointments.length) return <p className="empty-state">Nenhuma consulta ainda. Faça um agendamento público para popular a agenda.</p>
  return <div className="appointment-list">{appointments.map((item) => <article className="appointment-row" key={item.id}><span className="time">{new Date(item.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span><div><strong>{item.patients?.full_name ?? 'Paciente'}</strong><span>{formatWhen(item.starts_at)} - {item.meet_url ? 'Meet criado' : 'Meet pendente'}</span></div><span className="status-pill">{statusLabel(item.status)}</span></article>)}</div>
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <article className="feature-card"><div className="feature-icon">{icon}</div><h3>{title}</h3><p>{children}</p></article>
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <article className="metric-card"><div>{icon}</div><span>{label}</span><strong>{value}</strong></article>
}

function Step({ done, text }: { done?: boolean; text: string }) {
  return <div className="step-row"><span className={done ? 'done' : ''}>{done ? <Check size={14} /> : <Clock size={14} />}</span>{text}</div>
}

function Integration({ icon, title, status }: { icon: ReactNode; title: string; status: string }) {
  return <div className="integration-row"><span>{icon}</span><strong>{title}</strong><em>{status}</em></div>
}

function initials(name?: string | null) {
  return (name ?? 'PA').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function firstName(name?: string | null) {
  return name?.split(' ').find(Boolean) ?? 'Clara'
}

function labelSection(section: string) {
  return { queixa: 'Queixa e objetivos', historico: 'Histórico de saúde', rede: 'Rede e família' }[section] ?? section
}

function groupSlotsByDay(slots: PublicSlot[]) {
  const days = new Map<string, { key: string; label: string; slots: PublicSlot[] }>()
  for (const slot of slots) {
    const key = slot.date || slot.starts_at.slice(0, 10)
    const current = days.get(key) ?? { key, label: compactWeekdayDate(slot.starts_at), slots: [] }
    current.slots.push(slot)
    days.set(key, current)
  }
  return Array.from(days.values())
}

function compactWeekdayDate(value: string) {
  const date = new Date(value)
  const weekday = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date).replace('.', '')
  const dayMonth = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date)
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`
}

function defaultLocalDateTime() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setMinutes(0, 0, 0)
  if (date.getHours() < 8) date.setHours(9)
  else date.setHours(date.getHours() + 1)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusFrom(value: unknown) {
  if (!value || typeof value !== 'object') return 'pendente'
  return integrationStatusLabel(String((value as { status?: string }).status ?? 'pendente'))
}

function integrationStatusLabel(status: string) {
  return {
    connected: 'conectado',
    created: 'criado',
    pending: 'pendente',
    skipped: 'ignorado',
    sent: 'enviado',
    queued: 'enfileirado',
    error: 'erro',
    missing_config: 'configuração pendente',
    config_missing: 'configuração pendente',
    manual_ready: 'manual pronto',
    disabled: 'desativado',
  }[status] ?? status
}

function statusLabel(status: string) {
  return {
    requested: 'Solicitada',
    scheduled: 'Agendada',
    confirmed: 'Confirmada',
    completed: 'Realizada',
    no_show: 'Falta',
    cancelled: 'Cancelada',
    rescheduled: 'Reagendada',
    error: 'Erro',
  }[status] ?? status
}

function treatmentStatusLabel(status: string) {
  return {
    triage: 'Triagem',
    active: 'Ativo',
    paused: 'Pausado',
    discharged: 'Alta',
    closed: 'Encerrado',
  }[status] ?? status
}

function readableError(error: unknown) {
  let message = error instanceof Error ? error.message : ''
  if (!message && typeof error === 'string') message = error
  if (!message && error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error_description?: unknown; details?: unknown; hint?: unknown }
    message = [candidate.message, candidate.error_description, candidate.details, candidate.hint]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ')
  }
  if (!message) message = 'Falha ao carregar dados do Supabase.'
  if (message.includes('slot_conflict')) return 'Esse horário acabou de ser reservado. Escolha outro.'
  if (message.includes('hold_expired')) return 'Essa reserva temporária expirou. Escolha o horário novamente.'
  if (message.includes('slot_outside_availability')) return 'Horário fora da disponibilidade publicada.'
  if (message.includes('consent_required')) return 'O aceite é obrigatório para agendar.'
  return message
}

async function renderEditedPhoto(source: string, zoom: number, rotation: number) {
  const image = await loadImage(source)
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponível para editar a foto.')

  const normalizedRotation = ((rotation % 360) + 360) % 360
  const rotated = normalizedRotation === 90 || normalizedRotation === 270
  const effectiveWidth = rotated ? image.height : image.width
  const effectiveHeight = rotated ? image.width : image.height
  const scale = Math.max(size / effectiveWidth, size / effectiveHeight) * zoom

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size, size)
  context.translate(size / 2, size / 2)
  context.rotate((normalizedRotation * Math.PI) / 180)
  context.drawImage(
    image,
    (-image.width * scale) / 2,
    (-image.height * scale) / 2,
    image.width * scale,
    image.height * scale,
  )

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Não foi possível processar a foto.'))
    }, 'image/webp', 0.9)
  })
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível abrir a imagem.'))
    image.src = source
  })
}

export default App
