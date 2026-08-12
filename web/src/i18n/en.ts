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
    'save' | 'saving' | 'cancel' | 'delete' | 'deleting' | 'edit' | 'create' | 'loading' | 'search' | 'confirm' | 'actions' | 'none' | 'openMenu',
    string
  >
  nav: Record<
    | 'dashboard' | 'customers' | 'documents' | 'components' | 'development' | 'users' | 'roles' | 'appSettings'
    | 'settings' | 'navigation' | 'profile' | 'apiDocs' | 'signOut' | 'userMenu',
    string
  >
  customers: {
    title: string
    descriptionLead: string
    descriptionTail: string
    add: string
    statTotal: string
    statActive: string
    statMrr: string
    searchPlaceholder: string
    all: string
    colCustomer: string
    colEmail: string
    colStatus: string
    colMrr: string
    colSeats: string
    emptyTitle: string
    emptyDesc: string
    emptySearchTitle: string
    emptySearchDesc: string
    showing: string
    editTitle: string
    editDesc: string
    createDesc: string
    fieldName: string
    fieldCompany: string
    fieldEmail: string
    fieldStatus: string
    fieldMrr: string
    fieldSeats: string
    saveChanges: string
    deleteTitle: string
    deleteConfirmLead: string
    deleteConfirmTail: string
    saveFailed: string
    deleteFailed: string
    status: Record<'active' | 'trial' | 'churned' | 'lead', string>
  }
  documents: {
    title: string
    description: string
    storageLocal: string
    upload: string
    uploading: string
    colName: string
    colType: string
    colUploaded: string
    emptyTitle: string
    emptyDesc: string
    download: string
    downloading: string
    fileCountOne: string
    fileCountOther: string
    deleteTitle: string
    deleteConfirmLead: string
    deleteConfirmTail: string
    loadFailed: string
    uploadFailed: string
    downloadFailed: string
    deleteFailed: string
    type: Record<'document' | 'image' | 'other', string>
  }
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
    | 'deactivateConfirm' | 'actionFailed' | 'empty' | 'emptyHint',
    string
  >
  users: Record<
    | 'colUser' | 'colEmail' | 'colRole' | 'colJoined' | 'colActions' | 'assignRole' | 'empty' | 'emptyHint'
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
    | 'title' | 'subtitle' | 'save' | 'saved' | 'loadFailed' | 'saveFailed' | 'noPermission'
    | 'tabGeneral' | 'tabLlm' | 'tabFunctions' | 'tabDevelopment',
    string
  >
  llm: Record<
    | 'subtitle' | 'addConnection' | 'editConnection' | 'dialogDesc' | 'loadFailed' | 'saveFailed'
    | 'deleteConfirm' | 'emptyTitle' | 'emptyDesc' | 'keySet' | 'keyUnset' | 'noDefaultModel'
    | 'test' | 'testing' | 'testOk' | 'testFail' | 'provider' | 'label' | 'labelPlaceholder'
    | 'defaultModel' | 'modelPlaceholder' | 'baseUrl' | 'apiKey' | 'apiKeyPlaceholder'
    | 'apiKeyKeep' | 'apiKeyHint' | 'functionsSubtitle' | 'functionsNoCreds' | 'connection'
    | 'connectionNone' | 'noEligibleCreds' | 'model' | 'modelDefaultPlaceholder' | 'saved',
    string
  >
  observability: Record<
    | 'title' | 'subtitle' | 'active' | 'inactive' | 'inactiveHint'
    | 'environment' | 'open' | 'noUi',
    string
  >
  development: Record<
    | 'title' | 'subtitle' | 'tabAgent' | 'tabIssues' | 'tabSupport'
    | 'comingSoon' | 'comingSoonHint' | 'noPermission'
    | 'issuesEmpty' | 'issuesEmptyTitle' | 'issuesError' | 'refresh'
    | 'colIssue' | 'colLevel' | 'colEvents' | 'colUsers' | 'colLastSeen' | 'colActions' | 'open'
    | 'setupTitle' | 'setupIntro' | 'openGlitchtip' | 'redeployNote'
    | 'step1Title' | 'step1Desc' | 'step2Title' | 'step2Desc'
    | 'step3Title' | 'step3Desc' | 'step4Title' | 'step4Desc',
    string
  >
  /** Settings › App › Development — repo, token, deploy switch, access checks. */
  devSettings: Record<
    | 'subtitle' | 'loadFailed' | 'saveFailed' | 'validateFailed' | 'saved' | 'tokenCleared'
    | 'repoSection' | 'repo' | 'repoHint' | 'baseBranch' | 'baseBranchHint'
    | 'token' | 'tokenHint' | 'tokenStored' | 'tokenPlaceholder' | 'clearToken'
    | 'deploySection' | 'deployEnabled' | 'deployEnabledHint'
    | 'checkoutPath' | 'checkoutPathHint'
    | 'runnerOnline' | 'runnerOffline' | 'runnerOfflineHint'
    | 'validate' | 'validating' | 'saveFirst'
    | 'checksTitle' | 'checksPass' | 'checksFail' | 'lastChecked'
    | 'check_repo' | 'check_token' | 'check_pull' | 'check_push' | 'check_base_branch'
    | 'check_pull_request' | 'check_merge' | 'check_runner' | 'check_deploy',
    string
  >
  /** Development › Agent — automated coding jobs and the versions they shipped. */
  agent: Record<
    | 'newJob' | 'newJobHint' | 'titleGenerated'
    | 'prompt' | 'promptPlaceholder' | 'start' | 'starting'
    | 'attachments' | 'attach' | 'attachHint' | 'removeFile' | 'downloadFile'
    | 'fileTooLarge' | 'filesTooLarge' | 'tooManyFiles'
    | 'jobsEmpty' | 'jobsEmptyTitle'
    | 'colJob' | 'colAgent' | 'colStatus' | 'colPr' | 'colDeployed' | 'colCreated'
    | 'status_pending' | 'status_running' | 'status_answer_pending'
    | 'status_deployment_ready' | 'status_deploying' | 'status_deployed'
    | 'status_failed' | 'status_cancelled'
    | 'agent_claude_code' | 'agent_codex'
    | 'answer' | 'answerTitle' | 'answerHint' | 'yourAnswer' | 'sendAnswer' | 'answerFailed'
    | 'deploy' | 'deployDisabled' | 'deployFailed'
    | 'retry' | 'retryFailed' | 'cancelFailed'
    | 'timeline' | 'log' | 'openPr' | 'close'
    | 'loadFailed' | 'createFailed'
    | 'setupNoRepo' | 'setupNoKey' | 'setupNoAgent' | 'setupNoRunner' | 'setupLink',
    string
  >
}

export const en: Dictionary = {
  common: {
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    delete: 'Delete',
    deleting: 'Deleting…',
    edit: 'Edit',
    create: 'Create',
    loading: 'Loading…',
    search: 'Search',
    confirm: 'Confirm',
    actions: 'Actions',
    none: '—',
    openMenu: 'Open menu',
  },
  nav: {
    dashboard: 'Dashboard',
    customers: 'Customers',
    documents: 'Documents',
    components: 'Components',
    development: 'Development',
    users: 'Users',
    roles: 'Roles',
    appSettings: 'App settings',
    settings: 'Settings',
    navigation: 'Navigation',
    profile: 'Profile',
    apiDocs: 'API Docs',
    signOut: 'Sign out',
    userMenu: 'User menu',
  },
  customers: {
    title: 'Customers',
    descriptionLead: 'A CRM-style example backed by the real',
    descriptionTail:
      'API — table, search, filters, tabs and full CRUD with role-based access.',
    add: 'Add customer',
    statTotal: 'Total customers',
    statActive: 'Active',
    statMrr: 'Active MRR',
    searchPlaceholder: 'Search name, company, email…',
    all: 'All',
    colCustomer: 'Customer',
    colEmail: 'Email',
    colStatus: 'Status',
    colMrr: 'MRR',
    colSeats: 'Seats',
    emptyTitle: 'No customers yet',
    emptyDesc: 'Add your first customer to start tracking accounts, MRR, and seats.',
    emptySearchTitle: 'No customers match your filters',
    emptySearchDesc: 'Try a different search term or switch the status filter.',
    showing: 'Showing {shown} of {total} customers.',
    editTitle: 'Edit customer',
    editDesc: 'Update this customer’s details.',
    createDesc: 'Create a new customer record.',
    fieldName: 'Name',
    fieldCompany: 'Company',
    fieldEmail: 'Email',
    fieldStatus: 'Status',
    fieldMrr: 'MRR ({symbol})',
    fieldSeats: 'Seats',
    saveChanges: 'Save changes',
    deleteTitle: 'Delete customer',
    deleteConfirmLead: 'Delete',
    deleteConfirmTail: 'from {company}? This cannot be undone.',
    saveFailed: 'Failed to save customer',
    deleteFailed: 'Failed to delete customer',
    status: {
      active: 'Active',
      trial: 'Trial',
      churned: 'Churned',
      lead: 'Lead',
    },
  },
  documents: {
    title: 'Documents',
    description: 'Upload, download, and manage files stored in {storage}.',
    storageLocal: 'local storage',
    upload: 'Upload file',
    uploading: 'Uploading…',
    colName: 'Name',
    colType: 'Type',
    colUploaded: 'Uploaded',
    emptyTitle: 'No documents yet',
    emptyDesc: 'Upload your first file to keep documents in one place.',
    download: 'Download',
    downloading: 'Downloading…',
    fileCountOne: '{count} file',
    fileCountOther: '{count} files',
    deleteTitle: 'Delete document',
    deleteConfirmLead: 'Permanently delete',
    deleteConfirmTail: '? This cannot be undone.',
    loadFailed: 'Failed to load documents.',
    uploadFailed: 'Upload failed. Please try again.',
    downloadFailed: 'Download failed.',
    deleteFailed: 'Delete failed.',
    type: {
      document: 'Document',
      image: 'Image',
      other: 'Other',
    },
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
    empty: 'No roles yet',
    emptyHint: 'Create a role to control what each user is allowed to do.',
  },
  users: {
    colUser: 'User',
    colEmail: 'Email',
    colRole: 'Role',
    colJoined: 'Joined',
    colActions: 'Role',
    assignRole: 'Assign role',
    empty: 'No users yet',
    emptyHint: 'Invite your first teammate to get started.',
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
    emptyPending: 'No pending invitations',
    emptyInactive: 'No inactive users',
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
    tabGeneral: 'General',
    tabLlm: 'LLM credentials',
    tabFunctions: 'AI functions',
    tabDevelopment: 'Development',
  },
  llm: {
    subtitle: 'Provider connections. API keys are stored encrypted and never shown again.',
    addConnection: 'Add connection',
    editConnection: 'Edit connection',
    dialogDesc: 'Choose a provider, a default model, and paste an API key.',
    loadFailed: 'Failed to load LLM configuration',
    saveFailed: 'Failed to save',
    deleteConfirm: 'Delete the connection “{label}”? Functions using it will be unbound.',
    emptyTitle: 'No connections yet',
    emptyDesc: 'Add an OpenAI or Claude connection to power AI functions.',
    keySet: 'Key set',
    keyUnset: 'No key',
    noDefaultModel: 'No default model',
    test: 'Test',
    testing: 'Testing…',
    testOk: 'Connection OK',
    testFail: 'Connection failed',
    provider: 'Provider',
    label: 'Name',
    labelPlaceholder: 'e.g. OpenAI (production)',
    defaultModel: 'Default model',
    modelPlaceholder: 'e.g. gpt-4o or claude-opus-4-8',
    baseUrl: 'Base URL (optional)',
    apiKey: 'API key',
    apiKeyPlaceholder: 'Paste the provider API key',
    apiKeyKeep: 'Leave blank to keep the current key',
    apiKeyHint: 'Stored encrypted in the server vault; never returned to the browser.',
    functionsSubtitle: 'Pick which connection and model each AI feature uses.',
    functionsNoCreds: 'Add a connection in the LLM credentials tab first.',
    connection: 'Connection',
    connectionNone: 'Not configured',
    noEligibleCreds: 'No connection supports “{capability}”. Add a compatible provider.',
    model: 'Model',
    modelDefaultPlaceholder: 'Uses the connection’s default model',
    saved: 'Saved',
  },
  observability: {
    title: 'Error monitoring',
    subtitle: 'Self-hosted, Sentry-compatible error tracking (GlitchTip).',
    active: 'Capturing errors',
    inactive: 'Not configured',
    inactiveHint:
      'Enable GlitchTip and set a project DSN in .env (SENTRY_DSN / VITE_SENTRY_DSN), then redeploy.',
    environment: 'Environment',
    open: 'Open GlitchTip',
    noUi: 'Dashboard URL not configured.',
  },
  development: {
    title: 'Development',
    subtitle: 'Internal tools and diagnostics.',
    tabAgent: 'Agent',
    tabIssues: 'Issues',
    tabSupport: 'Support',
    comingSoon: 'Coming soon',
    comingSoonHint: 'This tool is on the way.',
    noPermission: 'You don’t have permission to view this.',
    issuesEmpty: 'Errors captured from the app will show up here.',
    issuesEmptyTitle: 'No open issues',
    issuesError: 'Failed to load issues',
    refresh: 'Refresh',
    colIssue: 'Issue',
    colLevel: 'Level',
    colEvents: 'Events',
    colUsers: 'Users',
    colLastSeen: 'Last seen',
    colActions: 'Actions',
    open: 'Open',
    setupTitle: 'Set up live error tracking',
    setupIntro: 'Complete these steps to see errors here live:',
    openGlitchtip: 'Open GlitchTip',
    redeployNote: 'After editing .env, redeploy with ./start.sh.',
    step1Title: 'Enable the error tracker',
    step1Desc: 'Set GLITCHTIP_ENABLED=true in .env and run ./start.sh to bring up GlitchTip.',
    step2Title: 'Create a project and wire the DSN',
    step2Desc:
      'In GlitchTip: create an organization + project, copy the DSN, and set SENTRY_DSN and VITE_SENTRY_DSN in .env.',
    step3Title: 'Create an API auth token',
    step3Desc:
      'In GlitchTip: Profile → Auth Tokens → create a token, then set SENTRY_API_TOKEN in .env.',
    step4Title: 'Set the org and project slugs',
    step4Desc:
      'Set SENTRY_ORG_SLUG and SENTRY_PROJECT_SLUG in .env (from the project’s URL/settings), then redeploy.',
  },
  devSettings: {
    subtitle:
      'Point the development agent at a GitHub repository, then check that it can pull, push, open pull requests, merge, and deploy.',
    loadFailed: 'Failed to load the development settings',
    saveFailed: 'Failed to save',
    validateFailed: 'Validation failed',
    saved: 'Saved.',
    tokenCleared: 'GitHub token removed.',
    repoSection: 'Repository',
    repo: 'GitHub repository',
    repoHint: 'In owner/name form, e.g. tillforty/app-boilerplate. This is the repo the agent builds in.',
    baseBranch: 'Base branch',
    baseBranchHint: 'Pull requests are opened against this branch, and deploys merge into it.',
    token: 'GitHub access token',
    tokenHint:
      'Needs read/write access to the repository’s contents and pull requests. Stored encrypted; never shown again.',
    tokenStored: '•••••••• (stored)',
    tokenPlaceholder: 'ghp_… or github_pat_…',
    clearToken: 'Remove stored token',
    deploySection: 'Deployment',
    deployEnabled: 'Allow one-click deploys',
    deployEnabledHint:
      'When on, Deploy merges the pull request and rebuilds this server. Leave off to merge manually instead.',
    checkoutPath: 'Server checkout path',
    checkoutPathHint: 'The directory on this server that is pulled and rebuilt when you deploy.',
    runnerOnline: 'Agent runner online',
    runnerOffline: 'Agent runner offline',
    runnerOfflineHint: 'Set AGENT_ENABLED=true in .env and run ./start.sh.',
    validate: 'Validate access',
    validating: 'Checking…',
    saveFirst: 'Save a repository first.',
    checksTitle: 'Access checks',
    checksPass: 'Ready',
    checksFail: 'Needs attention',
    lastChecked: 'Last checked {when}',
    check_repo: 'Repository configured',
    check_token: 'Token accepted',
    check_pull: 'Pull (read the code)',
    check_push: 'Push (write a branch)',
    check_base_branch: 'Base branch exists',
    check_pull_request: 'Open pull requests',
    check_merge: 'Merge into the base branch',
    check_runner: 'Agent runner reachable',
    check_deploy: 'Deploy target ready',
  },
  agent: {
    newJob: 'New job',
    newJobHint:
      'Describe what you want built. The agent works on a branch and opens a pull request when it’s done.',
    titleGenerated: 'The job title is written for you from this prompt.',
    prompt: 'Prompt',
    promptPlaceholder: 'e.g. Add a CSV export button to the customers table.',
    start: 'Start job',
    starting: 'Starting…',
    attachments: 'Attachments',
    attach: 'Attach files',
    attachHint:
      'Screenshots or files the agent should look at — up to {max}, {size} each.',
    removeFile: 'Remove',
    downloadFile: 'Download',
    fileTooLarge: '{name} is larger than {size}.',
    filesTooLarge: 'The attachments add up to more than {size}.',
    tooManyFiles: 'At most {max} files can be attached to one job.',
    jobsEmpty: 'Jobs you start will appear here with their progress.',
    jobsEmptyTitle: 'No jobs yet',
    colJob: 'Job',
    colAgent: 'Agent',
    colStatus: 'Status',
    colPr: 'Pull request',
    colDeployed: 'Deployed version',
    colCreated: 'Created',
    status_pending: 'Pending',
    status_running: 'Building',
    status_answer_pending: 'Answer pending',
    status_deployment_ready: 'Deployment ready',
    status_deploying: 'Deploying',
    status_deployed: 'Deployed',
    status_failed: 'Failed',
    status_cancelled: 'Cancelled',
    agent_claude_code: 'Claude Code',
    agent_codex: 'OpenAI Codex',
    answer: 'Answer',
    answerTitle: 'The agent has a question',
    answerHint: 'Answer it and the job continues from where it stopped.',
    yourAnswer: 'Your answer',
    sendAnswer: 'Send and continue',
    answerFailed: 'Failed to send the answer',
    deploy: 'Deploy',
    deployDisabled: 'Deploys are switched off in Settings › App › Development.',
    deployFailed: 'Failed to start the deploy',
    retry: 'Retry',
    retryFailed: 'Failed to retry the job',
    cancelFailed: 'Failed to cancel the job',
    timeline: 'Timeline',
    log: 'Log',
    openPr: 'Open pull request',
    close: 'Close',
    loadFailed: 'Failed to load jobs',
    createFailed: 'Failed to start the job',
    setupNoRepo: 'No GitHub repository or token is configured.',
    setupNoKey: 'The selected development agent connection has no API key.',
    setupNoAgent: 'No development agent is selected under AI functions.',
    setupNoRunner: 'The agent runner is not running, so jobs will stay pending.',
    setupLink: 'Open settings',
  },
}
