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
    | 'adminLocked' | 'deleteConfirm' | 'loadFailed' | 'saveFailed' | 'deleteFailed'
    | 'edit' | 'status' | 'active' | 'inactive' | 'deactivate' | 'activate'
    | 'deactivateConfirm' | 'actionFailed' | 'empty',
    string
  >
  users: Record<
    | 'colUser' | 'colEmail' | 'colRole' | 'colJoined' | 'colActions' | 'assignRole' | 'empty'
    | 'newUser' | 'createTitle' | 'createHint' | 'firstName' | 'lastName' | 'email' | 'password'
    | 'role' | 'createFailed'
    | 'tabActive' | 'tabPending' | 'tabInactive' | 'emptyPending' | 'emptyInactive'
    | 'modeInvite' | 'modePassword' | 'inviteHint' | 'invite' | 'inviting'
    | 'inviteCreatedTitle' | 'inviteEmailSent' | 'inviteEmailNotSent' | 'copyInviteUrl'
    | 'copied' | 'done' | 'resendInvite' | 'inviteResent' | 'deactivate' | 'activate'
    | 'deactivateConfirm' | 'actionFailed',
    string
  >
  invite: Record<
    | 'title' | 'greeting' | 'setPassword' | 'password' | 'confirmPassword' | 'passwordMismatch'
    | 'passwordTooShort' | 'accept' | 'accepting' | 'invalid' | 'expired' | 'failed',
    string
  >
  demo: Record<'readOnly' | 'usersDisabled', string>
  language: Record<'label', string>
  onboarding: Record<
    | 'title' | 'subtitle' | 'sectionApp' | 'sectionAdmin' | 'sectionEmail' | 'sectionDemo'
    | 'appName' | 'logo' | 'language' | 'currency' | 'currencySymbol' | 'timezone'
    | 'adminName' | 'adminSurname' | 'adminEmail' | 'adminPassword' | 'passwordHint'
    | 'fromName' | 'fromEmail' | 'supportEmail' | 'demoMode'
    | 'submit' | 'submitting' | 'failed' | 'logoNotImage' | 'logoTooLarge',
    string
  >
  settings: Record<
    | 'title' | 'subtitle' | 'save' | 'saved' | 'loadFailed' | 'saveFailed' | 'noPermission',
    string
  >
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
    edit: 'Edit',
    status: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    deactivate: 'Deactivate',
    activate: 'Activate',
    deactivateConfirm:
      'Deactivate role "{name}"? Users who have it keep it, but it won\'t be offered for new assignments.',
    actionFailed: 'Action failed',
    empty: 'No roles yet.',
  },
  users: {
    colUser: 'User',
    colEmail: 'Email',
    colRole: 'Role',
    colJoined: 'Joined',
    colActions: 'Role',
    assignRole: 'Assign role',
    empty: 'No users yet.',
    newUser: 'New user',
    createTitle: 'Create user',
    createHint: 'The user signs in with this email and password. You can change their role later.',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    password: 'Password',
    role: 'Role',
    createFailed: 'Failed to create user',
    tabActive: 'Active',
    tabPending: 'Pending',
    tabInactive: 'Inactive',
    emptyPending: 'No pending invitations.',
    emptyInactive: 'No inactive users.',
    modeInvite: 'Invite by email',
    modePassword: 'Set password now',
    inviteHint:
      'The user gets an invitation link to set their own password. You can copy the link after creating it.',
    invite: 'Invite',
    inviting: 'Inviting…',
    inviteCreatedTitle: 'Invitation created',
    inviteEmailSent: 'An invitation email was sent to {email}.',
    inviteEmailNotSent:
      'Email is not configured — copy the invitation link below and share it with {email}.',
    copyInviteUrl: 'Copy invitation URL',
    copied: 'Copied!',
    done: 'Done',
    resendInvite: 'Resend invitation',
    inviteResent: 'Invitation for {email} was renewed.',
    deactivate: 'Deactivate',
    activate: 'Activate',
    deactivateConfirm: 'Deactivate {name}? They will no longer be able to sign in.',
    actionFailed: 'Action failed',
  },
  invite: {
    title: 'Accept your invitation',
    greeting: 'Hi {name} — set a password to activate your account for {email}.',
    setPassword: 'Choose a password',
    password: 'Password',
    confirmPassword: 'Confirm password',
    passwordMismatch: 'Passwords do not match',
    passwordTooShort: 'Password must be at least 8 characters',
    accept: 'Accept invitation',
    accepting: 'Activating…',
    invalid: 'This invitation link is invalid or has already been used.',
    expired: 'This invitation has expired — ask your administrator for a new one.',
    failed: 'Could not accept the invitation. Please try again.',
  },
  demo: {
    readOnly:
      'This project is running in demo mode — the demo account is read-only, so this data isn’t available. Sign in with a full account to view it.',
    usersDisabled:
      'Demo mode is on — creating and inviting users is disabled for the public demo account.',
  },
  language: {
    label: 'Language',
  },
  onboarding: {
    title: 'Welcome — let’s set up your app',
    subtitle: 'These details configure this instance. You can change them later in settings.',
    sectionApp: 'App',
    sectionAdmin: 'Administrator account',
    sectionEmail: 'Email',
    sectionDemo: 'Demo mode',
    appName: 'App name',
    logo: 'Logo',
    language: 'Default language',
    currency: 'Currency',
    currencySymbol: 'Currency symbol',
    timezone: 'Timezone',
    adminName: 'First name',
    adminSurname: 'Last name',
    adminEmail: 'Email',
    adminPassword: 'Password',
    passwordHint: 'At least 8 characters. This is the administrator login.',
    fromName: 'Sender name',
    fromEmail: 'Sender email',
    supportEmail: 'Support email',
    demoMode: 'Enable demo mode (public read-only login)',
    submit: 'Complete setup',
    submitting: 'Setting up…',
    failed: 'Setup failed',
    logoNotImage: 'The logo must be an image file.',
    logoTooLarge: 'The logo must be 2 MB or smaller.',
  },
  settings: {
    title: 'App settings',
    subtitle: 'Branding, localization and email — applied across the app in real time.',
    save: 'Save changes',
    saved: 'Settings saved.',
    loadFailed: 'Failed to load settings',
    saveFailed: 'Failed to save settings',
    noPermission: 'You don’t have permission to edit app settings.',
  },
}
