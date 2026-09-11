# Cuenta GitHub para deploy de NetSpace

**Creada:** 2026-09-11
**Propósito:** exclusiva para repos de deploy de proyectos de prueba (NetSpace). No es la cuenta principal de Tito (sus proyectos SAS/GW/O3.zone viven en otra cuenta).

## Datos

- **Email:** rjarem@gmail.com
- **Username:** rjarem
- **Tipo de token:** Fine-grained, expiración 2026-12-10 (90 días), nombre `netspace-deploy`
- **Permisos del token:** Contents: Read and write (único necesario)
- **Acceso:** All repositories

## Reglas

- Solo repos de pruebas/NetSpace en esta cuenta — nada de producción
- Token se guarda en `/mnt/1tb-hdd/hermes-local/projects/netspace/.env` (GITHUB_TOKEN)
- Si el token expira (90 días), pedir uno nuevo a Tito

## Recordatorio para Tito cuando entre a GitHub

- La cuenta nueva usa el correo rjarem@gmail.com
- Si GitHub pide 2FA, lo configuró él (recordar guardar los códigos de recuperación)
- Los repos aquí son de pruebas: se pueden borrar sin afectar nada de producción