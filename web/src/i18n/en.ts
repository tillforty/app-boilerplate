/**
 * English translations (the default + reference language).
 *
 * To add a language: copy this file (e.g. `lt.ts`), translate the values, keep
 * the SAME keys, type it as `Dictionary`, and register it in `index.tsx`. Keys
 * are accessed by dot path, e.g. t('roles.title'). Use {placeholders} for
 * interpolation, e.g. t('roles.editRole', { name }).
 *
 * `satisfies Dictionary` keeps English as the canonical shape while widening
 * value types to `string`, so translated dictionaries type-check against it.
 */
export interface Dictionary {
  common: Record<
    'save' | 'saving' | 'cancel' | 'delete' | 'edit' | 'create' | 'loading' | 'search' | 'confirm' | 'actions' | 'none',
    string
  >
  nav: Record<
    'dashboard' | 'users' | 'roles' | 'settings' | 'navigation' | 'profile' | 'apiDocs' | 'signOut',
    string
  >
  auth: Record<
    | 'title' | 'email' | 'password' | 'signIn' | 'signingIn' | 'invalidCredentials'
    | 'continueWith' | 'signInWith' | 'completing' | 'missingToken' | 'callbackFailed'
    | 'demoTitle' | 'demoUsername' | 'demoPassword' | 'demoUse',
    string
  >
  roles: Record<
    | 'title' | 'subtitle' | 'newRole' | 'editRole' | 'system' | 'fullAccess' | 'noPermissions'
    | 'permissions' | 'name' | 'description' | 'namePlaceholder' | 'descPlaceholder' | 'dialogHint'
    | 'adminLocked' | 'deleteConfirm' | 'loadFailed' | 'saveFailed' | 'deleteFailed',
    string
  >
  users: Record<'colUser' | 'colEmail' | 'colRole' | 'colJoined' | 'colActions' | 'assignRole' | 'empty', string>
  language: Record<'label', string>
}

export const en: Dictionary = {
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
    navigation: 'Navigation',
    profile: 'Profile',
    apiDocs: 'API Docs',
    signOut: 'Sign out',
  },
  auth: {
    title: 'Sign in to your account',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    invalidCredentials: 'Invalid email or password',
    continueWith: 'Or continue with',
    signInWith: 'Sign in with {provider}',
    completing: 'Completing sign-in…',
    missingToken: 'Missing sign-in token.',
    callbackFailed: 'Sign-in failed. Please try again.',
    demoTitle: 'Demo access',
    demoUsername: 'Username',
    demoPassword: 'Password',
    demoUse: 'Use demo credentials',
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
    namePlaceholder: 'e.g. editor',
    descPlaceholder: 'What is this role for?',
    dialogHint: 'Tick the functions and actions this role is allowed to perform.',
    adminLocked:
      'The administrator role always has full access — its permissions are locked.',
    deleteConfirm: 'Delete role "{name}"? This cannot be undone.',
    loadFailed: 'Failed to load roles',
    saveFailed: 'Failed to save role',
    deleteFailed: 'Failed to delete role',
  },
  users: {
    colUser: 'User',
    colEmail: 'Email',
    colRole: 'Role',
    colJoined: 'Joined',
    colActions: 'Role',
    assignRole: 'Assign role',
    empty: 'No users yet.',
  },
  language: {
    label: 'Language',
  },
}
