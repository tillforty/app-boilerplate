"""First-run GlitchTip provisioning — run inside the glitchtip container:

    ./manage.py shell -c "exec(open('/tmp/tf_provision.py').read())"

Idempotently creates an admin user, organization, project, DSN, and a
read-scoped API token, then prints a machine-parseable block that start.sh
parses back into .env (SENTRY_DSN / VITE_SENTRY_DSN / SENTRY_API_TOKEN /
SENTRY_ORG_SLUG / SENTRY_PROJECT_SLUG). Re-running is safe: existing objects are
reused, so the app's error capture + Development › Issues page wire up on the
first ./start.sh with GlitchTip enabled — no manual clicking required.

Config via env (passed with `docker compose exec -e ...`):
  GLITCHTIP_ADMIN_EMAIL, GLITCHTIP_ADMIN_PASSWORD  (required)
  GLITCHTIP_ORG_NAME (default 'Tillforty'), GLITCHTIP_PROJECT_NAME (default 'tillforty-app')

The public DSN host comes from GlitchTip's GLITCHTIP_DOMAIN setting; the backend
DSN uses the internal service host so it works without public DNS.
"""
import os

from django.apps import apps
from django.db import transaction

User = apps.get_model("users", "User")
Organization = apps.get_model("organizations_ext", "Organization")
OrganizationOwner = apps.get_model("organizations_ext", "OrganizationOwner")
Project = apps.get_model("projects", "Project")
ProjectKey = apps.get_model("projects", "ProjectKey")
APIToken = apps.get_model("api_tokens", "APIToken")

email = (os.environ.get("GLITCHTIP_ADMIN_EMAIL") or "").strip()
password = os.environ.get("GLITCHTIP_ADMIN_PASSWORD") or ""
org_name = (os.environ.get("GLITCHTIP_ORG_NAME") or "Tillforty").strip()
project_name = (os.environ.get("GLITCHTIP_PROJECT_NAME") or "tillforty-app").strip()
TOKEN_LABEL = "tillforty-app"
READ_SCOPES = {"org:read", "project:read", "event:read", "member:read", "team:read"}

if not email or not password:
    print("__TF_ERROR__ missing GLITCHTIP_ADMIN_EMAIL / GLITCHTIP_ADMIN_PASSWORD")
    raise SystemExit(0)

with transaction.atomic():
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        user = User.objects.create_user(email=email, password=password)
    # Make it a full admin so it can manage the instance in the UI.
    dirty = False
    if not user.is_staff:
        user.is_staff = True
        dirty = True
    if not user.is_superuser:
        user.is_superuser = True
        dirty = True
    if dirty:
        user.save()

    org = Organization.objects.filter(name=org_name).first()
    if org is None:
        org = Organization.objects.create(name=org_name)
    org_user = org.organization_users.filter(user=user).first()
    if org_user is None:
        org_user = org.add_user(user)
    if not OrganizationOwner.objects.filter(organization=org).exists():
        try:
            OrganizationOwner.objects.create(organization=org, organization_user=org_user)
        except Exception:  # noqa: BLE001 - ownership is best-effort; membership is enough for reads
            pass

    project = Project.objects.filter(organization=org, name=project_name).first()
    if project is None:
        project = Project.objects.create(name=project_name, organization=org, platform="python")
    key = project.projectkey_set.first()
    if key is None:
        key = ProjectKey.objects.create(project=project, name="default")

    dsn_public = key.get_dsn()  # respects GLITCHTIP_DOMAIN (public host)
    dsn_internal = "http://%s@glitchtip:8080/%s" % (key.public_key.hex, project.id)

    # Read-scoped API token for the in-app Issues feed. Build the bitmask from
    # the field's own flag order so it stays correct across GlitchTip versions.
    flags = list(APIToken._meta.get_field("scopes").flags)
    mask = 0
    for i, name in enumerate(flags):
        if name in READ_SCOPES:
            mask |= 1 << i
    token = APIToken.objects.filter(user=user, label=TOKEN_LABEL).first()
    if token is None:
        token = APIToken.objects.create(user=user, label=TOKEN_LABEL, scopes=mask)

print("__TF_PROVISION__")
print("ORG_SLUG=" + org.slug)
print("PROJECT_SLUG=" + project.slug)
print("DSN_PUBLIC=" + dsn_public)
print("DSN_INTERNAL=" + dsn_internal)
print("API_TOKEN=" + token.token)
print("__TF_END__")
