# PsicoAgenda MVP

PWA React/Vite para um app B2C de psicologia com:

- landing page publica do psicologo;
- agendamento sem login de paciente;
- area administrativa do psicologo;
- agenda, pacientes, prontuario, anamnese e evolucao de sessao;
- persistencia real em Supabase;
- foto publica do psicologo com upload para Supabase Storage;
- Edge Functions para sincronizar Google Calendar/Meet, email e WhatsApp;
- PWA com manifest e service worker;
- migrations Supabase em `supabase/migrations`.

## Rodar localmente

```bash
npm install
npm run dev
```

URL local usada nos testes:

```text
http://127.0.0.1:5176/
```

Login demo confirmado no Supabase:

```text
email: tiago.codex.1784382239223@gmail.com
senha: Teste123456!
```

## Build

```bash
npm run build
```

## Supabase

Projeto criado:

- Nome: `psico-agenda-mvp`
- Ref: `vqlpgzsgqxdercqrzlwd`
- URL: `https://vqlpgzsgqxdercqrzlwd.supabase.co`
- Regiao: `sa-east-1`

Migrations aplicadas no projeto:

- `mvp_schema`
- `advisor_cleanup`
- `operational_backend`
- `fix_slot_generation`
- `google_integration_unique_professional`
- `tighten_function_grants`
- `ensure_workspace_security_invoker`
- `profile_photo_storage`

Migrations locais:

- `supabase/migrations/0001_mvp_schema.sql`
- `supabase/migrations/0002_advisor_cleanup.sql`

Edge Functions publicadas:

- `booking-sync`: tenta Google Calendar/Meet, email e WhatsApp depois de uma reserva.
- `google-auth-url`: gera a URL OAuth do Google Calendar.
- `google-oauth-finish`: troca o `code` do Google por refresh token e salva a conexao.

Secrets server-side esperados nas Edge Functions:

- `APP_ORIGIN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Sem esses secrets, o app nao finge sucesso: ele grava `config_missing` nos jobs e deixa WhatsApp manual via `wa.me`.

Storage:

- Bucket publico: `profile-photos`
- Caminho por psicologo: `{professional_id}/profile.webp`
- O upload sobrescreve o arquivo anterior para nao acumular fotos antigas.
- A tela de configuracoes permite escolher imagem, ajustar zoom, girar e salvar em WebP quadrado.

O MVP assume:

- login somente do psicologo/admin;
- paciente sem conta;
- pagamento fora do sistema;
- nenhuma gravacao ou armazenamento de chamadas;
- dados clinicos protegidos por RLS.

Observacao de seguranca: os advisors do Supabase mantem alerta para as RPCs publicas `get_public_booking_page` e `create_public_booking` porque elas sao `security definer` e executaveis sem login. Isso e intencional no MVP para permitir agendamento sem conta de paciente; as funcoes validam perfil publicado, consentimento, disponibilidade, bloqueios e conflito de horario antes de gravar.

`supabase-teal-dog` foi pausado para liberar o limite do plano gratuito.
