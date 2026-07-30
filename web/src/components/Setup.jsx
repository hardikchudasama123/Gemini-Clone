import { Icon } from './Icons.jsx';

/** Shown when the server has no Supabase credentials, so sign-in cannot work. */
export default function Setup() {
  return (
    <div className="login">
      <div className="login-card wide">
        <span className="login-mark" aria-hidden="true">
          <Icon.Cloud width={34} height={34} />
        </span>

        <h1>Finish setting up sign-in</h1>
        <p className="login-sub">
          The server has no Supabase credentials, so Google sign-in is disabled.
        </p>

        <ol className="setup-steps">
          <li>
            Create a project at <code>supabase.com</code>, then run
            <code>supabase/migrations/0001_init.sql</code> in its SQL editor.
          </li>
          <li>
            In <strong>Authentication → Providers → Google</strong>, paste the client ID and
            secret from a Google Cloud OAuth client whose redirect URI is
            <code>https://&lt;ref&gt;.supabase.co/auth/v1/callback</code>.
          </li>
          <li>
            Add these to <code>.env</code> and restart:
            <pre>
              {'SUPABASE_URL=https://<ref>.supabase.co\nSUPABASE_ANON_KEY=sb_publishable_...'}
            </pre>
          </li>
        </ol>

        <p className="login-fine">
          Full instructions are in the project README.
        </p>
      </div>
    </div>
  );
}
