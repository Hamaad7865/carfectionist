-- Tyre-centre appointment follow-up values. Existing appointment rows remain valid;
-- the web can continue booking without these optional alignment fields.

alter table public.appointments
  add column if not exists aligned_on date,
  add column if not exists aligned_at_km integer,
  add column if not exists next_at_km integer;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.appointments'::regclass
       and conname = 'appointments_alignment_km_check'
  ) then
    alter table public.appointments
      add constraint appointments_alignment_km_check
      check (
        (aligned_at_km is null or aligned_at_km >= 0)
        and (next_at_km is null or next_at_km >= 0)
        and (
          aligned_at_km is null
          or next_at_km is null
          or next_at_km > aligned_at_km
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.appointments'::regclass
       and conname = 'appointments_duration_minutes_check'
  ) then
    alter table public.appointments
      add constraint appointments_duration_minutes_check
      check (duration_minutes is null or duration_minutes between 1 and 1440);
  end if;
end $$;

comment on column public.appointments.aligned_on is
  'Date of the alignment or service that established the follow-up interval.';
comment on column public.appointments.aligned_at_km is
  'Odometer reading recorded at the alignment or service.';
comment on column public.appointments.next_at_km is
  'Odometer reading at which the client should return.';
