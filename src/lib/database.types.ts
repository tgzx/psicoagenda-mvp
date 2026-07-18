export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type AppointmentStatus =
  | 'requested'
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'cancelled'
  | 'rescheduled'
  | 'error'

export type TreatmentStatus = 'triage' | 'active' | 'paused' | 'discharged' | 'closed'

export type Database = {
  public: {
    Tables: {
      professionals: {
        Row: {
          id: string
          name: string
          crp: string | null
          email: string | null
          phone: string | null
          profile_gender: 'feminine' | 'masculine'
          timezone: string
          default_session_duration_minutes: number
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          name: string
          crp?: string | null
          email?: string | null
          phone?: string | null
          profile_gender?: 'feminine' | 'masculine'
          timezone?: string
          default_session_duration_minutes?: number
          active?: boolean
        }
        Update: Partial<Database['public']['Tables']['professionals']['Insert']>
      }
      public_profiles: {
        Row: {
          id: string
          professional_id: string
          slug: string
          headline: string
          bio: string
          approaches: string[]
          audiences: string[]
          whatsapp_url: string | null
          published: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          professional_id: string
          slug: string
          headline: string
          bio: string
          approaches?: string[]
          audiences?: string[]
          whatsapp_url?: string | null
          published?: boolean
        }
        Update: Partial<Database['public']['Tables']['public_profiles']['Insert']>
      }
      patients: {
        Row: {
          id: string
          professional_id: string
          full_name: string
          preferred_name: string | null
          email: string | null
          phone: string | null
          birth_date: string | null
          first_contact_note: string | null
          created_at: string
          updated_at: string
          archived_at: string | null
        }
        Insert: {
          id?: string
          professional_id: string
          full_name: string
          preferred_name?: string | null
          email?: string | null
          phone?: string | null
          birth_date?: string | null
          first_contact_note?: string | null
        }
        Update: Partial<Database['public']['Tables']['patients']['Insert']>
      }
      treatment_episodes: {
        Row: {
          id: string
          professional_id: string
          patient_id: string
          status: TreatmentStatus
          main_complaint: string | null
          therapeutic_goals: string | null
          anamnesis_json: Json
          started_at: string
          ended_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          professional_id: string
          patient_id: string
          status?: TreatmentStatus
          main_complaint?: string | null
          therapeutic_goals?: string | null
          anamnesis_json?: Json
          started_at?: string
          ended_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['treatment_episodes']['Insert']>
      }
      appointments: {
        Row: {
          id: string
          professional_id: string
          patient_id: string
          treatment_episode_id: string | null
          starts_at: string
          ends_at: string
          status: AppointmentStatus
          appointment_type: string
          source: string
          google_event_id: string | null
          meet_url: string | null
          public_manage_token_hash: string | null
          cancel_reason: string | null
          rescheduled_from_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          professional_id: string
          patient_id: string
          treatment_episode_id?: string | null
          starts_at: string
          ends_at: string
          status?: AppointmentStatus
          appointment_type?: string
          source?: string
        }
        Update: Partial<Database['public']['Tables']['appointments']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      appointment_status: AppointmentStatus
      treatment_status: TreatmentStatus
    }
  }
}
