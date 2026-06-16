/**
 * English translations (the default + reference language).
 *
 * To add a language: copy this file (e.g. `lt.ts`), translate the values, keep
 * the SAME keys, and register it in `index.tsx`. Keys are accessed by dot path,
 * e.g. t('roles.title'). Use {placeholders} for interpolation, e.g. t('roles.editRole', { name }).
 */
export const en = {
  common: {
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    loading: 'Loading…',
    search: 'Search',
    confirm: 'Confirm',
    actions: 'Actions',
    none: '—',
  },
  nav: {
    dashboard: 'Dashboard',
    users: 'Users',
    roles: 'Roles',
    settings: 'Settings',
    profile: 'Profile',
    apiDocs: 'API Docs',
    signOut: 'Sign out',
  },
  auth: {
    title: 'Sign in to your account',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    invalidCredentials: 'Invalid email or password',
  },
  roles: {
    title: 'Roles & permissions',
    subtitle: 'Define roles and pick the functions each one can perform.',
    newRole: 'New role',
    editRole: 'Edit {name}',
    system: 'System',
    fullAccess: 'Full access',
    noPermissions: 'No permissions',
    permissions: 'Permissions',
    name: 'Name',
    description: 'Description',
    adminLocked:
      'The administrator role always has full access — its permissions are locked.',
    deleteConfirm: 'Delete role "{name}"? This cannot be undone.',
  },
  language: {
    label: 'Language',
  },
} as const

export type Dictionary = typeof en
