create schema if not exists extensions;

set search_path = public, extensions;

alter database postgres set search_path = public, extensions;

create extension if not exists postgis with schema public;
create extension if not exists pgtap with schema extensions;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;
